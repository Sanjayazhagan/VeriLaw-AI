import { Router, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

import { db } from '../db';
import { documents, auditResults } from '../db/schema';
import { extractTextFromFile } from '../services/parser';
import { scrubText } from '../services/scrubber';
import { triggerRLMAnalysis, splitTextIntoPages } from '../services/fastapi';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Configure Multer for local file storage
const uploadDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

/**
 * Route: POST /api/documents/upload
 * Action: Receives a contract file, extracts text (OCR if needed), redacts PII, saves to DB, and cues analysis.
 */
router.post('/upload', authenticateJWT, upload.single('contract'), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;
  const filename = req.file.originalname;
  const docId = uuidv4();

  try {
    // 1. Extract text (searchable PDF / TXT / Image OCR)
    const rawText = await extractTextFromFile(filePath, mimeType, filename);

    // 2. Privacy Scrubber (anonymize PII)
    const { scrubbedText, mapping } = scrubText(rawText);

    // 3. Insert document record using Drizzle ORM
    await db.insert(documents).values({
      id: docId,
      userId: req.user?.id,
      filename,
      originalText: rawText,
      scrubbedText,
      piiMapping: JSON.stringify(mapping),
      status: 'processing',
      progressStep: 'PII Scrubbed & Queuing...',
      progressPercent: 25,
    });

    // 4. Split scrubbed text into page items for FastAPI
    const pageItems = splitTextIntoPages(scrubbedText);

    // 5. Send analysis payload to Python RLM Microservice
    try {
      await triggerRLMAnalysis({
        document_id: docId,
        pages: pageItems,
        chunk_size: 4000,
        chunk_overlap: 400,
        groq_api_key: req.user?.groqApiKey, // Forward the user's custom API key
      });

      // Update progress to queued in Redis
      await db
        .update(documents)
        .set({
          progressStep: 'Analysis Queued',
          progressPercent: 35
        })
        .where(eq(documents.id, docId));

      // Cleanup local temp file
      fs.unlinkSync(filePath);

      return res.status(202).json({
        message: 'Contract received and analysis queued.',
        document_id: docId,
      });
    } catch (analysisError: any) {
      // Mark as failed in DB if we couldn't queue the task
      await db
        .update(documents)
        .set({ 
          status: 'failed',
          progressStep: 'Failed to queue audit',
          progressPercent: 100
        })
        .where(eq(documents.id, docId));

      fs.unlinkSync(filePath);
      throw analysisError;
    }
  } catch (error: any) {
    console.error('❌ Upload route error:', error);
    // Cleanup if file still exists
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return res.status(500).json({ error: error.message || 'An error occurred during processing.' });
  }
});

/**
 * Route: GET /api/documents
 * Action: Retrieves all uploaded contracts ordered by creation date.
 */
router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const allDocs = await db
      .select({
        id: documents.id,
        filename: documents.filename,
        status: documents.status,
        contractType: documents.contractType,
        riskLevel: documents.riskLevel,
        selectedModel: documents.selectedModel,
        progressStep: documents.progressStep,
        progressPercent: documents.progressPercent,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.userId, req.user!.id))
      .orderBy(desc(documents.createdAt));

    return res.json(allDocs);
  } catch (error: any) {
    console.error('❌ Error fetching documents:', error);
    return res.status(500).json({ error: 'Failed to retrieve documents.' });
  }
});

/**
 * Route: GET /api/documents/:id
 * Action: Fetches a single contract detail, including original text, scrubbed text, and audit results (if complete).
 */
router.get('/:id', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    // Fetch document metadata and contents
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Ensure user owns this document
    if (doc.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied. You do not own this document.' });
    }

    // Fetch matching audit results
    const [results] = await db.select().from(auditResults).where(eq(auditResults.documentId, id));

    return res.json({
      document: {
        id: doc.id,
        filename: doc.filename,
        originalText: doc.originalText,
        scrubbedText: doc.scrubbedText,
        piiMapping: JSON.parse(doc.piiMapping),
        status: doc.status,
        contractType: doc.contractType,
        riskLevel: doc.riskLevel,
        selectedModel: doc.selectedModel,
        progressStep: doc.progressStep,
        progressPercent: doc.progressPercent,
        createdAt: doc.createdAt,
      },
      auditResults: results
        ? {
            id: results.id,
            jobId: results.jobId,
            executiveSummary: results.executiveSummary,
            identifiedRisks: JSON.parse(results.identifiedRisks),
            createdAt: results.createdAt,
          }
        : null,
    });
  } catch (error: any) {
    console.error('❌ Error fetching document detail:', error);
    return res.status(500).json({ error: 'Failed to retrieve document details.' });
  }
});

/**
 * Route: DELETE /api/documents/:id
 * Action: Deletes/Cancels a contract and its associated audit findings.
 */
router.delete('/:id', authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  try {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    if (doc.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied. You do not own this document.' });
    }

    await db.delete(documents).where(eq(documents.id, id));
    return res.json({ message: 'Document cancelled/deleted successfully.' });
  } catch (error: any) {
    console.error('❌ Error deleting document:', error);
    return res.status(500).json({ error: 'Failed to delete document.' });
  }
});

export default router;

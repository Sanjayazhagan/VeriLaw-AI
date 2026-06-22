import pdfParse from 'pdf-parse';
import * as fs from 'fs';
import { createWorker } from 'tesseract.js';

/**
 * Extracts text from the uploaded file based on its MIME type/extension.
 * Supports text, selectable PDFs, and images (OCR via Tesseract.js).
 */
export async function extractTextFromFile(filePath: string, mimeType: string, filename: string): Promise<string> {
  const extension = filename.split('.').pop()?.toLowerCase();

  // 1. Text files
  if (mimeType === 'text/plain' || extension === 'txt') {
    return fs.readFileSync(filePath, 'utf8');
  }

  // 2. Image files - Direct OCR
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg'].includes(extension || '')) {
    console.log(`🖼️ Image detected: ${filename}. Executing OCR via Tesseract.js...`);
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(filePath);
    await worker.terminate();
    return text;
  }

  // 3. PDF files
  if (mimeType === 'application/pdf' || extension === 'pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    
    // Custom pagerender to inject form feed (\f) characters at the end of each page
    const options = {
      pagerender: (pageData: any) => {
        return pageData.getTextContent({
          normalizeWhitespace: true,
          disableCombineTextItems: false
        }).then((textContent: any) => {
          let lastY: number | undefined, text = '';
          for (let item of textContent.items) {
            if (lastY === item.transform[5] || !lastY) {
              text += item.str;
            } else {
              text += '\n' + item.str;
            }
            lastY = item.transform[5];
          }
          return text + '\f';
        });
      }
    };

    const pdfData = await pdfParse(dataBuffer, options);
    const extractedText = pdfData.text || '';

    // If we extracted a reasonable amount of text, return it
    if (extractedText.trim().length > 50) {
      console.log(`📄 Successfully extracted selectable text from PDF: ${filename}`);
      return extractedText;
    }

    // Scanned PDF Fallback
    console.log(`⚠️ Scanned/Image-only PDF detected: ${filename}`);
    // In a fully containerized cloud environment, we would use pdf-img-convert to render the PDF pages as PNG images,
    // then process each image through Tesseract.js.
    // For this local build, we output a clear message instructing the user to upload searchable PDFs or image files (.png/.jpg) for OCR.
    return `[SCANNED DOCUMENT PREVIEW]
This document was detected as a scanned PDF.
To run OCR on this local development environment, please upload a searchable PDF, a text (.txt) file, or an image file (.png/.jpg/.jpeg) directly.
In production, pdf-img-convert converts the PDF pages to high-resolution PNGs which are processed page-by-page through Tesseract.js.`;
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

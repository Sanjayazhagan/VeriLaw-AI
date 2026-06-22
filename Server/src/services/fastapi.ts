import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://localhost:8000';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || 'harvey_dev_super_secret_token_123';

export interface PageData {
  page_number: number;
  text: string;
}

export interface AnalyzePayload {
  document_id: string;
  pages: PageData[];
  chunk_size?: number;
  chunk_overlap?: number;
  groq_api_key?: string;
}

export interface AnalyzeResponse {
  status: string;
  job_id: string;
  message: string;
}

/**
 * Splits raw text into mock pages if form feeds are not present.
 */
export function splitTextIntoPages(text: string): PageData[] {
  // Standard pdf-parse output sometimes uses form feeds (\f) for page breaks
  const rawPages = text.split(/\f/);
  if (rawPages.length > 1) {
    return rawPages
      .map((pageText, idx) => ({
        page_number: idx + 1,
        text: pageText.trim(),
      }))
      .filter(p => p.text.length > 0);
  }

  // Fallback: Segment by 3000 character boundaries to simulate pages
  const pageSize = 3000;
  const pages: PageData[] = [];
  let currentPos = 0;
  let pageNum = 1;

  while (currentPos < text.length) {
    const pageText = text.substring(currentPos, currentPos + pageSize);
    pages.push({
      page_number: pageNum++,
      text: pageText.trim(),
    });
    currentPos += pageSize;
  }

  return pages;
}

/**
 * Sends a scrubbed document to the python RLM microservice for LangGraph auditing.
 */
export async function triggerRLMAnalysis(payload: AnalyzePayload): Promise<AnalyzeResponse> {
  const url = `${FASTAPI_URL}/api/v1/audit/analyze`;
  try {
    const response = await axios.post<AnalyzeResponse>(url, payload, {
      headers: {
        'X-Service-Token': INTERNAL_SERVICE_TOKEN,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('❌ FastAPI Connection Error:', error.response?.data || error.message);
    throw new Error(`Failed to communicate with RLM Microservice: ${error.response?.data?.detail || error.message}`);
  }
}

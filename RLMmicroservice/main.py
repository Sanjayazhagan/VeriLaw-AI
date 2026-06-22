import os
import re
import json
import uuid
import uvicorn
import redis.asyncio as redis
import asyncio
from fastapi import FastAPI, HTTPException, status, Security
from fastapi.security import APIKeyHeader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel

# Notice we removed compiled_graph since that executes in the worker now!
from schemas import AuditRequest
from nodes import intelligent_pre_flight

from worker import start_worker

app = FastAPI(title="Harvey RLM Microservice")

@app.on_event("startup")
async def startup_event():
    print("Spawning background worker loop...")
    asyncio.create_task(start_worker())

# Connect to Upstash Serverless Redis
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379").strip()
# Foolproof regex extraction
match = re.search(r'(rediss?://[^\s\'"]+)', redis_url)
if match:
    redis_url = match.group(1)
else:
    redis_url = "redis://localhost:6379"

# Ensure rediss:// is used for TLS if the user provided redis:// but it's an upstash URL requiring TLS
if "upstash.io" in redis_url and redis_url.startswith("redis://"):
    redis_url = redis_url.replace("redis://", "rediss://", 1)
redis_client = redis.from_url(redis_url, decode_responses=True)

# ==========================================
# 1. THE SECURITY LOCK
# ==========================================
api_key_header = APIKeyHeader(name="X-Service-Token")

def verify_internal_token(api_key: str = Security(api_key_header)):
    expected_token = os.getenv("INTERNAL_SERVICE_TOKEN", "harvey_dev_super_secret_token_123") 
    if api_key != expected_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access Denied: Invalid internal service token."
        )

# ==========================================
# 2. THE PREFLIGHT ENDPOINT
# ==========================================
class PreflightResponse(BaseModel):
    contract_type: str
    risk_level: str
    selected_model: str
    estimated_chunks: int

@app.post("/api/v1/audit/preflight", response_model=PreflightResponse, dependencies=[Security(verify_internal_token)])
async def run_preflight_check(payload: AuditRequest):
    try:
        first_page = payload.pages[0].text
        total_text_length = sum(len(page.text) for page in payload.pages)
        estimated_chunks = (total_text_length // payload.chunk_size) + 1

        dummy_chunk = [{"text": first_page, "metadata": {"page_number": 1}}]
        dynamic_limit, contract_type, risk_level, selected_model = await intelligent_pre_flight(dummy_chunk, payload.groq_api_key)
        
        return {
            "contract_type": contract_type,
            "risk_level": risk_level,
            "selected_model": selected_model,
            "estimated_chunks": estimated_chunks
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 3. THE MAIN ANALYZE ENDPOINT (PRODUCER)
# ==========================================
# Note: Removed response_model=AuditResponse since this now returns a queue ticket
@app.post("/api/v1/audit/analyze", dependencies=[Security(verify_internal_token)])
async def analyze_contract(payload: AuditRequest):
    try:
        # 1. Chunk the document
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=payload.chunk_size,
            chunk_overlap=payload.chunk_overlap
        )
        
        chunked_pages = []
        for page in payload.pages:
            text_chunks = splitter.split_text(page.text)
            for chunk in text_chunks:
                chunked_pages.append({
                    "text": chunk,
                    "metadata": {"page_number": page.page_number}
                })

        if not chunked_pages:
            raise HTTPException(status_code=400, detail="Contract text is empty.")

        # 2. Run intelligent routing
        dynamic_limit, contract_type, risk_level, selected_model = await intelligent_pre_flight(chunked_pages, payload.groq_api_key)
        
        # 3. Build the initial state for LangGraph
        initial_state = {
            "document_id": payload.document_id,
            "contract_text": " ".join([p.text for p in payload.pages]),
            "chunks": chunked_pages,
            "contract_type": contract_type,
            "risk_level": risk_level,
            "selected_model": selected_model,
            "identified_risks": [],
            "groq_api_key": payload.groq_api_key or ""
        }
        
        # 4. Generate a unique Job ID
        job_id = str(uuid.uuid4())
        
        # 5. Package the job for the Redis worker
        job_payload = {
            "job_id": job_id,
            "document_id": payload.document_id,
            "initial_state": initial_state,
            "run_config": {"max_concurrency": dynamic_limit}
        }
        
        # 6. Push to Redis queue
        await redis_client.lpush("audit_queue", json.dumps(job_payload))
        
        # 7. Return the queue ticket to the client immediately
        return {
            "status": "queued",
            "job_id": job_id,
            "message": "Contract audit queued successfully."
        }

    except Exception as e:
        print(f"❌ Queue Failure: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail="An error occurred while queueing the document for analysis."
        )

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
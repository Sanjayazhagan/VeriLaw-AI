import asyncio
import json
import redis.asyncio as redis
from graph import compiled_graph

import os
# Connect to the exact same Redis instance
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
if "upstash.io" in redis_url and redis_url.startswith("redis://"):
    redis_url = redis_url.replace("redis://", "rediss://", 1)
redis_client = redis.from_url(redis_url, decode_responses=True)

async def process_audit(job_str: str):
    job_data = json.loads(job_str)
    job_id = job_data["job_id"]
    doc_id = job_data["document_id"]
    
    print(f"[START] Starting execution for Job: {job_id} (Doc: {doc_id})")
    
    try:
        # 1. Run your heavy LangGraph pipeline here in the background
        final_state = await compiled_graph.ainvoke(
            job_data["initial_state"], 
            config=job_data["run_config"]
        )
        
        # 2. Format the results
        audit_results = {
            "executive_summary": final_state.get("executive_summary", ""),
            "identified_risks": [
                {
                    "target": "liability_or_renewal",
                    "clause": r.get("clause"),
                    "risk_description": r.get("risk_description"),
                    "page": r.get("page")
                } for r in final_state.get("identified_risks", [])
            ]
        }
        
        print(f"[SUCCESS] Job {job_id} Complete. Found {len(audit_results['identified_risks'])} risks.")
        
        # Save audit_results to SQLite database
        import os
        import uuid
        import sqlite3
        
        db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "harvey_audit.db"))
        result_id = str(uuid.uuid4())
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        try:
            # 1. Update document status, metadata and progress
            cursor.execute("""
                UPDATE documents 
                SET status = 'completed',
                    contract_type = ?,
                    risk_level = ?,
                    selected_model = ?,
                    progress_step = 'Completed',
                    progress_percent = 100
                WHERE id = ?
            """, (
                final_state.get("contract_type"),
                final_state.get("risk_level"),
                final_state.get("selected_model"),
                doc_id
            ))
            
            # 2. Insert audit results
            cursor.execute("""
                INSERT INTO audit_results (id, document_id, job_id, executive_summary, identified_risks)
                VALUES (?, ?, ?, ?, ?)
            """, (
                result_id,
                doc_id,
                job_id,
                audit_results["executive_summary"],
                json.dumps(audit_results["identified_risks"])
            ))
            conn.commit()
            print(f"[DATABASE] Saved audit results to database for Job {job_id}.")
        except Exception as db_err:
            conn.rollback()
            print(f"[ERROR] DB Transaction Error: {db_err}")
            raise db_err
        finally:
            conn.close()
            
    except Exception as e:
        print(f"[ERROR] Job {job_id} Failed: {str(e)}")
        import os
        import sqlite3
        db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "harvey_audit.db"))
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE documents 
                SET status = 'failed',
                    progress_step = 'Audit Failed',
                    progress_percent = 100
                WHERE id = ?
            """, (doc_id,))
            conn.commit()
            conn.close()
            print(f"[WARNING] Marked document {doc_id} as FAILED in database.")
        except Exception as db_err:
            print(f"[ERROR] Failed to mark document status to FAILED in DB: {db_err}")


async def start_worker():
    print("Legal Audit Worker connected to Redis. Waiting for contracts...")
    
    while True:
        try:
            # Block until a job is added to "audit_queue"
            result = await redis_client.brpop("audit_queue", 0)
            
            if result:
                _, job_str = result
                # Process the job
                await process_audit(job_str)
                
        except Exception as e:
            print(f"Worker Error: {e}")
            await asyncio.sleep(2) # Prevent rapid failure loops

if __name__ == "__main__":
    # Start the async event loop
    asyncio.run(start_worker())
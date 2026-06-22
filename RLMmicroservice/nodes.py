import os
from typing import List, Tuple, Dict, Any
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langgraph.constants import Send
from tenacity import retry, stop_after_attempt, wait_exponential, RetryError

from schemas import AuditFindings, StrategistDecision, FinalSynthesis
from state import LegalAuditState, WorkerState

load_dotenv()

def update_progress(doc_id: str, step: str, percent: int):
    import psycopg2
    import os
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set!")
        return
    try:
        conn = psycopg2.connect(db_url)
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE documents 
            SET progress_step = %s, progress_percent = %s
            WHERE id = %s
        """, (step, percent, doc_id))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error updating progress in Postgres DB: {e}")


import asyncio

groq_semaphore = asyncio.Semaphore(3)  # Throttle to max 3 concurrent Groq requests

async def safe_ainvoke_raw(llm_bound, prompt):
    async with groq_semaphore:
        # Wrap the LLM call with a 30-second timeout to prevent indefinite hanging
        return await asyncio.wait_for(llm_bound.ainvoke(prompt), timeout=30.0)

@retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
async def safe_ainvoke(llm_bound, prompt):
    """Wraps the async LLM call in a retry loop for rate limits and timeouts."""
    try:
        return await safe_ainvoke_raw(llm_bound, prompt)
    except Exception as e:
        if "429" in str(e) or "rate limit" in str(e).lower():
            print("[RATE LIMIT] Rate limit hit! Pausing to let tokens refill...")
        elif isinstance(e, asyncio.TimeoutError):
            print("[TIMEOUT] Groq API call timed out! Retrying...")
        raise e 

async def intelligent_pre_flight(chunks: List[Dict[str, Any]], api_key: str = None) -> Tuple[int, str, str, str]:
    doc_length = len(chunks)
    concurrency = 2 if doc_length < 5 else 1 
        
    # Read text from the first chunk dict
    first_page_text = chunks[0]["text"]
    prompt = f"""
    You are a Senior Legal Analyst triaging incoming documents.
    Read the first page of this contract and classify it.
    
    Low Risk -> llama-3.1-8b-instant
    High Risk -> llama-3.3-70b-versatile
    
    First Page Text:
    {first_page_text}
    """
    
    # Dynamically instantiate strategist LLM using user key
    local_llm = ChatGroq(temperature=0, model_name="llama-3.1-8b-instant", api_key=api_key or os.getenv("GROQ_API_KEY"))
    local_strategist_bound = local_llm.with_structured_output(StrategistDecision)
    
    decision = await safe_ainvoke(local_strategist_bound, prompt) 
    return concurrency, decision.contract_type, decision.risk_level, decision.selected_model

async def seed_node(state: LegalAuditState):
    update_progress(state["document_id"], "Triage complete. Routing and fanning out chunk audits...", 40)
    return {}

def fan_out_to_workers(state: LegalAuditState):
    return [Send("worker_node", {
        "document_id": state["document_id"],
        "chunk_to_read": chunk_obj["text"],
        "page_number": chunk_obj["metadata"]["page_number"],
        "contract_type": state["contract_type"],
        "risk_level": state["risk_level"],
        "selected_model": state["selected_model"],
        "groq_api_key": state.get("groq_api_key", "")
    }) for chunk_obj in state["chunks"]]

async def worker_node(state: WorkerState): 
    update_progress(state["document_id"], f"Analyzing Page {state['page_number']} with {state['selected_model']}", 65)
    dynamic_llm = ChatGroq(temperature=0, model_name=state["selected_model"], api_key=state.get("groq_api_key") or os.getenv("GROQ_API_KEY"))
    worker_llm_bound = dynamic_llm.with_structured_output(AuditFindings)
    
    prompt = f"""
    You are an elite corporate lawyer reviewing a {state['contract_type']}. 
    Risk level: {state['risk_level']}. 
    
    Extract exact clauses related to 'Uncapped Liability' or 'Auto-Renewal'. 
    If safe, return an empty list. Do not reply with conversational text.
    
    Contract Excerpt:
    {state['chunk_to_read']}
    """
    
    try:
        response = await safe_ainvoke(worker_llm_bound, prompt)
        formatted_risks = [
            {
                "clause": r.clause, 
                "risk_description": r.risk_description,
                "page": state["page_number"] # Injecting the source page here!
            } for r in response.risks
        ]
    except RetryError:
        formatted_risks = []
    
    return {"identified_risks": formatted_risks}

async def synthesizer_node(state: LegalAuditState):
    update_progress(state["document_id"], "Synthesizing report & deduplicating clauses...", 90)
    raw_risks = state.get("identified_risks", [])
    
    if not raw_risks:
        return {"executive_summary": "CLEAN AUDIT REPORT: No material risks regarding Uncapped Liability or Auto-Renewal were identified."}
    
    formatted_raw_list = ""
    for idx, r in enumerate(raw_risks, 1):
        formatted_raw_list += f"Finding {idx} (Page {r['page']}):\n- Clause: {r['clause']}\n- Risk: {r['risk_description']}\n\n"

    prompt = f"""
    You are a Senior General Counsel reviewing a raw risk assessment for a {state.get('contract_type')}.
    Your task is to review the raw findings below, filter out any invalid or hallucinated clauses, deduplicate overlapping clauses, and synthesize a clean markdown executive brief.
    
    INSTRUCTIONS:
    1. Write the `executive_summary`. Retain the page number citations in your summary.
    2. Review the raw findings and create the `identified_risks` list.
    3. DISCARD any finding where the clause is an empty string (""), whitespace, or less than 5 characters.
    4. DEDUPLICATE findings that represent the exact same text or clause.
    5. Return the cleaned list of valid risks.
    
    Raw Findings:
    {formatted_raw_list}
    """
    
    synthesis_llm = ChatGroq(temperature=0, model_name="llama-3.3-70b-versatile", api_key=state.get("groq_api_key") or os.getenv("GROQ_API_KEY"))
    structured_synthesis = synthesis_llm.with_structured_output(FinalSynthesis)
    
    try:
        response = await safe_ainvoke(structured_synthesis, prompt)
        return {
            "executive_summary": response.executive_summary,
            "identified_risks": [r.dict() for r in response.identified_risks]
        }
    except Exception as e:
        print(f"Synthesizer structured output failed: {e}")
        # Fallback to empty risks if it failed structured output
        return {"executive_summary": "Failed to synthesize report.", "identified_risks": []}
import operator
from typing import TypedDict, Annotated, List, Dict, Any

class LegalAuditState(TypedDict):
    document_id: str
    contract_text: str          
    chunks: List[Dict[str, Any]] # Now holds dicts like {"text": "...", "metadata": {"page_number": 1}}
    contract_type: str          
    risk_level: str             
    selected_model: str         
    identified_risks: Annotated[List[dict], operator.add] 
    executive_summary: str      # Holds the final deduplicated report
    groq_api_key: str           # User's custom API key

class WorkerState(TypedDict):
    document_id: str
    chunk_to_read: str
    page_number: int            # Tracks the source page
    contract_type: str          
    risk_level: str             
    selected_model: str
    groq_api_key: str           # User's custom API key
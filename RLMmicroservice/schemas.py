from typing import List, Literal, Optional
from pydantic import BaseModel, Field

# --- LANGGRAPH LLM SCHEMAS ---

class Risk(BaseModel):
    clause: str = Field(description="The specific legal clause")
    risk_description: str = Field(description="Why this is a risk for the client")

class AuditFindings(BaseModel):
    risks: List[Risk] = Field(description="A list of all identified risks. Empty if none.")

class StrategistDecision(BaseModel):
    contract_type: str = Field(description="The type of contract (e.g., NDA, MSA)")
    risk_level: str = Field(description="The overall risk profile (Low, Medium, High)")
    selected_model: Literal["llama-3.1-8b-instant", "llama-3.3-70b-versatile"] = Field(
        description="Choose 'llama-3.1-8b-instant' for standard/low-risk docs, or 'llama-3.3-70b-versatile' for high-risk/complex docs."
    )
    reasoning: str = Field(description="Reason for this classification and model choice")

class FinalRiskFinding(BaseModel):
    target: str = Field(default="liability_or_renewal")
    clause: str
    risk_description: str
    page: int

class FinalSynthesis(BaseModel):
    executive_summary: str = Field(description="The final executive summary in markdown")
    identified_risks: List[FinalRiskFinding] = Field(description="A deduplicated, validated list of the actual risks from the raw findings")

# --- FASTAPI API SCHEMAS ---

class PageData(BaseModel):
    page_number: int
    text: str

class AuditRequest(BaseModel):
    document_id: str = Field(..., description="Unique ID from the Express gateway")
    pages: List[PageData] = Field(..., description="Array of parsed page objects")
    chunk_size: Optional[int] = Field(4000)
    chunk_overlap: Optional[int] = Field(400)
    groq_api_key: Optional[str] = Field(None, description="User's custom Groq API key")

class FinalRiskFinding(BaseModel):
    target: str = Field(default="liability_or_renewal")
    clause: str
    risk_description: str
    page: int

class AuditResults(BaseModel):
    executive_summary: str
    identified_risks: List[FinalRiskFinding]

class AuditMetadata(BaseModel):
    document_id: str
    contract_type: str
    risk_level: str
    selected_model: str

class AuditResponse(BaseModel):
    status: str = "success"
    metadata: AuditMetadata
    audit_results: AuditResults
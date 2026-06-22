CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_text TEXT NOT NULL,
    scrubbed_text TEXT NOT NULL,
    pii_mapping TEXT NOT NULL, -- JSON string mapping placeholders to original PII
    status TEXT NOT NULL CHECK(status IN ('uploaded', 'processing', 'completed', 'failed')),
    contract_type TEXT,
    risk_level TEXT,
    selected_model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_results (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    executive_summary TEXT NOT NULL,
    identified_risks TEXT NOT NULL, -- JSON array of risk objects
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

import sqlite3
import os
import json

db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "harvey_audit.db"))
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT id, filename, status, pii_mapping, scrubbed_text, original_text FROM documents")
for row in cursor.fetchall():
    doc_id, filename, status, mapping_str, scrubbed, original = row
    mapping = json.loads(mapping_str) if mapping_str else []
    print(f"ID: {doc_id} | File: {filename} | Mappings count: {len(mapping)}")
    print("MAPPING:", mapping)
    print("SCRUBBED PAGE 2 PREVIEW:")
    # print some text from the end or middle
    print(scrubbed[-500:] if scrubbed else "None")
    print("--------------------------------------------------")
conn.close()

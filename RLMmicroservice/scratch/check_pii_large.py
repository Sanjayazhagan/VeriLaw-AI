import sqlite3
import os
import json

db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "harvey_audit.db"))
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT id, filename, pii_mapping FROM documents WHERE filename = 'Master_Service_Agreement_Full.pdf' ORDER BY created_at DESC LIMIT 1")
row = cursor.fetchone()
if row:
    doc_id, filename, mapping_str = row
    mapping = json.loads(mapping_str) if mapping_str else []
    print(f"ID: {doc_id} | File: {filename} | Mappings count: {len(mapping)}")
    print("FIRST 50 MAPPINGS:")
    for m in mapping[:50]:
        print(m)
else:
    print("Not found")
conn.close()

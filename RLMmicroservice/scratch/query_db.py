import sqlite3
import os

db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "harvey_audit.db"))
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT id, filename, status, progress_step, progress_percent, created_at FROM documents ORDER BY created_at DESC")
rows = cursor.fetchall()
print("DOCUMENTS IN DATABASE:")
for row in rows:
    print(row)
conn.close()

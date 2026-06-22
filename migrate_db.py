import sqlite3
import os

db_path = "harvey_audit.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute("ALTER TABLE documents ADD COLUMN progress_step TEXT DEFAULT 'Document Uploaded'")
    cursor.execute("ALTER TABLE documents ADD COLUMN progress_percent INTEGER DEFAULT 10")
    conn.commit()
    print("Migration successful: added progress columns.")
except Exception as e:
    print(f"Migration error (columns might already exist): {e}")
finally:
    conn.close()

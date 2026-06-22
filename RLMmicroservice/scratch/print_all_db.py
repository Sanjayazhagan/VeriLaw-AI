import sqlite3
import os

db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "harvey_audit.db"))
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("PRAGMA table_info(documents)")
print("COLUMNS:")
for col in cursor.fetchall():
    print(col)
cursor.execute("SELECT * FROM documents")
print("\nALL DOCUMENTS:")
for row in cursor.fetchall():
    print(row)
conn.close()

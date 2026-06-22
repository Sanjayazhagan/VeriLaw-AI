import sqlite3
import os

db_path = "harvey_audit.db"
schema_path = "schema.sql"

conn = sqlite3.connect(db_path)
with open(schema_path, 'r') as f:
    schema_sql = f.read()

conn.executescript(schema_sql)
conn.commit()
conn.close()
print("Database initialized successfully.")

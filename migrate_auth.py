import sqlite3
import os

db_path = "harvey_audit.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    print("Creating 'users' table...")
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        groq_api_key TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    print("Adding 'user_id' column to 'documents' table...")
    # SQLite ALTER TABLE might fail if column already exists
    try:
        cursor.execute("ALTER TABLE documents ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE")
        print("Column 'user_id' added successfully.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e).lower() or "already exists" in str(e).lower():
            print("Column 'user_id' already exists.")
        else:
            raise e

    conn.commit()
    print("Database migration completed successfully.")
except Exception as e:
    conn.rollback()
    print(f"Migration failed: {e}")
finally:
    conn.close()

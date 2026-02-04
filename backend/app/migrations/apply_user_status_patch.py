from sqlalchemy import text
from app.database import engine

statements = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason VARCHAR(255)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_message TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_source VARCHAR(64) DEFAULT 'manual'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_metadata JSONB DEFAULT '{}'::jsonb",
    "ALTER TABLE users ALTER COLUMN status_metadata SET DEFAULT '{}'::jsonb",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_expires_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_status_changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_changed_by INTEGER REFERENCES users(id)",
]

with engine.connect() as conn:
    for i, stmt in enumerate(statements, start=1):
        try:
            conn.execute(text(stmt))
            conn.commit()
            print(f"✅ [{i}/{len(statements)}] Applied: {stmt}")
        except Exception as e:
            print(f"⚠️ [{i}/{len(statements)}] Skipped/failed: {e}")

print('\nDone')

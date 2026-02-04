"""Ajoute toutes les colonnes statut manquantes sur la table users."""

from sqlalchemy import text
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.database import engine


def migrate_user_status_fields():
    print("🚀 Migration des statuts utilisateurs...")

    statements = [
        # Enum userstatus si absent
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'userstatus') THEN
                CREATE TYPE userstatus AS ENUM ('active', 'review', 'limited', 'suspended', 'banned');
            END IF;
        END$$;
        """,
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status userstatus" ,
        "ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active'",
        "UPDATE users SET status = 'active' WHERE status IS NULL",
        "ALTER TABLE users ALTER COLUMN status SET NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_message TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_source VARCHAR(64) DEFAULT 'manual'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_metadata JSONB DEFAULT '{}'::jsonb",
        "ALTER TABLE users ALTER COLUMN status_metadata SET DEFAULT '{}'::jsonb",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_expires_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_status_changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_changed_by INTEGER REFERENCES users(id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_count INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_suspension_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_by INTEGER REFERENCES users(id)",
        "UPDATE users SET suspension_count = 0 WHERE suspension_count IS NULL",
        "ALTER TABLE users ALTER COLUMN suspension_count SET DEFAULT 0",
        "CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)",
        "CREATE INDEX IF NOT EXISTS idx_users_status_changed_by ON users(status_changed_by)",
    ]

    with engine.connect() as conn:
        for idx, statement in enumerate(statements, start=1):
            try:
                conn.execute(text(statement))
                conn.commit()
                print(f"✅ Étape {idx}/{len(statements)} appliquée")
            except Exception as exc:
                print(f"⚠️ Étape {idx} ignorée: {exc}")

    print("🎉 Colonnes de statut synchronisées")


def verify_user_status_fields():
    required = [
        'status', 'status_reason', 'status_message', 'status_source', 'status_metadata',
        'status_expires_at', 'last_status_changed_at', 'status_changed_by',
        'suspended_until', 'suspension_count', 'last_suspension_at', 'banned_at', 'banned_by'
    ]

    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'users'
        """))
        cols = {row[0] for row in result}

    print("\n🔍 Vérification colonnes users")
    for col in required:
        print(f"{'✅' if col in cols else '❌'} {col}")


if __name__ == "__main__":
    migrate_user_status_fields()
    verify_user_status_fields()

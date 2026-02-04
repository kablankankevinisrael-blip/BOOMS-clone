# backend/app/migrations/migrate_support_tables.py
from sqlalchemy import text
import sys
import os

# Ensure project root is on the path when the script is executed standalone
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.database import engine


def migrate_support_tables():
    """Ajoute les colonnes récentes aux tables de support."""
    print("🚀 Migration des tables de support...")

    statements = [
        "ALTER TABLE banned_user_messages ADD COLUMN IF NOT EXISTS channel VARCHAR(32) DEFAULT 'app'",
        "ALTER TABLE banned_user_messages ALTER COLUMN channel SET DEFAULT 'app'",
        "UPDATE banned_user_messages SET channel = 'app' WHERE channel IS NULL",
        "ALTER TABLE banned_user_messages ALTER COLUMN user_id DROP NOT NULL",
    ]

    with engine.connect() as conn:
        for idx, statement in enumerate(statements, start=1):
            try:
                conn.execute(text(statement))
                conn.commit()
                print(f"✅ [{idx}/{len(statements)}] {statement.split('TABLE')[-1].strip()}")
            except Exception as exc:
                print(f"⚠️  Erreur lors de la requête {idx}: {exc}")

    print("🎉 Migration des tables de support terminée.")


def verify_support_tables():
    """Vérifie la présence des colonnes attendues."""
    print("\n🔍 Vérification des colonnes bannies...")
    inspection = """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'banned_user_messages'
    """
    with engine.connect() as conn:
        result = conn.execute(text(inspection))
        columns = {row[0] for row in result}

    expected = {"channel", "user_id"}
    for column in expected:
        status = "✅" if column in columns else "❌"
        print(f"{status} {column}")


if __name__ == "__main__":
    migrate_support_tables()
    verify_support_tables()

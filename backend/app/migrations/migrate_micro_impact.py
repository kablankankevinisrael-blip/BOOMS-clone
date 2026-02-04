"""Migration pour ajouter les colonnes du nouveau moteur micro-impact."""
import sys
import os
from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from app.database import engine

NEW_COLUMNS = [
    "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS social_accumulator NUMERIC(20, 4) DEFAULT 0",
    "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS palier_threshold NUMERIC(20, 4) DEFAULT 1000000",
    "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS palier_level INTEGER DEFAULT 0",
    "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS applied_micro_value NUMERIC(20, 4) DEFAULT 0",
    "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS treasury_pool NUMERIC(20, 4) DEFAULT 0"
]

def run():
    print("🚀 Migration des colonnes micro-impact...")
    with engine.connect() as conn:
        for index, statement in enumerate(NEW_COLUMNS, start=1):
            try:
                conn.execute(text(statement))
                conn.commit()
                print(f"✅ [{index}/{len(NEW_COLUMNS)}] {statement}")
            except Exception as exc:
                conn.rollback()
                print(f"⚠️  Erreur sur {statement}: {exc}")
    print("🎉 Migration micro-impact terminée")

if __name__ == "__main__":
    run()

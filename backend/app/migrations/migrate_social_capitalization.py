"""Migration script to support micro social-value increments and capitalization fields."""
from sqlalchemy import text
import sys
import os

# Add project root so `app` can be imported when executed directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.database import engine  # noqa: E402


def migrate_social_capitalization():
    print("🚀 Starting social value & capitalization migration...")

    statements = [
        # Increase social_value precision and default
        """
        ALTER TABLE bom_assets
        ALTER COLUMN social_value TYPE NUMERIC(30, 18)
        USING social_value::numeric(30, 18)
        """,
        "ALTER TABLE bom_assets ALTER COLUMN social_value SET DEFAULT 0",
        # New capitalization columns
        """
        ALTER TABLE bom_assets
        ADD COLUMN IF NOT EXISTS market_capitalization NUMERIC(20, 4) DEFAULT 0
        """,
        """
        ALTER TABLE bom_assets
        ADD COLUMN IF NOT EXISTS capitalization_units NUMERIC(30, 18) DEFAULT 0
        """,
        """
        ALTER TABLE bom_assets
        ADD COLUMN IF NOT EXISTS redistribution_pool NUMERIC(20, 4) DEFAULT 0
        """,
        # Ensure no NULLs remain
        "UPDATE bom_assets SET social_value = COALESCE(social_value, 0)",
        "UPDATE bom_assets SET market_capitalization = 0 WHERE market_capitalization IS NULL",
        "UPDATE bom_assets SET capitalization_units = 0 WHERE capitalization_units IS NULL",
        "UPDATE bom_assets SET redistribution_pool = 0 WHERE redistribution_pool IS NULL",
        # Re-sync total_value for legacy rows
        """
        UPDATE bom_assets
        SET total_value = COALESCE(base_price, 0) + COALESCE(social_value, 0),
            current_social_value = COALESCE(base_price, 0) + COALESCE(social_value, 0)
        """,
    ]

    with engine.connect() as conn:
        for idx, statement in enumerate(statements, 1):
            sql = " ".join(statement.split())  # collapse whitespace for logging
            try:
                conn.execute(text(statement))
                conn.commit()
                print(f"✅ Step {idx}/{len(statements)} applied")
            except Exception as exc:
                conn.rollback()
                print(f"⚠️ Step {idx} failed: {exc}")
                raise

    print("🎉 Social value & capitalization migration completed.")


def verify_social_capitalization():
    print("\n🔍 Verifying migration...")
    inspection_sql = text(
        """
        SELECT column_name, data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_name = 'bom_assets'
          AND column_name IN (
            'social_value', 'market_capitalization', 'capitalization_units', 'redistribution_pool'
          )
        ORDER BY column_name
        """
    )

    with engine.connect() as conn:
        results = conn.execute(inspection_sql).fetchall()
        for column_name, data_type, precision, scale in results:
            print(
                f"   • {column_name}: {data_type} ({precision}, {scale})"
            )

        sample_sql = text(
            """
            SELECT id, base_price, social_value, total_value,
                   market_capitalization, capitalization_units, redistribution_pool
            FROM bom_assets
            ORDER BY id
            LIMIT 3
            """
        )
        sample_rows = conn.execute(sample_sql).fetchall()
        print("\n📋 Sample rows (first 3):")
        for row in sample_rows:
            print(f"   {row}")


if __name__ == "__main__":
    migrate_social_capitalization()
    verify_social_capitalization()

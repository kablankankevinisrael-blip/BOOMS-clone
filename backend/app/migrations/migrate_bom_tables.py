# backend/app/migrations/migrate_bom_tables.py
from sqlalchemy import text
import sys
import os

# Ajouter le chemin du projet Python
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.database import engine

def migrate_bom_tables():
    """Ajouter les nouvelles colonnes aux tables Bom existantes"""
    
    print("🚀 Début de la migration des tables Bom...")
    
    try:
        with engine.connect() as conn:
            # Liste des migrations à appliquer
            migrations = [
                # === NOUVELLES COLONNES POUR bom_assets ===
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS artist VARCHAR(100)",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS category VARCHAR(100)", 
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS media_url VARCHAR(500)",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS audio_url VARCHAR(500)",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500)",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS duration INTEGER",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS edition_type VARCHAR(50) DEFAULT 'common'",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS total_editions INTEGER",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS available_editions INTEGER",
                # === COLONNES CAPITALES POUR LE MOTEUR SOCIAL ===
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS social_accumulator NUMERIC(20,4) DEFAULT 0",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS palier_threshold NUMERIC(20,4) DEFAULT 1000000",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS palier_level INTEGER DEFAULT 0",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS applied_micro_value NUMERIC(20,4) DEFAULT 0",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS treasury_pool NUMERIC(20,4) DEFAULT 0",
                "ALTER TABLE bom_assets ADD COLUMN IF NOT EXISTS sell_count_24h INTEGER DEFAULT 0",
            ]
            
            # Appliquer chaque migration
            for i, migration in enumerate(migrations, 1):
                try:
                    conn.execute(text(migration))
                    conn.commit()
                    print(f"✅ [{i}/{len(migrations)}] {migration.split('ADD COLUMN')[1].split('IF NOT')[0].strip()}")
                except Exception as e:
                    print(f"⚠️  Échec migration {i}: {e}")
                    # Continuer avec les migrations suivantes
            
            print("🎉 Migration des tables Bom terminée avec succès!")
            
    except Exception as e:
        print(f"❌ Erreur générale lors de la migration: {e}")

def verify_migration():
    """Vérifier que les colonnes ont été ajoutées"""
    
    print("\n🔍 Vérification de la migration...")
    
    try:
        with engine.connect() as conn:
            # Vérifier les colonnes de bom_assets
            result = conn.execute(text("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'bom_assets' 
                ORDER BY ordinal_position
            """))
            
            columns = [row[0] for row in result]
            print(f"📊 Colonnes disponibles dans bom_assets: {len(columns)}")
            
            # Vérifier les nouvelles colonnes
            new_columns = ['artist', 'category', 'tags', 'media_url', 'audio_url', 
                          'thumbnail_url', 'duration', 'edition_type', 'total_editions', 'available_editions']
            
            for col in new_columns:
                if col in columns:
                    print(f"   ✅ {col}")
                else:
                    print(f"   ❌ {col} - MANQUANT")
                    
    except Exception as e:
        print(f"❌ Erreur lors de la vérification: {e}")

if __name__ == "__main__":
    migrate_bom_tables()
    verify_migration()
"""
Migration pour fixer l'enum userstatus dans PostgreSQL
Crée un nouvel enum avec les bonnes valeurs et migre les données
"""

from sqlalchemy import text, create_engine
from app.config import settings

engine = create_engine(settings.DATABASE_URL)

def fix_user_status_enum():
    """Fixer l'enum userstatus en créant un nouveau type avec les bonnes valeurs"""
    
    with engine.connect() as conn:
        with conn.begin():
            try:
                print("🔍 État actuel de l'enum userstatus...")
                result = conn.execute(text("""
                    SELECT enumlabel 
                    FROM pg_enum 
                    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'userstatus')
                    ORDER BY enumsortorder
                """))
                current_labels = [row[0] for row in result]
                print(f"   Valeurs actuelles: {current_labels}")
                
                # Créer un nouveau type enum avec les bonnes valeurs
                print("\n✨ Création du nouveau type enum...")
                conn.execute(text("DROP TYPE IF EXISTS userstatus_new CASCADE"))
                conn.execute(text("""
                    CREATE TYPE userstatus_new AS ENUM (
                        'active', 'review', 'limited', 'suspended', 'banned'
                    )
                """))
                print("   ✅ Nouveau type créé")
                
                # Migrer les données de l'ancienne colonne à la nouvelle
                print("\n🔄 Migration des données...")
                conn.execute(text("""
                    ALTER TABLE users 
                    ADD COLUMN status_new userstatus_new DEFAULT 'active'
                """))
                print("   ✅ Colonne temporaire créée")
                
                # Copier les données
                conn.execute(text("""
                    UPDATE users 
                    SET status_new = status::text::userstatus_new
                    WHERE status IS NOT NULL
                """))
                print("   ✅ Données migrées")
                
                # Remplacer l'ancienne colonne
                conn.execute(text("""
                    ALTER TABLE users 
                    DROP COLUMN status
                """))
                print("   ✅ Ancienne colonne supprimée")
                
                conn.execute(text("""
                    ALTER TABLE users 
                    RENAME COLUMN status_new TO status
                """))
                print("   ✅ Nouvelle colonne renommée")
                
                # Supprimer l'ancien type
                conn.execute(text("DROP TYPE IF EXISTS userstatus CASCADE"))
                print("   ✅ Ancien type supprimé")
                
                # Renommer le nouveau type
                conn.execute(text("ALTER TYPE userstatus_new RENAME TO userstatus"))
                print("   ✅ Nouveau type renommé")
                
                print("\n✅ Migration réussie!")
                
                # Vérifier le résultat
                result = conn.execute(text("""
                    SELECT enumlabel 
                    FROM pg_enum 
                    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'userstatus')
                    ORDER BY enumsortorder
                """))
                final_labels = [row[0] for row in result]
                print(f"\n📊 Valeurs finales de l'enum: {final_labels}")
                
                result = conn.execute(text("SELECT DISTINCT status FROM users"))
                db_values = [row[0] for row in result]
                print(f"📊 Valeurs dans la table users: {db_values}")
                
            except Exception as e:
                print(f"\n❌ Erreur lors de la migration: {str(e)}")
                import traceback
                traceback.print_exc()
                return False
    
    return True

if __name__ == "__main__":
    success = fix_user_status_enum()
    exit(0 if success else 1)

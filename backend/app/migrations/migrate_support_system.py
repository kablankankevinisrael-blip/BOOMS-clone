# backend/app/migrations/migrate_support_system.py
from sqlalchemy import text
import sys
import os

# Ajouter le chemin du projet Python
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from app.database import engine

def migrate_support_system():
    """Ajouter les tables support et colonnes status aux users"""
    
    print("🚀 Début de la migration du système support...")
    
    try:
        with engine.connect() as conn:
            # Liste des migrations à appliquer
            migrations = [
                # === NOUVELLES COLONNES POUR users ===
                """ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMP""",
                """ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_count INTEGER DEFAULT 0""",
                """ALTER TABLE users ADD COLUMN IF NOT EXISTS last_suspension_at TIMESTAMP""",
                """ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP""",
                """ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_by INTEGER REFERENCES users(id)""",
                
                # === TABLE support_tickets ===
                """CREATE TABLE IF NOT EXISTS support_tickets (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    subject VARCHAR(255) NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    priority VARCHAR(20) DEFAULT 'normal',
                    status VARCHAR(20) DEFAULT 'open',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    assigned_to INTEGER REFERENCES users(id),
                    resolved_at TIMESTAMP,
                    closed_at TIMESTAMP,
                    metadata JSONB DEFAULT '{}'::jsonb
                )""",
                
                """CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id)""",
                """CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status)""",
                """CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON support_tickets(assigned_to)""",
                
                # === TABLE support_messages ===
                """CREATE TABLE IF NOT EXISTS support_messages (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
                    sender_id INTEGER NOT NULL REFERENCES users(id),
                    message TEXT NOT NULL,
                    is_admin_response BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    read_at TIMESTAMP,
                    attachments JSONB DEFAULT '[]'::jsonb
                )""",
                
                """CREATE INDEX IF NOT EXISTS idx_messages_ticket ON support_messages(ticket_id)""",
                """CREATE INDEX IF NOT EXISTS idx_messages_sender ON support_messages(sender_id)""",
                
                # === TABLE banned_user_messages (messagerie séparée pour comptes bannis) ===
                """CREATE TABLE IF NOT EXISTS banned_user_messages (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    user_phone VARCHAR(255),
                    user_email VARCHAR(255),
                    message TEXT NOT NULL,
                    admin_response TEXT,
                    status VARCHAR(20) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    responded_at TIMESTAMP,
                    responded_by INTEGER REFERENCES users(id),
                    metadata JSONB DEFAULT '{}'::jsonb
                )""",
                
                """CREATE INDEX IF NOT EXISTS idx_banned_messages_user ON banned_user_messages(user_id)""",
                """CREATE INDEX IF NOT EXISTS idx_banned_messages_status ON banned_user_messages(status)""",
            ]
            
            # Appliquer chaque migration
            for i, migration in enumerate(migrations, 1):
                try:
                    conn.execute(text(migration))
                    conn.commit()
                    # Afficher un résumé sans tout le SQL
                    if "ALTER TABLE" in migration:
                        col_name = migration.split("ADD COLUMN IF NOT EXISTS")[1].split()[0] if "ADD COLUMN" in migration else "status column"
                        print(f"✅ [{i}/{len(migrations)}] Colonne users.{col_name}")
                    elif "CREATE TABLE" in migration:
                        table_name = migration.split("CREATE TABLE IF NOT EXISTS")[1].split()[0]
                        print(f"✅ [{i}/{len(migrations)}] Table {table_name}")
                    elif "CREATE INDEX" in migration:
                        idx_name = migration.split("CREATE INDEX IF NOT EXISTS")[1].split()[0]
                        print(f"✅ [{i}/{len(migrations)}] Index {idx_name}")
                except Exception as e:
                    print(f"⚠️  Échec migration {i}: {e}")
                    # Continuer avec les migrations suivantes
            
            print("🎉 Migration du système support terminée avec succès!")
            
    except Exception as e:
        print(f"❌ Erreur générale lors de la migration: {e}")

def verify_migration():
    """Vérifier que les tables et colonnes ont été créées"""
    
    print("\n🔍 Vérification de la migration...")
    
    try:
        with engine.connect() as conn:
            # Vérifier les colonnes de users
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                AND column_name IN ('suspended_until', 'suspension_count', 'last_suspension_at', 'banned_at', 'banned_by')
            """))
            
            user_cols = [row[0] for row in result]
            print(f"📊 Nouvelles colonnes users: {len(user_cols)}/5")
            for col in ['suspended_until', 'suspension_count', 'last_suspension_at', 'banned_at', 'banned_by']:
                status = "✅" if col in user_cols else "❌"
                print(f"   {status} {col}")
            
            # Vérifier les tables
            result = conn.execute(text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('support_tickets', 'support_messages', 'banned_user_messages')
            """))
            
            tables = [row[0] for row in result]
            print(f"\n📊 Tables support: {len(tables)}/3")
            for table in ['support_tickets', 'support_messages', 'banned_user_messages']:
                status = "✅" if table in tables else "❌"
                print(f"   {status} {table}")
                    
    except Exception as e:
        print(f"❌ Erreur lors de la vérification: {e}")

if __name__ == "__main__":
    migrate_support_system()
    verify_migration()

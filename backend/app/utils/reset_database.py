# Créer un script de réinitialisation
# backend/app/utils/reset_database.py

from app.database import engine, Base
from app.models import user_models, bom_models, gift_models, notification_models

def reset_database():
    """Supprime et recrée toutes les tables"""
    print("🗑️  Suppression de toutes les tables...")
    Base.metadata.drop_all(bind=engine)
    
    print("🔄 Création des tables...")
    Base.metadata.create_all(bind=engine)
    
    print("✅ Base de données réinitialisée avec succès!")

if __name__ == "__main__":
    reset_database()
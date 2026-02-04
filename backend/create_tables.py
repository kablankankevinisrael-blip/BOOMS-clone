import sys
import os

# Ajouter le chemin du backend
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import engine
from app.models.user_models import Base
from app.models.bom_models import Base as BomBase

def create_tables():
    """Crée toutes les tables dans la base de données"""
    print("🔄 Création des tables...")
    
    # Créer toutes les tables
    Base.metadata.create_all(bind=engine)
    BomBase.metadata.create_all(bind=engine)
    
    print("✅ Tables créées avec succès!")
    print("📊 Tables disponibles:")
    for table in Base.metadata.tables:
        print(f"   - {table}")
    for table in BomBase.metadata.tables:
        print(f"   - {table}")

if __name__ == "__main__":
    create_tables()
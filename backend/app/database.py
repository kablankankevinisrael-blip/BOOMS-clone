from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings
import time
import sys
import os

# Force UTF-8 encoding for console output on Windows
if sys.platform == 'win32':
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    sys.stdout.reconfigure(encoding='utf-8')

# Configuration de la base de données
try:
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True
    )
    
    # Test de connexion
    with engine.connect() as conn:
        print("✅ Connexion à PostgreSQL réussie!")
        print(f"📍 Base de données: booms_db sur le port 5433")
        
except Exception as e:
    print(f"❌ Erreur de connexion à la base: {e}")
    print("💡 Vérifie ton mot de passe PostgreSQL dans le fichier .env")
    sys.exit(1)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
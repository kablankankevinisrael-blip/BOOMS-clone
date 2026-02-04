import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy.orm import Session
from app.database import SessionLocal, engine
from app.models.user_models import User
from app.services.auth import get_password_hash

def create_admin_account():
    """Créer un compte administrateur"""
    db = SessionLocal()
    
    try:
        # Vérifier si l'admin existe déjà
        existing_admin = db.query(User).filter(User.phone == "0758647383").first()
        
        if existing_admin:
            print("⚠️  L'administrateur existe déjà!")
            print(f"   ID: {existing_admin.id}")
            print(f"   Nom: {existing_admin.full_name}")
            print(f"   Admin: {existing_admin.is_admin}")
            
            # Mettre à jour pour être sûr que c'est un admin
            existing_admin.is_admin = True
            existing_admin.is_active = True
            db.commit()
            print("✅ Compte admin mis à jour")
            
            # Afficher le mot de passe si c'est le mot de passe par défaut
            print("\n🔐 Pour tester la connexion:")
            print("   Téléphone: 0758647383")
            print("   Mot de passe: admin123 (ou le mot de passe défini précédemment)")
        else:
            # Créer un nouvel admin
            admin = User(
                phone="0758647383",
                email="admin@booms.com",
                full_name="Administrateur Booms",
                is_admin=True,
                is_active=True,
                kyc_status="verified"
            )
            
            # Définir le mot de passe
            admin.set_password("admin123")
            
            db.add(admin)
            db.commit()
            db.refresh(admin)
            
            print("✅ Compte administrateur créé avec succès!")
            print(f"\n🔐 Identifiants de connexion:")
            print(f"   Téléphone: 0758647383")
            print(f"   Mot de passe: admin123")
            print(f"   ID: {admin.id}")
            print(f"   Nom: {admin.full_name}")
        
    except Exception as e:
        print(f"❌ Erreur: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    print("🔧 Création du compte administrateur...")
    create_admin_account()
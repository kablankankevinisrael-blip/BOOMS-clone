from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.user_models import User, Wallet
from app.models.bom_models import BomAsset
from app.services.auth import get_password_hash

def seed_initial_data():
    """Peupler la base avec des données réalistes"""
    db = SessionLocal()
    
    try:
        print("🌱 Début du peuplement des données...")
        
        # 1. Créer des utilisateurs de test
        users_data = [
            {
                "phone": "0102030405", 
                "password": "password123",
                "full_name": "Alice Martin",
                "email": "alice@example.com"
            },
            {
                "phone": "0607080910",
                "password": "password123", 
                "full_name": "Bob Dupont",
                "email": "bob@example.com"
            },
            {
                "phone": "0708091011", 
                "password": "password123",
                "full_name": "Charlie Wilson",
                "email": "charlie@example.com"
            }
        ]
        
        for user_data in users_data:
            user = db.query(User).filter(User.phone == user_data["phone"]).first()
            if not user:
                user = User(
                    phone=user_data["phone"],
                    full_name=user_data["full_name"],
                    email=user_data["email"]
                )
                user.set_password(user_data["password"])
                db.add(user)
                db.flush()
                
                # Créer le portefeuille
                wallet = Wallet(user_id=user.id, balance=1000.00)
                db.add(wallet)
        
        # 2. Créer des Boms réalistes
        boms_data = [
            {
                "title": "Carte cadeau Amazon 50€",
                "description": "Carte cadeau Amazon valable sur tous les produits",
                "image_url": "https://via.placeholder.com/150/007AFF/FFFFFF?text=Amazon",
                "value": 50.00,
                "cost": 45.00,
                "stock": 100
            },
            {
                "title": "Abonnement Spotify 3 mois",
                "description": "Abonnement Spotify Premium pour 3 mois",
                "image_url": "https://via.placeholder.com/150/1DB954/FFFFFF?text=Spotify", 
                "value": 29.97,
                "cost": 25.00,
                "stock": 50
            },
            {
                "title": "Carte Uber Eats 25€",
                "description": "Carte cadeau pour commander de la nourriture",
                "image_url": "https://via.placeholder.com/150/000000/FFFFFF?text=UberEats",
                "value": 25.00,
                "cost": 22.50,
                "stock": 75
            },
            {
                "title": "Netflix 1 mois",
                "description": "Abonnement Netflix Standard pour 1 mois",
                "image_url": "https://via.placeholder.com/150/E50914/FFFFFF?text=Netflix",
                "value": 15.99,
                "cost": 13.50,
                "stock": 60
            }
        ]
        
        for bom_data in boms_data:
            bom = db.query(BomAsset).filter(BomAsset.title == bom_data["title"]).first()
            if not bom:
                bom = BomAsset(**bom_data)
                db.add(bom)
        
        db.commit()
        print("✅ Données initiales créées avec succès!")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Erreur lors du peuplement: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_initial_data()
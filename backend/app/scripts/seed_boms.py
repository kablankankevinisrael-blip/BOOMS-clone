import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models.bom_models import BomAsset, UserBom
from app.models.user_models import User
from sqlalchemy.orm import Session

def seed_boms(db: Session):
    """Ajouter des Boms de démo dans la base de données"""
    
    # Boms de démo variés
    demo_boms = [
        # Cartes cadeaux
        {
            "title": "Carte cadeau Amazon 50€",
            "description": "Carte cadeau Amazon d'une valeur de 50€",
            "value": 50.00,
            "cost": 45.00,
            "image_url": "https://via.placeholder.com/300/007AFF/FFFFFF?text=Amazon",
            "is_active": True,
            "stock": 100
        },
        {
            "title": "Carte cadeau FNAC 30€", 
            "description": "Carte cadeau FNAC pour livres, musique et high-tech",
            "value": 30.00,
            "cost": 27.00,
            "image_url": "https://via.placeholder.com/300/FF6B6B/FFFFFF?text=FNAC",
            "is_active": True,
            "stock": 100
        },
        {
            "title": "Carte Uber Eats 25€",
            "description": "Carte cadeau pour commander de la nourriture",
            "value": 25.00,
            "cost": 22.50,
            "image_url": "https://via.placeholder.com/300/000000/FFFFFF?text=UberEats",
            "is_active": True,
            "stock": 100
        },
        
        # Abonnements
        {
            "title": "Abonnement Spotify 3 mois",
            "description": "Abonnement Spotify Premium pour 3 mois",
            "value": 29.97,
            "cost": 25.00,
            "image_url": "https://via.placeholder.com/300/1DB954/FFFFFF?text=Spotify",
            "is_active": True,
            "stock": 50
        },
        {
            "title": "Abonnement Netflix 1 mois",
            "description": "Abonnement Netflix Standard pour 1 mois",
            "value": 15.99,
            "cost": 13.50,
            "image_url": "https://via.placeholder.com/300/E50914/FFFFFF?text=Netflix",
            "is_active": True,
            "stock": 50
        },
        {
            "title": "Abonnement Disney+ 2 mois",
            "description": "Abonnement Disney+ pour 2 mois",
            "value": 17.98,
            "cost": 15.00,
            "image_url": "https://via.placeholder.com/300/113CCF/FFFFFF?text=Disney+",
            "is_active": True,
            "stock": 50
        },
        
        # Jeux vidéo
        {
            "title": "Carte PSN 20€",
            "description": "Carte cadeau PlayStation Network 20€",
            "value": 20.00,
            "cost": 18.00,
            "image_url": "https://via.placeholder.com/300/003791/FFFFFF?text=PSN",
            "is_active": True,
            "stock": 75
        },
        {
            "title": "Carte Xbox Live 25€",
            "description": "Carte cadeau Microsoft Xbox 25€",
            "value": 25.00,
            "cost": 22.50,
            "image_url": "https://via.placeholder.com/300/107C10/FFFFFF?text=Xbox",
            "is_active": True,
            "stock": 75
        },
        {
            "title": "Carte Steam 50€",
            "description": "Carte cadeau Steam pour jeux PC",
            "value": 50.00,
            "cost": 45.00,
            "image_url": "https://via.placeholder.com/300/000000/FFFFFF?text=Steam",
            "is_active": True,
            "stock": 75
        },
        
        # Mode & Beauté
        {
            "title": "Carte Sephora 40€",
            "description": "Carte cadeau Sephora pour produits beauté",
            "value": 40.00,
            "cost": 36.00,
            "image_url": "https://via.placeholder.com/300/FF2DBC/FFFFFF?text=Sephora",
            "is_active": True,
            "stock": 60
        },
        {
            "title": "Carte Zara 35€",
            "description": "Carte cadeau Zara pour vêtements et accessoires",
            "value": 35.00,
            "cost": 31.50,
            "image_url": "https://via.placeholder.com/300/000000/FFFFFF?text=Zara",
            "is_active": True,
            "stock": 60
        },
        
        # Restaurants
        {
            "title": "Carte Starbucks 15€",
            "description": "Carte cadeau Starbucks pour cafés et snacks",
            "value": 15.00,
            "cost": 13.50,
            "image_url": "https://via.placeholder.com/300/006241/FFFFFF?text=Starbucks",
            "is_active": True,
            "stock": 80
        },
        {
            "title": "Carte McDonald's 20€", 
            "description": "Carte cadeau McDonald's pour repas rapides",
            "value": 20.00,
            "cost": 18.00,
            "image_url": "https://via.placeholder.com/300/FFBC0D/000000?text=McDo",
            "is_active": True,
            "stock": 80
        },
        
        # High-Tech
        {
            "title": "Carte Apple Store 100€",
            "description": "Carte cadeau Apple Store pour produits Apple",
            "value": 100.00,
            "cost": 90.00,
            "image_url": "https://via.placeholder.com/300/000000/FFFFFF?text=Apple",
            "is_active": True,
            "stock": 25
        },
        {
            "title": "Carte Google Play 15€",
            "description": "Carte cadeau Google Play pour apps et contenu",
            "value": 15.00,
            "cost": 13.50,
            "image_url": "https://via.placeholder.com/300/4285F4/FFFFFF?text=Google",
            "is_active": True,
            "stock": 80
        },
        
        # Voyage
        {
            "title": "Carte Booking.com 75€",
            "description": "Carte cadeau pour réserver des hôtels",
            "value": 75.00,
            "cost": 67.50,
            "image_url": "https://via.placeholder.com/300/003580/FFFFFF?text=Booking",
            "is_active": True,
            "stock": 40
        },
        {
            "title": "Carte Uber 30€",
            "description": "Carte cadeau pour courses Uber et UberX",
            "value": 30.00,
            "cost": 27.00,
            "image_url": "https://via.placeholder.com/300/000000/FFFFFF?text=Uber",
            "is_active": True,
            "stock": 70
        },
        
        # Sport
        {
            "title": "Carte Decathlon 40€",
            "description": "Carte cadeau Decathlon pour équipement sportif",
            "value": 40.00,
            "cost": 36.00,
            "image_url": "https://via.placeholder.com/300/005CA9/FFFFFF?text=Decathlon",
            "is_active": True,
            "stock": 60
        },
        {
            "title": "Abonnement Basic-Fit 1 mois",
            "description": "Abonnement salle de sport Basic-Fit 1 mois",
            "value": 24.99,
            "cost": 22.00,
            "image_url": "https://via.placeholder.com/300/FF671F/FFFFFF?text=BasicFit",
            "is_active": True,
            "stock": 50
        },
        
        # Culture
        {
            "title": "Carte Furet du Nord 25€",
            "description": "Carte cadeau librairie Furet du Nord",
            "value": 25.00,
            "cost": 22.50,
            "image_url": "https://via.placeholder.com/300/8B4513/FFFFFF?text=Librairie",
            "is_active": True,
            "stock": 70
        }
    ]
    
    # Vérifier si des Boms existent déjà
    existing_boms = db.query(BomAsset).count()
    if existing_boms > 0:
        print(f"⚠️ {existing_boms} Boms existent déjà, suppression et recréation...")
        db.query(UserBom).delete()
        db.query(BomAsset).delete()
        db.commit()
    
    # Ajouter les Boms
    for bom_data in demo_boms:
        bom = BomAsset(**bom_data)
        db.add(bom)
    
    db.commit()
    print(f"✅ {len(demo_boms)} Boms de démo ajoutés avec succès!")
    
    # Ajouter quelques Boms à l'utilisateur Arthur (ID 3) pour tester
    user = db.query(User).filter(User.id == 3).first()
    if user:
        # Ajouter 3 Boms aléatoires à l'utilisateur - SANS quantity
        sample_boms = db.query(BomAsset).limit(3).all()
        for bom in sample_boms:
            user_bom = UserBom(
                user_id=user.id,
                bom_id=bom.id,
                is_transferable=True
            )
            db.add(user_bom)
        
        db.commit()
        print(f"✅ 3 Boms ajoutés à l'inventaire de {user.full_name}")

if __name__ == "__main__":
    db = SessionLocal()
    try:
        seed_boms(db)
    except Exception as e:
        print(f"❌ Erreur: {e}")
        db.rollback()
    finally:
        db.close()
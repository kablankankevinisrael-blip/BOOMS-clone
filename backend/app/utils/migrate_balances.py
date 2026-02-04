from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import SessionLocal
from app.models.bom_models import UserBom, BomAsset
from app.models.payment_models import CashBalance
from decimal import Decimal

def migrate_existing_balances():
    """Migrer les soldes existants vers le nouveau système"""
    db = SessionLocal()
    
    try:
        # Utiliser des requêtes SQL brutes pour éviter les problèmes d'enum
        print("🔧 Lecture des utilisateurs via SQL brute...")
        
        # Lire les IDs des utilisateurs sans passer par l'ORM (qui causerait des problèmes d'enum)
        result = db.execute(text("SELECT id FROM users"))
        user_ids = [row[0] for row in result]
        print(f"   ✅ {len(user_ids)} utilisateurs trouvés")
        
        migrated_count = 0
        
        for user_id in user_ids:
            # Vérifier si l'utilisateur a déjà un cash balance
            existing_balance = db.query(CashBalance).filter(CashBalance.user_id == user_id).first()
            if existing_balance:
                print(f"⚠️ CashBalance existe déjà pour l'utilisateur {user_id}")
                continue
            
            # Calculer la valeur totale des Boms
            user_boms = db.query(UserBom).filter(UserBom.user_id == user_id).all()
            total_bom_value = Decimal('0.00')
            
            print(f"🔍 Calcul valeur Boms pour l'utilisateur {user_id}: {len(user_boms)} Boms trouvés")
            
            for user_bom in user_boms:
                bom_asset = db.query(BomAsset).filter(BomAsset.id == user_bom.bom_id).first()
                if bom_asset and bom_asset.is_active:
                    total_bom_value += bom_asset.value
                    print(f"  💎 Bom {bom_asset.title}: {bom_asset.value} FCFA")
            
            # Créer le cash balance avec la valeur des Boms
            cash_balance = CashBalance(
                user_id=user_id,
                available_balance=total_bom_value,
                currency="FCFA"
            )
            db.add(cash_balance)
            migrated_count += 1
            
            print(f"✅ CashBalance créé pour l'utilisateur {user_id}: {total_bom_value} FCFA")
        
        db.commit()
        print(f"🎉 Migration terminée: {migrated_count} utilisateurs migrés sur {len(user_ids)} total")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Erreur migration: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    migrate_existing_balances()
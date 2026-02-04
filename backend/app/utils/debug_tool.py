import os
import sys
import inspect
from sqlalchemy import inspect as sql_inspect
from app.database import SessionLocal, Base, engine
from app.models import user_models, bom_models, gift_models, notification_models

def debug_entire_project():
    """Debug complet de tout le projet Booms"""
    print("\n" + "="*80)
    print("🔧 DEBUG COMPLET BOOMS - ANALYSE SYSTÈME")
    print("="*80)
    
    # 1. Analyse des modèles de base de données
    debug_database_models()
    
    # 2. Analyse des tables existantes
    debug_database_tables()
    
    # 3. Analyse des routes et endpoints
    debug_routes()
    
    # 4. Test des services principaux
    debug_services()
    
    print("="*80)
    print("✅ DEBUG COMPLET TERMINÉ")
    print("="*80)

def debug_database_models():
    """Analyse détaillée de tous les modèles"""
    print("\n📊 1. ANALYSE DES MODÈLES DE BASE DE DONNÉES")
    print("-" * 50)
    
    models = [user_models, bom_models, gift_models, notification_models]
    
    for model_module in models:
        print(f"\n📁 Module: {model_module.__name__}")
        for name, obj in inspect.getmembers(model_module):
            if inspect.isclass(obj) and hasattr(obj, '__tablename__'):
                print(f"  🗂️  Table: {obj.__tablename__}")
                inspector = sql_inspect(obj)
                for column in inspector.columns:
                    print(f"    📋 {column.name}: {column.type} - Nullable: {column.nullable}")

def debug_database_tables():
    """Vérifie les tables existantes en base - VERSION CORRIGÉE"""
    print("\n🗃️ 2. TABLES EXISTANTES EN BASE DE DONNÉES")
    print("-" * 50)
    
    try:
        with engine.connect() as conn:
            # ✅ CORRECTION: Utiliser text() pour les requêtes SQL
            from sqlalchemy import text
            
            result = conn.execute(text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name
            """))
            tables = [row[0] for row in result]
            print(f"✅ {len(tables)} tables trouvées:")
            for table in tables:
                print(f"   📊 {table}")
                
                # Compte les lignes dans chaque table
                count_result = conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
                count = count_result.scalar()
                print(f"     📈 {count} enregistrements")
                
    except Exception as e:
        print(f"❌ Erreur analyse tables: {e}")

def debug_routes():
    """Analyse des routes API disponibles"""
    print("\n🌐 3. ANALYSE DES ROUTES API")
    print("-" * 50)
    
    try:
        from app.main import app
        routes = []
        for route in app.routes:
            if hasattr(route, 'methods'):
                methods = ', '.join(route.methods) if route.methods else 'GET'
                routes.append({
                    'path': route.path,
                    'methods': methods,
                    'name': getattr(route, 'name', 'N/A')
                })
        
        print(f"✅ {len(routes)} routes trouvées:")
        for route in sorted(routes, key=lambda x: x['path']):
            print(f"   🚀 {route['methods']:6} {route['path']}")
            
    except Exception as e:
        print(f"❌ Erreur analyse routes: {e}")

def debug_services():
    """Test des services principaux"""
    print("\n⚙️ 4. TEST DES SERVICES PRINCIPAUX")
    print("-" * 50)
    
    db = SessionLocal()
    try:
        # Test service utilisateurs
        from app.services.auth import get_password_hash
        print("🔐 Service auth: OK" if get_password_hash("test") else "❌ Service auth: Échec")
        
        # Test service wallet
        from app.services.wallet_service import get_wallet_balance
        try:
            balance = get_wallet_balance(db, 1)
            print("💰 Service wallet: OK")
        except:
            print("💰 Service wallet: Échec (mais peut être normal)")
            
        # Test service purchase
        from app.services.purchase_service import get_user_inventory
        try:
            inventory = get_user_inventory(db, 1)
            print(f"🛒 Service purchase: OK ({len(inventory)} items)")
        except Exception as e:
            print(f"❌ Service purchase: Échec - {e}")
            
        # Test service gift
        from app.services.gift_service import get_gift_history
        try:
            gifts = get_gift_history(db, 1)
            print(f"🎁 Service gift: OK ({len(gifts)} cadeaux)")
        except Exception as e:
            print(f"❌ Service gift: Échec - {e}")
            
    except Exception as e:
        print(f"❌ Erreur générale services: {e}")
    finally:
        db.close()

def debug_specific_user(user_id: int):
    """Debug spécifique pour un utilisateur - VERSION CORRIGÉE"""
    print(f"\n👤 DEBUG UTILISATEUR {user_id}")
    print("-" * 50)
    
    db = SessionLocal()
    try:
        from app.models.user_models import User, Wallet
        from app.models.bom_models import UserBom  # ← CORRECTION
        from app.models.gift_models import GiftTransaction
        
        # Informations utilisateur
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            print(f"✅ Utilisateur trouvé: {user.full_name} ({user.phone})")
            
            # Portefeuille
            wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
            print(f"💰 Portefeuille: {wallet.balance if wallet else 'N/A'} {wallet.currency if wallet else ''}")
            
            # ✅ CORRECTION: Inventaire ACTIF seulement
            inventory = db.query(UserBom).filter(
                UserBom.user_id == user_id,
                UserBom.transferred_at.is_(None)  # ← PATCH APPLIQUÉ
            ).all()
            print(f"🎁 Inventaire ACTIF: {len(inventory)} Boms (transferred_at IS NULL)")
            for item in inventory:
                print(f"   📦 Bom ID: {item.bom_id}")
                
            # Cadeaux
            sent_gifts = db.query(GiftTransaction).filter(GiftTransaction.sender_id == user_id).all()
            received_gifts = db.query(GiftTransaction).filter(GiftTransaction.receiver_id == user_id).all()
            print(f"🎁 Cadeaux envoyés: {len(sent_gifts)}")
            print(f"🎁 Cadeaux reçus: {len(received_gifts)}")
            
        else:
            print(f"❌ Utilisateur {user_id} non trouvé")
            
    except Exception as e:
        print(f"❌ Erreur debug utilisateur: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "user":
        user_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        debug_specific_user(user_id)
    else:
        debug_entire_project()
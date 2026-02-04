"""
🔧 FIX: Normaliser les valeurs UserStatus en BD
Problème: BD a 'active' (string) mais SQLAlchemy attend enum UserStatus
Solution: Assurer que toutes les valeurs sont 'active', 'review', 'limited', 'suspended', 'banned' (minuscules)
"""

from sqlalchemy import text, create_engine
from app.config import settings
import sys

engine = create_engine(settings.DATABASE_URL)

def fix_user_status_data():
    """Fixer les valeurs d'énums dans la table users"""
    
    print("🔧 [FIX USER STATUS] Début de la normalisation...")
    
    with engine.connect() as conn:
        with conn.begin():
            try:
                # 1. Vérifier l'état actuel
                print("\n📊 État actuel des statuts utilisateurs:")
                result = conn.execute(text("""
                    SELECT status, COUNT(*) as count
                    FROM users
                    GROUP BY status
                    ORDER BY status
                """))
                for row in result:
                    print(f"   {row[0]}: {row[1]} utilisateurs")
                
                # 2. Normaliser les valeurs en minuscules
                print("\n🔄 Normalisation des statuts...")
                
                # Convertir ACTIVE → active
                conn.execute(text("""
                    UPDATE users 
                    SET status = 'active'::userstatus 
                    WHERE UPPER(status::text) = 'ACTIVE' OR status::text = 'ACTIVE'
                """))
                print("   ✅ ACTIVE normalisés")
                
                # Convertir REVIEW → review
                conn.execute(text("""
                    UPDATE users 
                    SET status = 'review'::userstatus 
                    WHERE UPPER(status::text) = 'REVIEW' OR status::text = 'REVIEW'
                """))
                print("   ✅ REVIEW normalisés")
                
                # Convertir LIMITED → limited
                conn.execute(text("""
                    UPDATE users 
                    SET status = 'limited'::userstatus 
                    WHERE UPPER(status::text) = 'LIMITED' OR status::text = 'LIMITED'
                """))
                print("   ✅ LIMITED normalisés")
                
                # Convertir SUSPENDED → suspended
                conn.execute(text("""
                    UPDATE users 
                    SET status = 'suspended'::userstatus 
                    WHERE UPPER(status::text) = 'SUSPENDED' OR status::text = 'SUSPENDED'
                """))
                print("   ✅ SUSPENDED normalisés")
                
                # Convertir BANNED → banned
                conn.execute(text("""
                    UPDATE users 
                    SET status = 'banned'::userstatus 
                    WHERE UPPER(status::text) = 'BANNED' OR status::text = 'BANNED'
                """))
                print("   ✅ BANNED normalisés")
                
                # 3. Vérifier le résultat
                print("\n✅ Vérification post-normalisation:")
                result = conn.execute(text("""
                    SELECT status, COUNT(*) as count
                    FROM users
                    GROUP BY status
                    ORDER BY status
                """))
                for row in result:
                    print(f"   {row[0]}: {row[1]} utilisateurs")
                
                print("\n✅ ✅ ✅ NORMALISATION TERMINÉE AVEC SUCCÈS!")
                return True
                
            except Exception as e:
                print(f"\n❌ ERREUR lors de la normalisation: {e}")
                print(f"   Type: {type(e).__name__}")
                import traceback
                traceback.print_exc()
                return False

if __name__ == "__main__":
    print("""
╔════════════════════════════════════════════════════════════════╗
║  🔧 CORRECTION: Normaliser les valeurs UserStatus en BD       ║
║  Problème: 'active' (string) vs UserStatus.ACTIVE (enum)     ║
╚════════════════════════════════════════════════════════════════╝
    """)
    
    success = fix_user_status_data()
    
    if success:
        print("\n✅ Les données sont maintenant correctes pour le login!")
        print("🚀 Vous pouvez à présent tester le login sans erreur d'enum")
        sys.exit(0)
    else:
        print("\n❌ La normalisation a échoué!")
        sys.exit(1)

"""
Migration pour corriger les valeurs d'enum userstatus
Les anciennes données pouvaient contenir 'active' mais l'enum n'accepte maintenant que les valeurs en minuscule
"""

from sqlalchemy import text
from app.database import SessionLocal

def fix_user_status_enum():
    """Corriger les valeurs d'enum userstatus dans la base de données"""
    db = SessionLocal()
    
    try:
        # Lister les valeurs uniques actuelles
        result = db.execute(text("SELECT DISTINCT status FROM users"))
        current_values = [row[0] for row in result]
        print(f"📊 Valeurs actuelles du statut utilisateur: {current_values}")
        
        # Mapping des anciennes valeurs vers les nouvelles
        mapping = {
            'active': 'active',
            'ACTIVE': 'active',
            'review': 'review',
            'REVIEW': 'review',
            'limited': 'limited',
            'LIMITED': 'limited',
            'suspended': 'suspended',
            'SUSPENDED': 'suspended',
            'banned': 'banned',
            'BANNED': 'banned',
        }
        
        # Corriger chaque valeur
        for old_value, new_value in mapping.items():
            if old_value != new_value and old_value in current_values:
                query = text(f"UPDATE users SET status = '{new_value}' WHERE status = '{old_value}'")
                db.execute(query)
                print(f"✅ Changé: {old_value} → {new_value}")
        
        db.commit()
        
        # Vérifier les résultats
        result = db.execute(text("SELECT DISTINCT status FROM users"))
        final_values = [row[0] for row in result]
        print(f"✅ Valeurs finales du statut utilisateur: {final_values}")
        
        print("🎉 Migration du statut utilisateur réussie!")
        return True
        
    except Exception as e:
        db.rollback()
        print(f"❌ Erreur lors de la migration: {str(e)}")
        return False
    finally:
        db.close()

if __name__ == "__main__":
    fix_user_status_enum()

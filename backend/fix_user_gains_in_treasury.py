"""
Script de correction: Soustraire les gains utilisateurs du solde de trésorerie
pour tous les retraits BOOM passés qui n'ont pas été comptabilisés correctement.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models.transaction_models import Transaction
from app.models.payment_models import PaymentTransaction
from app.models.admin_models import PlatformTreasury
from decimal import Decimal
import re
from datetime import datetime, timezone

def fix_user_gains():
    db = SessionLocal()
    try:
        print("🔍 Analysant les retraits BOOM pour calculer les gains utilisateurs...")
        
        # Chercher tous les retraits BOOM depuis PaymentTransaction
        boom_withdrawals = db.query(PaymentTransaction).filter(
            PaymentTransaction.type.in_(["bom_withdrawal", "boom_withdrawal"])
        ).all()
        
        total_user_gains_to_deduct = Decimal('0.00')
        
        for withdrawal in boom_withdrawals:
            print(f"\n📌 Retrait: {withdrawal.id}")
            print(f"   Utilisateur: {withdrawal.user_id}")
            print(f"   Montant: {withdrawal.amount} FCFA")
            print(f"   Description: {withdrawal.description}")
            
            # Chercher le prix d'achat original du BOOM
            # Regarder dans la description du retrait si on trouve le gain utilisateur
            if withdrawal.description:
                gain_match = re.search(r'Gain utilisateur:\s*([\d,]+\.?\d*)', withdrawal.description, re.IGNORECASE)
                if gain_match:
                    user_gain = Decimal(gain_match.group(1).replace(',', ''))
                    print(f"   ✅ Gain utilisateur trouvé: {user_gain} FCFA")
                    total_user_gains_to_deduct += user_gain
                else:
                    # Sinon, calculer basé sur la correspondance achat/retrait
                    user_gain_calc = calculate_user_gain_from_purchase(db, withdrawal)
                    if user_gain_calc > 0:
                        print(f"   ✅ Gain utilisateur calculé: {user_gain_calc} FCFA")
                        total_user_gains_to_deduct += user_gain_calc
        
        # Mettre à jour le solde de trésorerie
        if total_user_gains_to_deduct > 0:
            treasury = db.query(PlatformTreasury).first()
            if treasury:
                old_balance = treasury.balance
                treasury.balance -= total_user_gains_to_deduct
                db.commit()
                
                print(f"\n✅ CORRECTION APPLIQUÉE:")
                print(f"   Ancien solde: {old_balance} FCFA")
                print(f"   Gains utilisateurs à deduire: {total_user_gains_to_deduct} FCFA")
                print(f"   Nouveau solde: {treasury.balance} FCFA")
            else:
                print("❌ Trésorerie non trouvée!")
        else:
            print(f"\n✅ Aucun gain utilisateur à deduire (total: {total_user_gains_to_deduct} FCFA)")
        
    except Exception as e:
        print(f"❌ Erreur: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

def calculate_user_gain_from_purchase(db, withdrawal):
    """Calculer le gain utilisateur en cherchant le boom_purchase correspondant"""
    try:
        # Chercher la transaction achat du même utilisateur et BOOM
        purchase_tx = db.query(Transaction).filter(
            Transaction.user_id == withdrawal.user_id,
            Transaction.transaction_type == "boom_purchase",
            Transaction.created_at < withdrawal.created_at
        ).order_by(Transaction.created_at.desc()).first()
        
        if purchase_tx and purchase_tx.description:
            social_value_match = re.search(r'Valeur\s*sociale:\s*([\d,]+\.?\d*)', purchase_tx.description, re.IGNORECASE)
            if social_value_match:
                purchase_price = Decimal(social_value_match.group(1).replace(',', ''))
                withdrawal_amount = abs(Decimal(str(withdrawal.amount or '0')))
                user_gain = withdrawal_amount - purchase_price
                
                print(f"      📊 Calcul: {withdrawal_amount} - {purchase_price} = {user_gain} FCFA")
                
                if user_gain > 0:
                    return user_gain
    except Exception as e:
        print(f"   Erreur lors du calcul: {e}")
    
    return Decimal('0')

if __name__ == "__main__":
    print("=" * 80)
    print("FIX: Soustraire les gains utilisateurs du solde de trésorerie")
    print("=" * 80)
    fix_user_gains()

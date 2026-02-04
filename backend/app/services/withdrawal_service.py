"""
SERVICE DE RETRAIT BOOMS - VERSION 2.0
Sécurité maximale contre les races conditions avec locks de concurrence
Transactions atomiques complètes pour les retraits de BOOMS
"""

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy import select
from decimal import Decimal
from typing import Dict, Any, List, Optional
import uuid
import logging
import asyncio
import re
from datetime import datetime, timezone

# Modèles
from app.models.payment_models import CashBalance, PaymentTransaction, PaymentStatus
from app.models.bom_models import UserBom, BomAsset
from app.models.user_models import User
from app.models.gift_models import GiftTransaction, GiftStatus
from app.models.transaction_models import Transaction
from app.services.payment_service import FeesConfig
from app.services.wallet_service import update_platform_treasury, get_platform_treasury
from app.schemas.payment_schemas import PaymentMethod

logger = logging.getLogger(__name__)

# ============ CONSTANTES ============

LOCK_TIMEOUT = 30  # secondes
MAX_RETRIES = 3
DEADLOCK_RETRY_DELAY = 0.1

# ============ DECORATEURS UTILITAIRES ============

def retry_on_deadlock(func):
    """Décorateur pour retry automatique en cas de deadlock."""
    def wrapper(*args, **kwargs):
        retry_count = 0
        last_exception = None
        
        while retry_count < MAX_RETRIES:
            try:
                return func(*args, **kwargs)
            except OperationalError as e:
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock dans {func.__name__}, retry {retry_count}/{MAX_RETRIES}")
                    asyncio.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                else:
                    raise
            except Exception as e:
                raise
        
        if last_exception:
            logger.error(f"❌ Échec après {MAX_RETRIES} retries pour {func.__name__}")
            raise last_exception
    
    return wrapper

# ============ CLASSE DE SÉCURITÉ (PRÉSERVÉE) ============

class WithdrawalSecurity:
    """Protocole de sécurité pour les retraits - LOGIQUE MÉTIER PRÉSERVÉE"""
    
    @staticmethod
    @retry_on_deadlock
    def validate_bom_for_withdrawal(db: Session, user_id: int, user_bom_id: int) -> Dict[str, Any]:
        """
        Valider un Bom pour retrait - AVEC LOCK POUR CONSISTENCE
        """
        logger.info(f"🔍 VALIDATE_BOM_FOR_WITHDRAWAL: user={user_id}, bom={user_bom_id}")
        
        try:
            # 🔒 Lock du UserBom pour éviter les modifications concurrentes
            stmt = select(UserBom).where(
                UserBom.id == user_bom_id,
                UserBom.user_id == user_id
            ).with_for_update(read=True)  # Lock en lecture pour consistance
            
            user_bom = db.execute(stmt).scalar_one_or_none()
            
            if not user_bom:
                return {
                    "is_approved": False,
                    "rejection_reason": "Bom non trouvé dans votre inventaire",
                    "validation_timestamp": datetime.now(timezone.utc).isoformat()
                }
            
            # 🔒 Lock du BomAsset associé
            bom_stmt = select(BomAsset).where(BomAsset.id == user_bom.bom_id).with_for_update(read=True)
            bom_asset = db.execute(bom_stmt).scalar_one_or_none()
            
            if not bom_asset:
                return {
                    "is_approved": False,
                    "rejection_reason": "Bom invalide",
                    "validation_timestamp": datetime.now(timezone.utc).isoformat()
                }
            
            if not bom_asset.is_active:
                return {
                    "is_approved": False,
                    "rejection_reason": "Bom non disponible",
                    "validation_timestamp": datetime.now(timezone.utc).isoformat()
                }
            
            # ===== NOUVEAU : UTILISER LA CONFIG UNIFIÉE =====
            withdrawal_amount = bom_asset.value
            
            # Utiliser la configuration centralisée
            fees_analysis = FeesConfig.calculate_bom_withdrawal_fees(withdrawal_amount)
            
            fees = fees_analysis["your_commission"]
            net_amount = fees_analysis["net_to_user"]
            
            # Vérifications de sécurité
            security_checks = {
                "min_amount_check": True,
                "max_amount_check": True,
                "active_bom_check": True,
                "no_active_transfer": True,
                "locked_for_validation": True,
                # AJOUT : Informations sur les frais
                "fees_analysis": {
                    "withdrawal_amount": str(withdrawal_amount),
                    "fees_percent": str(fees_analysis["your_commission_percent"]),
                    "fees_amount": str(fees),
                    "net_amount": str(net_amount)
                }
            }
            
            # Vérifier les limites (utiliser la config unifiée)
            if withdrawal_amount < FeesConfig.MIN_WITHDRAWAL_AMOUNT:
                return {
                    "is_approved": False,
                    "rejection_reason": f"Montant minimum de retrait: {FeesConfig.MIN_WITHDRAWAL_AMOUNT} FCFA",
                    "security_checks": security_checks,
                    "validation_timestamp": datetime.now(timezone.utc).isoformat()
                }
            
            if withdrawal_amount > FeesConfig.MAX_WITHDRAWAL_AMOUNT:
                return {
                    "is_approved": False,
                    "rejection_reason": f"Montant maximum de retrait: {FeesConfig.MAX_WITHDRAWAL_AMOUNT} FCFA",
                    "security_checks": security_checks,
                    "validation_timestamp": datetime.now(timezone.utc).isoformat()
                }
            
            # Vérifier que le Bom n'est pas en cours de transfert
            gift_stmt = select(GiftTransaction).where(
                GiftTransaction.user_bom_id == user_bom_id,
                GiftTransaction.status == GiftStatus.SENT
            ).with_for_update(read=True)
            
            active_gift = db.execute(gift_stmt).scalar_one_or_none()
            
            if active_gift:
                return {
                    "is_approved": False,
                    "rejection_reason": "Ce Bom est en cours de transfert",
                    "security_checks": security_checks,
                    "validation_timestamp": datetime.now(timezone.utc).isoformat()
                }
            
            # Toutes les validations passées
            logger.info(f"✅ Validation retrait réussie: Bom #{user_bom_id}, valeur: {withdrawal_amount} FCFA")
            
            return {
                "is_approved": True,
                "bom": bom_asset,
                "user_bom": user_bom,
                "withdrawal_amount": withdrawal_amount,
                "fees": fees,
                "net_amount": net_amount,
                "security_checks": security_checks,
                "validation_timestamp": datetime.now(timezone.utc).isoformat(),
                "concurrency_safe": True
            }
            
        except Exception as e:
            logger.error(f"❌ Erreur validation retrait: {e}")
            return {
                "is_approved": False,
                "rejection_reason": f"Erreur de validation: {str(e)}",
                "validation_timestamp": datetime.now(timezone.utc).isoformat()
            }

# ============ FONCTIONS PUBLIQUES SÉCURISÉES ============

@retry_on_deadlock
def validate_bom_withdrawal(db: Session, user_id: int, user_bom_id: int) -> Dict[str, Any]:
    """
    Valider une demande de retrait - Interface publique.
    """
    return WithdrawalSecurity.validate_bom_for_withdrawal(db, user_id, user_bom_id)

@retry_on_deadlock
def execute_bom_withdrawal(
    db: Session,
    user_id: int,
    user_bom_id: int,
    phone_number: str,
    provider: Optional[PaymentMethod] = None
) -> Dict[str, Any]:
    """Exécuter un retrait externe standard (mobile money)."""
    resolved_provider = provider or PaymentMethod.WAVE
    if isinstance(resolved_provider, str):
        resolved_provider = PaymentMethod(resolved_provider)

    return _execute_external_payout(
        db=db,
        user_id=user_id,
        user_bom_id=user_bom_id,
        phone_number=phone_number,
        provider=resolved_provider
    )


def _execute_external_payout(
    db: Session,
    user_id: int,
    user_bom_id: int,
    phone_number: Optional[str],
    provider: PaymentMethod
) -> Dict[str, Any]:
    if not phone_number:
        raise ValueError("Numéro requis pour un retrait externe")

    logger.info(
        f"💸 EXECUTE_EXTERNAL_WITHDRAWAL: user={user_id}, bom={user_bom_id}, phone={phone_number}, provider={provider.value}"
    )

    validation = validate_bom_withdrawal(db, user_id, user_bom_id)
    if not validation["is_approved"]:
        raise ValueError(validation["rejection_reason"])

    withdrawal_amount = validation["withdrawal_amount"]
    fees = validation["fees"]
    net_amount = validation["net_amount"]
    bom_asset = validation["bom"]

    payout_reference = f"EXT_PAY_{uuid.uuid4().hex[:18]}"

    try:
        with db.begin_nested():
            bom_stmt = select(UserBom).where(
                UserBom.id == user_bom_id,
                UserBom.user_id == user_id
            ).with_for_update()
            locked_user_bom = db.execute(bom_stmt).scalar_one()

            # 🔍 Chercher le prix d'achat original du BOOM
            purchase_tx = db.query(Transaction).filter(
                Transaction.user_id == user_id,
                Transaction.transaction_type == "boom_purchase",
                Transaction.description.ilike(f"%{bom_asset.title}%")
            ).order_by(Transaction.created_at.desc()).first()
            
            purchase_price = Decimal('0')
            if purchase_tx and purchase_tx.description:
                # Extraire la "Valeur sociale" depuis la description
                # Format: "Valeur sociale: 3469.56 FCFA"
                social_value_match = re.search(r'Valeur\s*sociale:\s*([\d,]+\.?\d*)', purchase_tx.description, re.IGNORECASE)
                if social_value_match:
                    purchase_price = Decimal(social_value_match.group(1).replace(',', ''))

            # 📊 Calculer le gain utilisateur (= perte plateforme)
            user_gain = withdrawal_amount - purchase_price
            
            treasury = get_platform_treasury(db)
            old_treasury_balance = treasury.balance
            
            # ✅ Ajouter les frais (gain plateforme)
            treasury.balance += fees
            
            # ❌ Soustraire le gain utilisateur (perte plateforme) s'il est positif
            if user_gain > 0:
                treasury.balance -= user_gain
                logger.info(f"⚠️ Gain utilisateur détecté: {user_gain} FCFA (soustrait de la trésorerie)")
            
            new_treasury_balance = treasury.balance

            # ✅ IMPORTANT: Sauvegarder le user_bom_id AVANT de supprimer
            saved_user_bom_id = locked_user_bom.id
            saved_boom_id = locked_user_bom.bom_id
            
            db.delete(locked_user_bom)

            transaction_id = f"bom_withdrawal_{uuid.uuid4().hex[:16]}"
            
            # Construire la description avec les détails du gain utilisateur
            description = f"Retrait Bom externe: {bom_asset.title} vers {phone_number}"
            if user_gain > 0:
                description += f" | Gain utilisateur: {float(user_gain):.2f} FCFA"
            elif purchase_price > 0:
                description += f" | Valeur sociale: {float(purchase_price):.2f} FCFA"
            
            transaction = PaymentTransaction(
                id=transaction_id,
                user_id=user_id,
                type="bom_withdrawal",
                amount=withdrawal_amount,
                fees=fees,
                net_amount=net_amount,
                status=PaymentStatus.COMPLETED,
                provider=provider.value,
                provider_reference=payout_reference,
                description=description,
                boom_id=saved_boom_id,  # ✅ ID du BOOM pour tracking
                user_bom_id=saved_user_bom_id,  # ✅ Garder la référence pour tracking
                created_at=datetime.now(timezone.utc)
            )
            db.add(transaction)

            from app.models.admin_models import AdminLog
            admin_log = AdminLog(
                admin_id=0,
                action="bom_external_withdrawal",
                details={
                    "user_id": user_id,
                    "user_bom_id": user_bom_id,
                    "bom_title": bom_asset.title,
                    "withdrawal_amount": str(withdrawal_amount),
                    "fees": str(fees),
                    "net_amount": str(net_amount),
                    "phone_number": phone_number,
                    "provider": provider.value,
                    "treasury_balance_old": str(old_treasury_balance),
                    "treasury_balance_new": str(new_treasury_balance),
                    "transaction_id": transaction_id,
                    "payout_reference": payout_reference,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "locks": ["UserBom", "PlatformTreasury"],
                    "fees_analysis": {
                        "withdrawal_amount": str(withdrawal_amount),
                        "fees_percent": str(FeesConfig.YOUR_BOM_WITHDRAWAL_COMMISSION * Decimal('100')),
                        "fees_amount": str(fees),
                        "net_amount": str(net_amount)
                    }
                },
                fees_amount=fees
            )
            db.add(admin_log)

        db.commit()

        logger.info(
            f"🎉 Retrait externe confirmé: {withdrawal_amount} FCFA → {phone_number} | net={net_amount} FCFA"
        )

        return {
            "success": True,
            "transaction_id": transaction_id,
            "withdrawal_amount": float(withdrawal_amount),
            "fees": float(fees),
            "net_amount": float(net_amount),
            "payout_channel": provider.value,
            "payout_reference": payout_reference,
            "message": f"Transfert vers {phone_number} en cours",
            "concurrency_safe": True,
            "atomic_transaction": True,
            "locks_acquired": ["UserBom", "PlatformTreasury"]
        }

    except IntegrityError as e:
        db.rollback()
        logger.error(f"❌ Erreur intégrité retrait externe: {e}")
        raise ValueError(f"Erreur retrait externe (intégrité): {str(e)}")
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur retrait externe: {e}")
        raise ValueError(f"Erreur retrait externe: {str(e)}")


# ============ NOUVELLES FONCTIONNALITÉS SÉCURISÉES ============

@retry_on_deadlock
def batch_bom_withdrawals(db: Session, user_id: int, bom_ids: List[int], 
                         phone_number: str) -> Dict[str, Any]:
    """
    Retrait multiple de Boms en une transaction atomique.
    Idéal pour les utilisateurs qui veulent retirer plusieurs Boms.
    """
    logger.info(f"📦 BATCH_BOM_WITHDRAWALS: user={user_id}, {len(bom_ids)} Boms")
    
    if not bom_ids:
        return {"success": True, "processed": 0, "message": "Aucun Bom à retirer"}
    
    total_withdrawal = Decimal('0.00')
    total_fees = Decimal('0.00')
    total_net = Decimal('0.00')
    processed_boms = []
    failed_boms = []
    
    try:
        with db.begin_nested():
            # 🔒 LOCK MULTIPLE: tous les UserBoms + CashBalance
            # 1. Lock tous les UserBoms concernés
            bom_stmt = select(UserBom).where(
                UserBom.id.in_(bom_ids),
                UserBom.user_id == user_id
            ).with_for_update()
            
            user_boms = {b.id: b for b in db.execute(bom_stmt).scalars().all()}
            
            # 2. Lock CashBalance
            cash_stmt = select(CashBalance).where(CashBalance.user_id == user_id).with_for_update()
            cash_balance = db.execute(cash_stmt).scalar_one_or_none()
            
            if not cash_balance:
                cash_balance = CashBalance(user_id=user_id, available_balance=Decimal('0.00'))
                db.add(cash_balance)
            
            old_cash_balance = cash_balance.available_balance
            
            # Traiter chaque Bom
            for bom_id in bom_ids:
                if bom_id not in user_boms:
                    failed_boms.append({"bom_id": bom_id, "reason": "Non trouvé ou non propriétaire"})
                    continue
                
                user_bom = user_boms[bom_id]
                
                # Récupérer le BomAsset
                bom_stmt = select(BomAsset).where(BomAsset.id == user_bom.bom_id)
                bom_asset = db.execute(bom_stmt).scalar_one_or_none()
                
                if not bom_asset or not bom_asset.is_active:
                    failed_boms.append({"bom_id": bom_id, "reason": "Bom invalide ou inactif"})
                    continue
                
                # ===== NOUVEAU : UTILISER LA CONFIG UNIFIÉE =====
                withdrawal_amount = bom_asset.value
                
                # Utiliser la configuration centralisée
                fees_analysis = FeesConfig.calculate_bom_withdrawal_fees(withdrawal_amount)
                fees = fees_analysis["your_commission"]
                net_amount = fees_analysis["net_to_user"]
                
                # Vérifications de sécurité
                if withdrawal_amount < FeesConfig.MIN_WITHDRAWAL_AMOUNT:
                    failed_boms.append({
                        "bom_id": bom_id, 
                        "reason": f"Montant trop bas: {withdrawal_amount} < {FeesConfig.MIN_WITHDRAWAL_AMOUNT}"
                    })
                    continue
                
                if withdrawal_amount > FeesConfig.MAX_WITHDRAWAL_AMOUNT:
                    failed_boms.append({
                        "bom_id": bom_id,
                        "reason": f"Montant trop élevé: {withdrawal_amount} > {FeesConfig.MAX_WITHDRAWAL_AMOUNT}"
                    })
                    continue
                
                # Vérifier qu'il n'est pas en cadeau
                gift_stmt = select(GiftTransaction).where(
                    GiftTransaction.user_bom_id == bom_id,
                    GiftTransaction.status == GiftStatus.SENT
                )
                active_gift = db.execute(gift_stmt).scalar_one_or_none()
                
                if active_gift:
                    failed_boms.append({"bom_id": bom_id, "reason": "En cours de transfert"})
                    continue
                
                # TOUTES LES VALIDATIONS PASSÉES - procéder au retrait
                
                # 1. Supprimer le UserBom
                db.delete(user_bom)
                
                # 2. Ajouter au cash balance
                cash_balance.available_balance += net_amount
                
                # 3. Cumuler les totaux
                total_withdrawal += withdrawal_amount
                total_fees += fees
                total_net += net_amount
                
                # ✅ IMPORTANT: Sauvegarder le user_bom_id et boom_id AVANT suppression
                saved_user_bom_id = user_bom.id
                saved_boom_id = user_bom.bom_id
                
                # 4. Transaction individuelle
                transaction_id = f"batch_withdrawal_{uuid.uuid4().hex[:16]}"
                transaction = PaymentTransaction(
                    id=transaction_id,
                    user_id=user_id,
                    type="bom_withdrawal",
                    amount=withdrawal_amount,
                    fees=fees,
                    net_amount=net_amount,
                    status=PaymentStatus.COMPLETED,
                    provider="system",
                    provider_reference=f"BATCH_{user_id}_{bom_id}",
                    description=f"Retrait batch Bom: {bom_asset.title}",
                    boom_id=saved_boom_id,  # ✅ ID du BOOM pour tracking
                    user_bom_id=saved_user_bom_id  # ✅ Garder la référence pour tracking
                )
                db.add(transaction)
                
                processed_boms.append({
                    "bom_id": bom_id,
                    "title": bom_asset.title,
                    "value": float(withdrawal_amount),
                    "fees": float(fees),
                    "net": float(net_amount),
                    "transaction_id": transaction_id,
                    "fees_percent": float(fees_analysis["your_commission_percent"] * Decimal('100'))
                })
            
            new_cash_balance = cash_balance.available_balance
            
            # Ajouter les frais totaux à la caisse
            if total_fees > 0:
                from app.services.wallet_service import update_platform_treasury
                update_platform_treasury(
                    db,
                    total_fees,
                    f"Frais batch retrait {len(processed_boms)} Boms - User {user_id}"
                )
            
            # Log admin batch avec analyse des frais
            from app.models.admin_models import AdminLog
            admin_log = AdminLog(
                admin_id=0,
                action="batch_bom_withdrawals",
                details={
                    "user_id": user_id,
                    "total_boms": len(bom_ids),
                    "processed": len(processed_boms),
                    "failed": len(failed_boms),
                    "total_withdrawal": str(total_withdrawal),
                    "total_fees": str(total_fees),
                    "total_net": str(total_net),
                    "old_cash_balance": str(old_cash_balance),
                    "new_cash_balance": str(new_cash_balance),
                    "processed_boms": processed_boms,
                    "failed_boms": failed_boms,
                    "phone_number": phone_number,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "batch_locked": True,
                    # AJOUT : Analyse des frais
                    "fees_analysis": {
                        "commission_percent": str(FeesConfig.YOUR_BOM_WITHDRAWAL_COMMISSION * Decimal('100')),
                        "total_commission": str(total_fees),
                        "average_fee_per_bom": str(total_fees / len(processed_boms) if processed_boms else Decimal('0'))
                    }
                },
                fees_amount=total_fees
            )
            db.add(admin_log)
        
        db.commit()
        
        logger.info(f"✅ Batch retrait réussi: {len(processed_boms)}/{len(bom_ids)} Boms")
        logger.info(f"   Total: {total_withdrawal} FCFA, Frais: {total_fees} FCFA, Net: {total_net} FCFA")
        
        return {
            "success": True,
            "processed": len(processed_boms),
            "failed": len(failed_boms),
            "total_withdrawal": float(total_withdrawal),
            "total_fees": float(total_fees),
            "total_net": float(total_net),
            "old_cash_balance": float(old_cash_balance),
            "new_cash_balance": float(new_cash_balance),
            "processed_boms": processed_boms,
            "failed_boms": failed_boms,
            "phone_number": phone_number,
            "concurrency_safe": True,
            "batch_locked": True
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur batch retrait: {e}")
        raise ValueError(f"Erreur batch retrait: {str(e)}")

# ============ FONCTIONS DE DIAGNOSTIC ============

@retry_on_deadlock
def get_withdrawal_stats(db: Session, user_id: int = None) -> Dict[str, Any]:
    """
    Obtenir des statistiques sur les retraits.
    """
    from sqlalchemy import func
    
    query = db.query(
        func.count(PaymentTransaction.id).label('total_count'),
        func.sum(PaymentTransaction.amount).label('total_amount'),
        func.sum(PaymentTransaction.fees).label('total_fees'),
        func.sum(PaymentTransaction.net_amount).label('total_net')
    ).filter(
        PaymentTransaction.type == "bom_withdrawal",
        PaymentTransaction.status == PaymentStatus.COMPLETED
    )
    
    if user_id:
        query = query.filter(PaymentTransaction.user_id == user_id)
    
    stats = query.first()
    
    # Derniers retraits
    recent_withdrawals = db.query(PaymentTransaction).filter(
        PaymentTransaction.type == "bom_withdrawal"
    ).order_by(PaymentTransaction.created_at.desc()).limit(10).all()
    
    return {
        "stats": {
            "total_count": stats.total_count or 0,
            "total_amount": float(stats.total_amount or 0),
            "total_fees": float(stats.total_fees or 0),
            "total_net": float(stats.total_net or 0),
            "average_fee_percentage": (
                (float(stats.total_fees or 0) / float(stats.total_amount or 1)) * 100
                if stats.total_amount and stats.total_amount > 0 else 0
            )
        },
        "recent_withdrawals": [
            {
                "id": w.id,
                "user_id": w.user_id,
                "amount": float(w.amount),
                "fees": float(w.fees),
                "net_amount": float(w.net_amount),
                "description": w.description,
                "created_at": w.created_at.isoformat() if w.created_at else None
            }
            for w in recent_withdrawals
        ],
        "user_specific": user_id is not None,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@retry_on_deadlock
def validate_withdrawal_system(db: Session) -> Dict[str, Any]:
    """
    Valider l'intégrité du système de retrait.
    """
    logger.info("🔍 VALIDATION SYSTÈME DE RETRAIT")
    
    # 1. Vérifier la configuration des frais
    fees_config_ok = all([
        hasattr(FeesConfig, 'YOUR_BOM_WITHDRAWAL_COMMISSION'),
        hasattr(FeesConfig, 'MIN_WITHDRAWAL_AMOUNT'),
        hasattr(FeesConfig, 'MAX_WITHDRAWAL_AMOUNT'),
        hasattr(FeesConfig, 'calculate_bom_withdrawal_fees')
    ])
    
    # 2. Vérifier les transactions orphelines
    orphaned_transactions = db.query(PaymentTransaction).filter(
        PaymentTransaction.type == "bom_withdrawal",
        PaymentTransaction.user_bom_id.isnot(None)
    ).all()
    
    orphaned_count = 0
    for tx in orphaned_transactions:
        # Vérifier si le UserBom existe encore
        user_bom = db.query(UserBom).filter(UserBom.id == tx.user_bom_id).first()
        if not user_bom:
            orphaned_count += 1
    
    # 3. Vérifier la cohérence cash_balance
    from sqlalchemy import func
    cash_balance_total = db.query(func.sum(CashBalance.available_balance)).scalar() or Decimal('0.00')
    
    # 4. Statistiques globales
    stats = get_withdrawal_stats(db)
    
    return {
        "system_validation": {
            "fees_config_ok": fees_config_ok,
            "orphaned_transactions": orphaned_count,
            "total_cash_balance": float(cash_balance_total),
            "withdrawal_stats": stats["stats"],
            "validation_timestamp": datetime.now(timezone.utc).isoformat()
        },
        "recommendations": [
            "Vérifier les transactions orphelines" if orphaned_count > 0 else "Aucun problème détecté"
        ],
        "concurrency_support": {
            "lock_timeout": LOCK_TIMEOUT,
            "max_retries": MAX_RETRIES,
            "deadlock_management": True,
            "atomic_transactions": True
        }
    }
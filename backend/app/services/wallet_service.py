"""
SERVICE DE PORTEFEUILLE - VERSION 2.0
Sécurité maximale contre les races conditions avec locks de concurrence
Transactions atomiques complètes, logs détaillés, et gestion optimisée des erreurs
CORRECTION : Séparation claire argent RÉEL vs VIRTUEL
"""

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy import select
from decimal import Decimal
from datetime import datetime, timezone, timedelta
import logging
import asyncio
from typing import Dict, Any, List, Optional, Callable
from contextlib import contextmanager

# Modèles
from app.models.user_models import Wallet, User, TransactionType
from app.models.transaction_models import Transaction
from app.models.admin_models import PlatformTreasury, AdminLog
from app.models.bom_models import BomAsset, UserBom
from app.models.payment_models import CashBalance, PaymentTransaction  # ⬅️ IMPORTANT

logger = logging.getLogger(__name__)

# ============ CONSTANTES ET CONFIGURATION ============

LOCK_TIMEOUT = 30  # secondes avant timeout des locks
MAX_RETRIES = 3  # tentatives en cas de deadlock
DEADLOCK_RETRY_DELAY = 0.1  # secondes entre retries

# ============ TYPES DE TRANSACTIONS - VERSION CORRIGÉE ============

# Types qui impactent l'argent RÉEL (CashBalance) - TOUT L'ARGENT VRAI
REAL_MONEY_TYPES = {
    'CREDIT': [
        'deposit_real',         # Dépôt OM/Mobile Money
        'deposit',              # Compatibilité
        'boom_sell_real',       # Vente BOOM (argent reçu)
        'boom_sell',           # Compatibilité
        'transfer_received_real',
        'refund_real',          # Remboursement
        'cashback_real',        # Cashback réel
        'gift_received_real',   # Cadeau reçu (argent réel) ⬅️ NOUVEAU
        'reward_real',          # Récompense argent réel
        'social_reward_real',   # Récompense sociale argent réel
        'commission_received_real', # Commission reçue
        'bonus_real',           # Bonus argent réel
        'income_real'           # Revenu argent réel
    ],
    'DEBIT': [
        'withdrawal_real',      # Retrait
        'withdrawal',           # Compatibilité
        'boom_purchase_real',   # Achat BOOM
        'boom_purchase',       # Compatibilité
        'transfer_sent_real',   # Transfert envoyé
        'gift_sent_real',       # Cadeau envoyé (argent réel) ⬅️ CRITIQUE
        'gift_fee_real',        # Frais cadeau réel ⬅️ Optionnel
        'purchase_real',        # Autre achat
        'fee_real',             # Frais
        'commission_paid_real', # Commission payée
        'penalty_real',         # Pénalité argent réel
        'tax_real'             # Taxe
    ]
}

# Types qui impactent l'argent VIRTUEL (Wallet) - UNIQUEMENT REDISTRIBUTIONS
VIRTUAL_MONEY_TYPES = {
    'CREDIT': [
        'redistribution_received',      # Redistribution communautaire
        'royalties_redistribution',     # Redistribution royalties
        'community_bonus',              # Bonus communautaire
        'loyalty_redistribution',       # Redistribution fidélité
        'system_redistribution'         # Redistribution système
    ],
    'DEBIT': [   # Très rare pour virtuel
        'correction_virtual',           # Correction erreur
        'adjustment_virtual'            # Ajustement technique
    ]
}

# Types NEUTRES (pas d'argent)
NEUTRAL_TYPES = [
    'treasury_update',
    'treasury_deposit',
    'treasury_withdrawal',
    'balance_check',
    'status_update',
    'gift_sent_virtual',       # Cadeau envoyé (juste notification)
    'gift_received_virtual',   # Cadeau reçu (juste notification)
    'social_interaction',
    'badge_earned',
    'achievement_unlocked'
]

# ============ DECORATEURS ET CONTEXT MANAGERS ============

@contextmanager
def wallet_lock_context(db: Session, user_id: int, lock_type: str = "update"):
    """
    Context manager pour lock sécurisé d'un wallet.
    Gère automatiquement les deadlocks et timeouts.
    """
    retry_count = 0
    
    while retry_count < MAX_RETRIES:
        try:
            # Début de la transaction avec timeout
            db.execute("SET LOCAL lock_timeout = '30s'")
            
            # Acquérir le lock selon le type
            if lock_type == "update":
                stmt = select(Wallet).where(Wallet.user_id == user_id).with_for_update()
            else:  # read lock
                stmt = select(Wallet).where(Wallet.user_id == user_id).with_for_update(read=True)
            
            wallet = db.execute(stmt).scalar_one_or_none()
            
            # Si pas de wallet, on le crée mais sans lock (nouvelle création)
            if not wallet:
                logger.warning(f"⚠️ Wallet non trouvé pour user {user_id} pendant lock")
                yield None
                return
            
            logger.debug(f"🔒 Lock acquis pour wallet user {user_id} (type: {lock_type})")
            yield wallet
            
            # Sortie normale
            return
            
        except OperationalError as e:
            # Gestion des deadlocks
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                logger.warning(f"🔄 Deadlock détecté, retry {retry_count}/{MAX_RETRIES}")
                db.rollback()
                asyncio.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle lors du lock: {e}")
                raise
        except Exception as e:
            logger.error(f"❌ Erreur inattendue dans wallet_lock_context: {e}")
            raise
        finally:
            # Nettoyage
            try:
                db.rollback()  # Rollback pour libérer les locks
            except:
                pass
    
    raise OperationalError(f"Échec après {MAX_RETRIES} tentatives de lock pour user {user_id}")

@contextmanager
def treasury_lock_context(db: Session):
    """
    Context manager pour lock sécurisé de la caisse plateforme.
    """
    try:
        # Lock de la caisse plateforme
        stmt = select(PlatformTreasury).with_for_update()
        treasury = db.execute(stmt).scalar_one_or_none()
        
        if not treasury:
            logger.warning("⚠️ Caisse plateforme non trouvée, création")
            treasury = PlatformTreasury(balance=Decimal('0.00'), currency="FCFA")
            db.add(treasury)
            db.commit()  # Commit pour créer avant de lock
        
        logger.debug("🔒 Lock acquis pour caisse plateforme")
        yield treasury
        
    except Exception as e:
        logger.error(f"❌ Erreur dans treasury_lock_context: {e}")
        raise
    finally:
        # Rollback pour libérer le lock, commit réel se fera après
        try:
            db.rollback()
        except:
            pass

def retry_on_deadlock(func):
    """
    Décorateur pour retry automatique en cas de deadlock.
    """
    def wrapper(*args, **kwargs):
        retry_count = 0
        last_exception = None
        
        while retry_count < MAX_RETRIES:
            try:
                return func(*args, **kwargs)
            except OperationalError as e:
                if "deadlock" in str(e).lower():
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

# ============ FONCTIONS CORE SÉCURISÉES ============

@retry_on_deadlock
def get_wallet_balance(db: Session, user_id: int, lock_for_read: bool = False) -> Dict[str, Any]:
    """
    Récupérer le solde du portefeuille avec option de lock en lecture.
    Version 100% sécurisée contre les races conditions.
    """
    logger.info(f"💰 get_wallet_balance: user={user_id}, lock={lock_for_read}")
    
    try:
        if lock_for_read:
            # Lecture avec lock pour consistance forte
            with wallet_lock_context(db, user_id, "read") as wallet:
                if not wallet:
                    # Créer un wallet si inexistant
                    wallet = Wallet(user_id=user_id, balance=Decimal('0.00'), currency="FCFA")
                    db.add(wallet)
                    db.commit()
                    balance = Decimal('0.00')
                else:
                    balance = wallet.balance if wallet.balance is not None else Decimal('0.00')
        else:
            # Lecture simple sans lock (pour les UIs)
            wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
            if not wallet:
                balance = Decimal('0.00')
            else:
                balance = wallet.balance if wallet.balance is not None else Decimal('0.00')
        
        logger.info(f"💰 Solde user {user_id}: {balance}")
        
        return {
            "balance": str(balance),
            "available_balance": str(balance),
            "currency": "FCFA",
            "user_id": user_id,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "locked_read": lock_for_read
        }
        
    except Exception as e:
        logger.error(f"❌ Erreur get_wallet_balance: {e}")
        # Fallback sécurisé
        return {
            "balance": "0.00",
            "available_balance": "0.00",
            "currency": "FCFA",
            "user_id": user_id,
            "error": str(e),
            "fallback": True
        }

@retry_on_deadlock
def get_real_cash_balance(db: Session, user_id: int, lock_for_read: bool = True) -> Dict[str, Any]:
    """
    Récupérer UNIQUEMENT le solde RÉEL (CashBalance) - source unique de vérité
    Pour les achats, ventes, et affichage cash.
    """
    logger.info(f"💰 get_real_cash_balance: user={user_id}, lock={lock_for_read}")
    
    try:
        if lock_for_read:
            # 🔒 Lock CashBalance pour lecture cohérente
            cash_stmt = select(CashBalance).where(CashBalance.user_id == user_id).with_for_update(read=True)
            cash_balance = db.execute(cash_stmt).scalar_one_or_none()
        else:
            # Lecture simple sans lock
            cash_balance = db.query(CashBalance).filter(CashBalance.user_id == user_id).first()
        
        if not cash_balance:
            # Créer CashBalance si inexistant
            cash_balance = CashBalance(
                user_id=user_id,
                available_balance=Decimal('0.00'),
                locked_balance=Decimal('0.00'),
                currency="FCFA",
                created_at=datetime.now(timezone.utc)
            )
            db.add(cash_balance)
            db.commit()
            balance = Decimal('0.00')
        else:
            balance = cash_balance.available_balance if cash_balance.available_balance is not None else Decimal('0.00')
        
        logger.info(f"💰 Solde RÉEL user {user_id}: {balance} FCFA")
        
        return {
            "balance": str(balance),
            "available_balance": str(balance),  # ✅ Source unique
            "currency": "FCFA",
            "user_id": user_id,
            "source": "CashBalance",
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "locked_read": lock_for_read
        }
        
    except Exception as e:
        logger.error(f"❌ Erreur get_real_cash_balance: {e}")
        # Fallback sécurisé
        return {
            "balance": "0.00",
            "available_balance": "0.00",
            "currency": "FCFA",
            "user_id": user_id,
            "error": str(e),
            "fallback": True,
            "source": "error"
        }

def create_gift_debit_transaction(db: Session, sender_id: int, amount: float, 
                                  gift_reference: str, boom_title: str, receiver_phone: str) -> Dict[str, Any]:
    """
    Transaction wallet spécialisée pour les cadeaux
    Garantit que le débit se fait uniquement sur l'argent RÉEL (CashBalance)
    """
    logger.info(f"💳 GIFT DEBIT TRANSACTION - Sender:{sender_id}, Amount:{amount}, Ref:{gift_reference}")
    
    try:
        # Convertir le float en Decimal immédiatement
        amount_decimal = Decimal(str(amount))
        
        # Transaction atomique
        with db.begin_nested():
            # 🔒 Lock CashBalance sender (argent RÉEL)
            cash_stmt = select(CashBalance).where(
                CashBalance.user_id == sender_id
            ).with_for_update()
            
            cash_balance = db.execute(cash_stmt).scalar_one_or_none()
            
            if not cash_balance:
                # Créer CashBalance si inexistant
                cash_balance = CashBalance(
                    user_id=sender_id,
                    available_balance=Decimal('0.00'),
                    locked_balance=Decimal('0.00'),
                    currency="FCFA",
                    created_at=datetime.now(timezone.utc)
                )
                db.add(cash_balance)
                db.flush()
            
            # Vérifier solde RÉEL
            old_balance = cash_balance.available_balance or Decimal('0.00')
            
            if old_balance < amount_decimal:
                raise ValueError(
                    f"Solde RÉEL insuffisant pour cadeau: {old_balance} FCFA < {amount_decimal} FCFA. "
                    f"Référence: {gift_reference}"
                )
            
            # DÉBIT RÉEL (unique source de vérité)
            cash_balance.available_balance -= amount_decimal
            new_balance = cash_balance.available_balance
            
            # Créer transaction
            transaction = Transaction(
                user_id=sender_id,
                type="gift_sent_real",  # 🔧 FIX: type field was missing
                amount=amount_decimal,
                transaction_type="gift_sent_real",  # Type spécifique gift
                description=f"Cadeau {gift_reference}: {boom_title} → {receiver_phone}",
                status="completed",
                reference=gift_reference,
                created_at=datetime.now(timezone.utc)
            )
            db.add(transaction)
            db.flush()
            
            logger.info(f"💰 GIFT REAL DEBIT: {old_balance} → {new_balance} (-{amount_decimal})")
            
            return {
                "success": True,
                "transaction": transaction,
                "transaction_id": transaction.id,
                "old_balance": str(old_balance),
                "new_balance": str(new_balance),
                "amount": str(amount_decimal),
                "reference": gift_reference,
                "target": "real",
                "operation": "debit"
            }
            
    except Exception as e:
        logger.error(f"❌ Erreur gift débit transaction: {e}")
        raise

@retry_on_deadlock
def create_transaction(db: Session, user_id: int, amount: float,
                      transaction_type: str, description: str,
                      status: str = "completed") -> Dict[str, Any]:
    """
    CRÉATION DE TRANSACTION - Version corrigée
    RÉEL : Toute transaction monétaire (achats, ventes, cadeaux, frais, etc.)
    VIRTUEL : Uniquement redistributions
    """
    
    # ============ 🚨 SÉCURITÉ : BLOCAGE DES TRANSACTIONS BOOMS ============
    # Les transactions BOOMS doivent être gérées par MarketService/PurchaseService
    # pour éviter le double débit/crédit
    BOOM_TRANSACTION_TYPES = [
        'boom_purchase_real',
        'boom_sell_real',
        'boom_purchase',
        'boom_sell'
    ]
    
    if transaction_type in BOOM_TRANSACTION_TYPES:
        logger.critical(
            f"🚨 SÉCURITÉ WALLET: Tentative création transaction BOOM "
            f"({transaction_type}) bloquée pour user={user_id}"
        )
        raise ValueError(
            f"Transaction BOOM '{transaction_type}' interdite dans WalletService. "
            f"Utiliser MarketService ou PurchaseService pour les transactions BOOMS."
        )
    
    # ============ CODE ORIGINAL PRÉSERVÉ À 100% ============
    logger.info(f"💳 CREATE_TRANSACTION [type={transaction_type}]: user={user_id}, amount={amount}")
    
    # Validation et conversion en Decimal
    try:
        amount_decimal = Decimal(str(amount))
        if amount_decimal <= Decimal('0'):
            raise ValueError("Le montant doit être positif")
    except Exception as e:
        logger.error(f"❌ Montant invalide: {amount} - {e}")
        raise ValueError(f"Montant invalide: {amount}")
    
    # Vérifier l'utilisateur
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        if user_id == 0:  # Système
            user = User(id=0, phone="system", full_name="Système")
        else:
            raise ValueError(f"Utilisateur {user_id} non trouvé")
    
    # ============ CAS SPÉCIAL POUR LES CADEAUX ============
    if transaction_type == "gift_sent_real":
        logger.info(f"🎯 Transaction GIFT détectée, traitement spécialisé")
        
        try:
            with db.begin_nested():
                # 🔒 Lock CashBalance (argent RÉEL)
                cash_stmt = select(CashBalance).where(CashBalance.user_id == user_id).with_for_update()
                cash_balance = db.execute(cash_stmt).scalar_one_or_none()
                
                if not cash_balance:
                    # Créer CashBalance si inexistant
                    cash_balance = CashBalance(
                        user_id=user_id,
                        available_balance=Decimal('0.00'),
                        locked_balance=Decimal('0.00'),
                        currency="FCFA",
                        created_at=datetime.now(timezone.utc)
                    )
                    db.add(cash_balance)
                    logger.info(f"💰 CashBalance créé pour user {user_id}")
                
                if cash_balance.available_balance is None:
                    cash_balance.available_balance = Decimal('0.00')
                
                old_balance = cash_balance.available_balance
                
                # Vérifier solde RÉEL
                if old_balance < amount_decimal:
                    error_msg = f"Solde RÉEL insuffisant pour cadeau: {old_balance} < {amount_decimal}"
                    logger.error(f"❌ {error_msg}")
                    raise ValueError(error_msg)
                
                # DÉBIT RÉEL (une seule source de vérité)
                cash_balance.available_balance -= amount_decimal
                new_balance = cash_balance.available_balance
                
                logger.info(f"💰 DÉBIT RÉEL (gift): {old_balance} → {new_balance} (-{amount_decimal})")
                
                # Créer transaction
                transaction = Transaction(
                    user_id=user_id,
                    type=transaction_type,  # 🔧 FIX: type field was missing
                    amount=amount_decimal,
                    transaction_type=transaction_type,
                    description=description,
                    status=status,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(transaction)
                db.flush()
                
                transaction_id = transaction.id if transaction.id else "pending"
                
                # Log admin pour gros montants
                if amount_decimal > Decimal('50000'):
                    admin_log = AdminLog(
                        admin_id=0,
                        action="large_gift_transaction",
                        details={
                            "user_id": user_id,
                            "transaction_id": transaction_id,
                            "amount": str(amount_decimal),
                            "old_balance": str(old_balance),
                            "new_balance": str(new_balance),
                            "type": transaction_type,
                            "description": description,
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        },
                        fees_amount=Decimal('0.00')
                    )
                    db.add(admin_log)
                
                logger.info(f"✅ Transaction GIFT créée (ID: {transaction_id})")
                
                return {
                    "success": True,
                    "transaction": transaction,
                    "old_balance": str(old_balance),
                    "new_balance": str(new_balance),
                    "target": "real",
                    "operation": "debit",
                    "amount": str(amount_decimal),
                    "transaction_type": transaction_type,
                    "transaction_id": transaction_id,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                
        except Exception as e:
            logger.error(f"❌ Erreur transaction gift: {e}")
            raise
    
    # ============ 1. DÉTERMINATION CIBLE ============
    target = None  # 'real', 'virtual', ou 'neutral'
    operation = None  # 'credit' ou 'debit'
    
    # Règle SIMPLE et CLAIRE :
    if transaction_type in NEUTRAL_TYPES:
        target = "neutral"
        operation = "none"
    elif "redistribution" in transaction_type.lower():
        # UNIQUEMENT les redistributions → VIRTUEL
        target = "virtual"
        operation = "credit" if amount_decimal > 0 else "debit"
    else:
        # TOUT LE RESTE → RÉEL
        target = "real"
        
        # Déterminer crédit/débit
        if transaction_type in REAL_MONEY_TYPES['CREDIT']:
            operation = "credit"
        elif transaction_type in REAL_MONEY_TYPES['DEBIT']:
            operation = "debit"
        elif transaction_type in VIRTUAL_MONEY_TYPES['CREDIT']:
            # Anomalie : redistribution marquée ailleurs
            logger.warning(f"⚠️ Type '{transaction_type}' devrait être RÉEL, ajustement")
            target = "real"
            operation = "credit"
        elif transaction_type in VIRTUAL_MONEY_TYPES['DEBIT']:
            logger.warning(f"⚠️ Type '{transaction_type}' devrait être RÉEL, ajustement")
            target = "real"
            operation = "debit"
        else:
            # Par défaut selon conventions
            if any(x in transaction_type.lower() for x in ['deposit', 'sell', 'received', 'refund', 'bonus', 'reward']):
                operation = "credit"
            elif any(x in transaction_type.lower() for x in ['withdrawal', 'purchase', 'sent', 'fee', 'penalty']):
                operation = "debit"
            else:
                # Dernier recours : montant positif = crédit
                operation = "credit" if amount_decimal > 0 else "debit"
    
    logger.info(f"🎯 Cible déterminée: {target}.{operation} | Type: {transaction_type}")
    
    # ============ 2. TRANSACTION NEUTRE ============
    if target == "neutral":
        try:
            transaction = Transaction(
                user_id=user_id,
                type=transaction_type,  # 🔧 FIX: type field was missing
                amount=amount_decimal,
                transaction_type=transaction_type,
                description=description,
                status=status,
                created_at=datetime.now(timezone.utc)
            )
            db.add(transaction)
            db.flush()
            
            logger.info(f"📝 Transaction NEUTRE créée: {transaction_type}")
            
            return {
                "success": True,
                "transaction": transaction,
                "target": "neutral",
                "operation": "none",
                "amount": str(amount_decimal),
                "transaction_id": transaction.id if transaction.id else "pending"
            }
        except Exception as e:
            logger.error(f"❌ Erreur transaction neutre: {e}")
            raise ValueError(f"Erreur transaction: {str(e)}")
    
    # ============ 3. TRANSACTION AVEC ARGENT ============
    try:
        with db.begin_nested():
            old_balance = Decimal('0.00')
            new_balance = Decimal('0.00')
            
            if target == "real":
                # 🔒 ARGENT RÉEL : Lock CashBalance
                cash_stmt = select(CashBalance).where(CashBalance.user_id == user_id).with_for_update()
                cash_balance = db.execute(cash_stmt).scalar_one_or_none()
                
                if not cash_balance:
                    # Créer CashBalance si inexistant
                    cash_balance = CashBalance(
                        user_id=user_id,
                        available_balance=Decimal('0.00'),
                        locked_balance=Decimal('0.00'),
                        currency="FCFA",
                        created_at=datetime.now(timezone.utc)
                    )
                    db.add(cash_balance)
                    logger.info(f"💰 CashBalance créé pour user {user_id}")
                
                if cash_balance.available_balance is None:
                    cash_balance.available_balance = Decimal('0.00')
                
                old_balance = cash_balance.available_balance
                
                # Application solde RÉEL
                if operation == "credit":
                    cash_balance.available_balance += amount_decimal
                    new_balance = cash_balance.available_balance
                    logger.info(f"💰 CRÉDIT RÉEL: {old_balance} → {new_balance} (+{amount_decimal})")
                elif operation == "debit":
                    if cash_balance.available_balance < amount_decimal:
                        error_msg = f"Solde RÉEL insuffisant: {old_balance} < {amount_decimal}"
                        logger.error(f"❌ {error_msg}")
                        raise ValueError(error_msg)
                    cash_balance.available_balance -= amount_decimal
                    new_balance = cash_balance.available_balance
                    logger.info(f"💰 DÉBIT RÉEL: {old_balance} → {new_balance} (-{amount_decimal})")
                
                balance_obj = cash_balance
                
            else:  # target == "virtual"
                # 🔒 ARGENT VIRTUEL : Lock Wallet (UNIQUEMENT redistributions)
                wallet_stmt = select(Wallet).where(Wallet.user_id == user_id).with_for_update()
                wallet = db.execute(wallet_stmt).scalar_one_or_none()
                
                if not wallet:
                    # Créer Wallet si inexistant
                    wallet = Wallet(
                        user_id=user_id,
                        balance=Decimal('0.00'),
                        currency="FCFA",
                        created_at=datetime.now(timezone.utc)
                    )
                    db.add(wallet)
                    logger.info(f"🎁 Wallet créé pour user {user_id}")
                
                if wallet.balance is None:
                    wallet.balance = Decimal('0.00')
                
                old_balance = wallet.balance
                
                # Application solde VIRTUEL
                if operation == "credit":
                    wallet.balance += amount_decimal
                    new_balance = wallet.balance
                    logger.info(f"🎁 CRÉDIT VIRTUEL (redistribution): {old_balance} → {new_balance} (+{amount_decimal})")
                elif operation == "debit":
                    if wallet.balance < amount_decimal:
                        logger.warning(f"⚠️ Solde VIRTUEL insuffisant: {old_balance} < {amount_decimal}")
                    wallet.balance -= amount_decimal
                    new_balance = wallet.balance
                    logger.info(f"🎁 DÉBIT VIRTUEL (correction): {old_balance} → {new_balance} (-{amount_decimal})")
                
                balance_obj = wallet
            
            # ============ 4. CRÉER TRANSACTION ============
            transaction = Transaction(
                user_id=user_id,
                type=transaction_type,  # 🔧 FIX: type field was missing
                amount=amount_decimal,
                transaction_type=transaction_type,
                description=f"{description} [Cible: {target}]",
                status=status,
                created_at=datetime.now(timezone.utc)
            )
            db.add(transaction)
            db.flush()
            
            transaction_id = transaction.id if transaction.id else "pending"
            
            # ============ 5. LOGS ADMIN ============
            if amount_decimal > Decimal('50000'):
                admin_log = AdminLog(
                    admin_id=0,
                    action="large_transaction",
                    details={
                        "user_id": user_id,
                        "transaction_id": transaction_id,
                        "target": target,
                        "operation": operation,
                        "amount": str(amount_decimal),
                        "old_balance": str(old_balance),
                        "new_balance": str(new_balance),
                        "type": transaction_type,
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    },
                    fees_amount=Decimal('0.00')
                )
                db.add(admin_log)
            
            logger.info(f"✅ Transaction créée: {transaction_type} (ID: {transaction_id})")
        
        # ============ 6. COMMIT ============
        db.commit()
        
        # ============ 7. BROADCAST ============
        try:
            from app.websockets import broadcast_balance_update
            
            # Récupérer les DEUX soldes pour broadcast complet
            final_cash_balance = None
            final_wallet_balance = None
            
            if target == "real":
                final_cash_balance = float(new_balance)
                # Récupérer solde virtuel aussi
                wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
                final_wallet_balance = float(wallet.balance) if wallet and wallet.balance else 0.0
            else:  # virtual
                final_wallet_balance = float(new_balance)
                # Récupérer solde réel aussi
                cash = db.query(CashBalance).filter(CashBalance.user_id == user_id).first()
                final_cash_balance = float(cash.available_balance) if cash and cash.available_balance else 0.0
            
            asyncio.create_task(broadcast_balance_update(
                user_id,
                wallet_balance=final_wallet_balance,
                cash_balance=final_cash_balance
            ))
            
        except ImportError:
            logger.warning("⚠️ WebSockets non disponibles pour broadcast")
        except Exception as e:
            logger.error(f"⚠️ Erreur broadcast: {e}")
        
        # ============ 8. RÉPONSE ============
        return {
            "success": True,
            "transaction": transaction,
            "old_balance": str(old_balance),
            "new_balance": str(new_balance),
            "target": target,
            "operation": operation,
            "amount": str(amount_decimal),
            "transaction_type": transaction_type,
            "transaction_id": transaction_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
    except IntegrityError as e:
        db.rollback()
        logger.error(f"❌ Erreur intégrité: {e}")
        raise ValueError(f"Erreur de transaction (intégrité): {str(e)}")
    except ValueError as e:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur transaction avec lock: {e}")
        raise ValueError(f"Erreur de transaction: {str(e)}")

@retry_on_deadlock
def has_sufficient_funds(db: Session, user_id: int, amount: float, lock_for_check: bool = True,
                         fund_type: str = "real") -> Dict[str, Any]:
    """
    Vérifier si l'utilisateur a suffisamment de fonds.
    fund_type: "real" (CashBalance) ou "virtual" (Wallet)
    """
    logger.info(f"🔍 HAS_SUFFICIENT_FUNDS: user={user_id}, amount={amount}, type={fund_type}")
    
    try:
        # Convertir le float en Decimal
        amount_decimal = Decimal(str(amount))
        
        if fund_type == "real":
            # Vérifier CashBalance (argent RÉEL)
            if lock_for_check:
                cash_stmt = select(CashBalance).where(CashBalance.user_id == user_id).with_for_update(read=True)
                cash_balance = db.execute(cash_stmt).scalar_one_or_none()
            else:
                cash_balance = db.query(CashBalance).filter(CashBalance.user_id == user_id).first()
            
            if not cash_balance:
                balance = Decimal('0.00')
                account_exists = False
            else:
                balance = cash_balance.available_balance or Decimal('0.00')
                account_exists = True
            
            source = "CashBalance (RÉEL)"
            
        else:  # virtual
            # Vérifier Wallet (argent VIRTUEL)
            if lock_for_check:
                with wallet_lock_context(db, user_id, "read") as wallet:
                    if not wallet:
                        balance = Decimal('0.00')
                        account_exists = False
                    else:
                        balance = wallet.balance if wallet.balance is not None else Decimal('0.00')
                        account_exists = True
            else:
                wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
                if not wallet:
                    balance = Decimal('0.00')
                    account_exists = False
                else:
                    balance = wallet.balance if wallet.balance is not None else Decimal('0.00')
                    account_exists = True
            
            source = "Wallet (VIRTUEL)"
        
        has_funds = balance >= amount_decimal
        
        result = {
            "has_funds": has_funds,
            "balance": str(balance),
            "required": str(amount_decimal),
            "missing": str(max(Decimal('0'), amount_decimal - balance)),
            "source": source,
            "fund_type": fund_type,
            "locked": lock_for_check,
            "account_exists": account_exists
        }
        
        logger.info(f"🔍 Résultat vérification fonds {fund_type}: {result['has_funds']} (balance: {result['balance']})")
        return result
        
    except Exception as e:
        logger.error(f"❌ Erreur vérification fonds: {e}")
        return {
            "has_funds": False,
            "balance": "0.00",
            "required": str(amount),
            "missing": str(amount),
            "source": f"error: {str(e)}",
            "fund_type": fund_type,
            "locked": lock_for_check,
            "account_exists": False,
            "error": str(e),
            "fallback": True
        }

@retry_on_deadlock
def transfer_funds(db: Session, from_user_id: int, to_user_id: int, 
                   amount: float, description: str = "") -> Dict[str, Any]:
    """
    Transfert de fonds entre utilisateurs avec double lock.
    Garantie d'atomicité complète - soit les deux wallets sont mis à jour, soit aucun.
    """
    logger.info(f"🔄 TRANSFER_FUNDS: {from_user_id} → {to_user_id}, amount={amount}")
    
    if from_user_id == to_user_id:
        raise ValueError("Impossible de transférer à soi-même")
    
    try:
        # Convertir le float en Decimal
        amount_decimal = Decimal(str(amount))
        if amount_decimal <= Decimal('0'):
            raise ValueError("Le montant doit être positif")
    except Exception as e:
        raise ValueError(f"Montant invalide: {amount}")
    
    # Double transaction atomique
    try:
        with db.begin_nested():  # Transaction atomique
            # 🔒🔒 DOUBLE LOCK - lock les deux wallets simultanément
            # Ordre déterministe pour éviter les deadlocks
            user_ids = sorted([from_user_id, to_user_id])
            
            stmt = select(Wallet).where(Wallet.user_id.in_(user_ids)).with_for_update()
            wallets = {w.user_id: w for w in db.execute(stmt).scalars().all()}
            
            # Vérifier/créer les wallets manquants
            for uid in user_ids:
                if uid not in wallets:
                    wallets[uid] = Wallet(user_id=uid, balance=Decimal('0.00'), currency="FCFA")
                    db.add(wallets[uid])
            
            # Récupérer les wallets spécifiques
            from_wallet = wallets[from_user_id]
            to_wallet = wallets[to_user_id]
            
            # Initialiser les soldes si None
            if from_wallet.balance is None:
                from_wallet.balance = Decimal('0.00')
            if to_wallet.balance is None:
                to_wallet.balance = Decimal('0.00')
            
            old_balance_from = from_wallet.balance
            old_balance_to = to_wallet.balance
            
            # Vérifier le solde source
            if from_wallet.balance < amount_decimal:
                error_msg = f"Solde insuffisant: {from_wallet.balance} < {amount_decimal}"
                logger.error(f"❌ {error_msg}")
                raise ValueError(error_msg)
            
            # Effectuer le transfert
            from_wallet.balance -= amount_decimal
            to_wallet.balance += amount_decimal
            
            new_balance_from = from_wallet.balance
            new_balance_to = to_wallet.balance
            
            logger.info(f"🔄 Transfert effectué: {from_user_id}: {old_balance_from}→{new_balance_from}, "
                       f"{to_user_id}: {old_balance_to}→{new_balance_to}")
            
            # Créer les transactions
            tx_out = Transaction(
                user_id=from_user_id,
                type="transfer_sent",  # 🔧 FIX: type field was missing
                amount=amount_decimal,
                transaction_type="transfer_sent",
                description=f"Transfert vers user {to_user_id}" + (f" - {description}" if description else ""),
                status="completed"
            )
            
            tx_in = Transaction(
                user_id=to_user_id,
                type="transfer_received",  # 🔧 FIX: type field was missing
                amount=amount_decimal,
                transaction_type="transfer_received",
                description=f"Transfert reçu de user {from_user_id}" + (f" - {description}" if description else ""),
                status="completed"
            )
            
            db.add_all([tx_out, tx_in])
            
            # Log admin
            admin_log = AdminLog(
                admin_id=0,
                action="funds_transfer",
                details={
                    "from_user": from_user_id,
                    "to_user": to_user_id,
                    "amount": str(amount_decimal),
                    "old_balance_from": str(old_balance_from),
                    "new_balance_from": str(new_balance_from),
                    "old_balance_to": str(old_balance_to),
                    "new_balance_to": str(new_balance_to),
                    "description": description,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "double_locked": True
                },
                fees_amount=Decimal('0.00')
            )
            db.add(admin_log)
            
            logger.info(f"✅ Transfert préparé avec double lock")
        
        # Commit
        db.commit()
        
        # Broadcast WebSocket
        try:
            from app.websockets import broadcast_balance_update
            # CORRECTION: Transfert = argent VIRTUEL (Wallet), pas RÉEL
            asyncio.create_task(broadcast_balance_update(
                from_user_id, 
                str(new_balance_from),  # En string
                balance_type="virtual"   # Type spécifié
            ))
            asyncio.create_task(broadcast_balance_update(
                to_user_id, 
                str(new_balance_to),     # En string
                balance_type="virtual"   # Type spécifié
            ))
        except ImportError:
            pass
        
        return {
            "success": True,
            "from_user_id": from_user_id,
            "to_user_id": to_user_id,
            "amount": str(amount_decimal),
            "old_balance_from": str(old_balance_from),
            "new_balance_from": str(new_balance_from),
            "old_balance_to": str(old_balance_to),
            "new_balance_to": str(new_balance_to),
            "description": description,
            "transaction_ids": [tx_out.id, tx_in.id],
            "concurrency_safe": True,
            "double_locked": True,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
    except ValueError as e:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur transfert avec double lock: {e}")
        raise ValueError(f"Erreur de transfert: {str(e)}")

# ============ FONCTIONS DE CAISSE SÉCURISÉES ============

@retry_on_deadlock
def get_platform_treasury(db: Session, lock: bool = False) -> PlatformTreasury:
    """
    Récupérer ou créer la caisse plateforme avec option de lock.
    """
    logger.info(f"💰 GET_PLATFORM_TREASURY: lock={lock}")
    
    try:
        if lock:
            with treasury_lock_context(db) as treasury:
                return treasury
        else:
            treasury = db.query(PlatformTreasury).first()
            if not treasury:
                logger.info("💰 Création initiale de la caisse plateforme")
                treasury = PlatformTreasury(balance=Decimal('0.00'), currency="FCFA")
                db.add(treasury)
                db.commit()
                db.refresh(treasury)
                logger.info(f"✅ Caisse plateforme créée avec ID: {treasury.id}")
            
            return treasury
            
    except Exception as e:
        logger.error(f"❌ Erreur get_platform_treasury: {e}")
        # Création d'urgence si échec
        treasury = PlatformTreasury(balance=Decimal('0.00'), currency="FCFA")
        db.add(treasury)
        db.commit()
        return treasury

@retry_on_deadlock
def update_platform_treasury(db: Session, amount: Decimal, description: str = "", 
                            related_user_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Mettre à jour la caisse plateforme avec lock exclusif.
    """
    logger.info(f"💰 UPDATE_PLATFORM_TREASURY: amount={amount}, desc={description[:50]}")
    
    try:
        with db.begin_nested():  # Transaction atomique
            # 🔒 Lock de la caisse
            with treasury_lock_context(db) as treasury:
                old_balance = treasury.balance
                treasury.balance += amount
                new_balance = treasury.balance
                
                # Transaction de log
                transaction = Transaction(
                    user_id=0,
                    type="treasury_update",  # 🔧 FIX: type field was missing
                    amount=amount,
                    transaction_type="treasury_update",
                    description=description or "Mise à jour caisse plateforme",
                    status="completed"
                )
                db.add(transaction)
                
                # Log admin détaillé
                fees_amount = amount if amount > Decimal('0') else Decimal('0.00')
                
                admin_log = AdminLog(
                    admin_id=0,
                    action="treasury_update",
                    details={
                        "amount": str(amount),
                        "old_balance": str(old_balance),
                        "new_balance": str(new_balance),
                        "description": description,
                        "related_user_id": related_user_id,
                        "transaction_id": transaction.id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "locked": True
                    },
                    fees_amount=fees_amount
                )
                db.add(admin_log)
                
                logger.info(f"✅ Caisse mise à jour avec lock: {old_balance} → {new_balance} (+{amount})")
        
        db.commit()
        
        # Broadcast aux admins
        try:
            from app.websockets import broadcast_global_stats
            asyncio.create_task(broadcast_global_stats({
                "treasury_balance": float(new_balance),
                "treasury_change": float(amount),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }))
        except ImportError:
            pass
        
        return {
            "success": True,
            "old_balance": str(old_balance),
            "new_balance": str(new_balance),
            "change": str(amount),
            "transaction_id": transaction.id,
            "admin_log_id": admin_log.id,
            "concurrency_safe": True,
            "locked": True
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur update_platform_treasury avec lock: {e}")
        raise ValueError(f"Erreur mise à jour caisse: {str(e)}")

# ============ FONCTIONS UTILITAIRES ============

def _handle_treasury_transaction(db: Session, user_id: int, amount: Decimal, 
                                transaction_type: str, description: str, 
                                status: str) -> Dict[str, Any]:
    """Gérer les transactions de caisse (pas de modification de wallet utilisateur)."""
    logger.info(f"🏛️  Treasury transaction: user={user_id}, type={transaction_type}")
    
    try:
        # CORRECTION : Utiliser la session db directement, PAS de context manager
        # car la route parente (admin.py) gère déjà la transaction avec db.begin_nested()
        
        transaction = Transaction(
            user_id=user_id,
            type=transaction_type,  # 🔧 FIX: type field was missing
            amount=amount,
            transaction_type=transaction_type,
            description=description,
            status=status,
            created_at=datetime.now(timezone.utc)
        )
        db.add(transaction)
        
        admin_log = AdminLog(
            admin_id=user_id if user_id != 0 else 0,
            action=f"treasury_{transaction_type}",
            details={
                "amount": str(amount),
                "description": description,
                "status": status,
                "timestamp": datetime.now(timezone.utc).isoformat()
            },
            fees_amount=Decimal('0.00'),
            created_at=datetime.now(timezone.utc)
        )
        db.add(admin_log)
        
        logger.info(f"💳 Transaction caisse ajoutée à la session: {transaction_type}")
        
        # IMPORTANT : Ne pas faire db.commit() ici !
        # La route parente (admin.py) s'en chargera dans son propre db.begin_nested()
        
        return {
            "transaction": transaction,
            "new_balance": None,
            "success": True,
            "transaction_type": transaction_type,
            "is_treasury_operation": True,
            "user_id": user_id
        }
        
    except Exception as e:
        logger.error(f"❌ Erreur transaction caisse: {e}")
        # Important : propager l'erreur pour que la route parente rollback
        raise ValueError(f"Erreur transaction caisse: {str(e)}")

@retry_on_deadlock
def get_transaction_history(db: Session, user_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Récupérer l'historique COMPLET des transactions.
    
    ✅ CORRECTION: Inclut maintenant:
    - Transactions normales (depot, retrait cash, achats BOOM)
    - PaymentTransaction (retraits de BOOM via mobile money)
    
    Retourne un format unifié compatible avec TransactionResponse du frontend.
    """
    # 1. Récupérer les Transaction classiques
    transactions = db.query(Transaction).filter(
        Transaction.user_id == user_id
    ).order_by(Transaction.created_at.desc()).all()
    
    # 2. Récupérer les PaymentTransaction (retraits de BOOM)
    payment_transactions = db.query(PaymentTransaction).filter(
        PaymentTransaction.user_id == user_id
    ).order_by(PaymentTransaction.created_at.desc()).all()
    
    # 3. Fusionner et convertir en format unifié
    combined = []
    
    # Ajouter les Transaction normales
    for tx in transactions:
        combined.append({
            'id': tx.id,
            'user_id': tx.user_id,
            'amount': float(tx.amount),
            'transaction_type': tx.transaction_type,
            'description': tx.description,
            'status': tx.status,
            'created_at': tx.created_at,
        })
    
    # Ajouter les PaymentTransaction (retraits de BOOM)
    # Ils ont le format: type='bom_withdrawal', fees, net_amount, etc.
    for pt in payment_transactions:
        # Générer un ID entier pseudo-unique basé sur l'ID string
        try:
            # Essayer d'extraire un nombre de l'ID
            id_parts = pt.id.split('_')
            if len(id_parts) > 1:
                pseudo_id = int(pt.id[-8:], 16) % (10**9)  # Dernier bytes en hexa
            else:
                pseudo_id = hash(pt.id) % (10**9)
        except:
            pseudo_id = hash(pt.id) % (10**9)
        
        combined.append({
            'id': pseudo_id,
            'user_id': pt.user_id,
            'amount': float(pt.net_amount),  # Le montant net reçu par l'utilisateur
            'transaction_type': f"{pt.type}_real",  # 'bom_withdrawal_real'
            'description': pt.description or f"Retrait BOOM: {pt.type}",
            'status': pt.status.value if hasattr(pt.status, 'value') else str(pt.status),
            'created_at': pt.created_at,
        })
    
    # 4. Trier par date décroissante et limiter
    combined.sort(key=lambda x: x['created_at'], reverse=True)
    combined = combined[:limit]
    
    logger.info(f"📋 Historique complet user {user_id}: {len(transactions)} transactions + {len(payment_transactions)} paiements = {len(combined)} total (limité à {limit})")
    
    return combined

@retry_on_deadlock
def initialize_user_wallet(db: Session, user_id: int) -> Wallet:
    """Initialiser le portefeuille d'un nouvel utilisateur."""
    with wallet_lock_context(db, user_id, "update") as wallet:
        if not wallet:
            wallet = Wallet(
                user_id=user_id, 
                balance=Decimal('0.00'), 
                currency="FCFA",
                created_at=datetime.now(timezone.utc)
            )
            db.add(wallet)
            db.commit()
            logger.info(f"🎯 Wallet initialisé pour user {user_id}")
        return wallet

@retry_on_deadlock
def force_wallet_update(db: Session, user_id: int, new_balance: float) -> Dict[str, Any]:
    """Forcer la mise à jour du solde (admin seulement)."""
    # Convertir le float en Decimal
    new_balance_decimal = Decimal(str(new_balance))
    
    with wallet_lock_context(db, user_id, "update") as wallet:
        if not wallet:
            wallet = Wallet(user_id=user_id, balance=new_balance_decimal, currency="FCFA")
            db.add(wallet)
            old_balance = Decimal('0.00')
        else:
            old_balance = wallet.balance if wallet.balance is not None else Decimal('0.00')
            wallet.balance = new_balance_decimal
        
        admin_log = AdminLog(
            admin_id=0,
            action="force_wallet_update",
            details={
                "user_id": user_id,
                "old_balance": str(old_balance),
                "new_balance": str(new_balance),
                "delta": str(new_balance_decimal - old_balance)
            },
            fees_amount=Decimal('0.00')
        )
        db.add(admin_log)
        
        db.commit()
        
        logger.info(f"✅ Solde forcé avec lock pour user {user_id}: {old_balance} → {wallet.balance}")
        
        return {
            "user_id": user_id,
            "old_balance": str(old_balance),
            "new_balance": str(wallet.balance),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "concurrency_safe": True
        }

def get_treasury_status(db: Session) -> Dict[str, Any]:
    """Obtenir le statut complet de la caisse plateforme."""
    treasury = get_platform_treasury(db)
    
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    
    recent_transactions = db.query(Transaction).filter(
        Transaction.transaction_type.in_(["treasury_update", "treasury_deposit", "treasury_withdrawal"]),
        Transaction.created_at >= thirty_days_ago
    ).count()
    
    transactions = db.query(Transaction).filter(
        Transaction.transaction_type.in_(["treasury_update", "treasury_deposit", "treasury_withdrawal"]),
        Transaction.created_at >= thirty_days_ago
    ).all()
    
    total_inflows = Decimal('0.00')
    total_outflows = Decimal('0.00')
    total_fees = Decimal('0.00')
    
    for tx in transactions:
        if tx.amount > 0:
            total_inflows += tx.amount
        else:
            total_outflows += abs(tx.amount)
    
    admin_logs = db.query(AdminLog).filter(
        AdminLog.action.in_(["treasury_update", "large_transaction"]),
        AdminLog.created_at >= thirty_days_ago
    ).all()
    
    for log in admin_logs:
        if log.fees_amount:
            total_fees += log.fees_amount
    
    return {
        "current_balance": str(treasury.balance),
        "currency": treasury.currency,
        "created_at": treasury.created_at.isoformat() if treasury.created_at else None,
        "updated_at": treasury.updated_at.isoformat() if treasury.updated_at else None,
        "recent_activity": {
            "last_30_days_transactions": recent_transactions,
            "total_inflows": str(total_inflows),
            "total_outflows": str(total_outflows),
            "total_fees_collected": str(total_fees),
            "net_change": str(total_inflows - total_outflows)
        }
    }

@retry_on_deadlock
def create_transaction_with_fees(db: Session, user_id: int, amount: float, 
                                transaction_type: str, description: str, 
                                fees_amount: float = 0.0, status: str = "completed") -> Dict[str, Any]:
    """Créer une transaction avec frais spécifiques."""
    logger.info(f"💳 create_transaction_with_fees - user={user_id}, amount={amount}, fees={fees_amount}")
    
    # Convertir les floats en Decimal
    amount_decimal = Decimal(str(amount))
    fees_decimal = Decimal(str(fees_amount))
    
    result = create_transaction(
        db=db,
        user_id=user_id,
        amount=float(amount_decimal),
        transaction_type=transaction_type,
        description=description,
        status=status
    )
    
    if fees_decimal > 0:
        try:
            with db.begin_nested():  # Transaction atomique
                admin_log = AdminLog(
                    admin_id=0,
                    action=f"{transaction_type}_fees",
                    details={
                        "user_id": user_id,
                        "transaction_id": result.get("transaction").id,
                        "amount": str(amount_decimal),
                        "fees": str(fees_decimal),
                        "type": transaction_type,
                        "description": description
                    },
                    fees_amount=fees_decimal
                )
                db.add(admin_log)
            
            db.commit()
            logger.info(f"📝 Log frais créé: {fees_decimal} FCFA pour transaction {transaction_type}")
        except Exception as e:
            logger.warning(f"⚠️ Erreur création log frais: {e}")
            db.rollback()
    
    return result

# ============ FONCTIONS DE BATCH SÉCURISÉES ============

@retry_on_deadlock
def batch_update_wallets(db: Session, updates: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Mettre à jour plusieurs wallets en une transaction atomique.
    Idéal pour les redistributions, bonus de masse, etc.
    """
    logger.info(f"📦 BATCH_UPDATE_WALLETS: {len(updates)} mises à jour")
    
    if not updates:
        return {"success": True, "processed": 0, "message": "Aucune mise à jour"}
    
    results = []
    total_changes = Decimal('0.00')
    
    try:
        with db.begin_nested():  # Transaction atomique
            # 🔒 Lock tous les wallets concernés en une seule requête
            user_ids = [update["user_id"] for update in updates]
            stmt = select(Wallet).where(Wallet.user_id.in_(user_ids)).with_for_update()
            wallets_by_id = {w.user_id: w for w in db.execute(stmt).scalars().all()}
            
            for update in updates:
                user_id = update["user_id"]
                amount = Decimal(str(update["amount"]))
                operation = update.get("operation", "add")  # 'add' ou 'subtract'
                description = update.get("description", "Mise à jour batch")
                
                # Récupérer ou créer le wallet
                wallet = wallets_by_id.get(user_id)
                if not wallet:
                    wallet = Wallet(user_id=user_id, balance=Decimal('0.00'), currency="FCFA")
                    db.add(wallet)
                    wallets_by_id[user_id] = wallet
                
                if wallet.balance is None:
                    wallet.balance = Decimal('0.00')
                
                old_balance = wallet.balance
                
                # Appliquer l'opération
                if operation == "add":
                    wallet.balance += amount
                    change_type = "credit"
                elif operation == "subtract":
                    if wallet.balance < amount:
                        raise ValueError(f"Solde insuffisant pour user {user_id}: {wallet.balance} < {amount}")
                    wallet.balance -= amount
                    change_type = "debit"
                else:
                    raise ValueError(f"Opération invalide: {operation}")
                
                new_balance = wallet.balance
                total_changes += amount if operation == "add" else -amount
                
                # Créer la transaction
                tx_type = f"batch_{change_type}"
                transaction = Transaction(
                    user_id=user_id,
                    type=tx_type,  # 🔧 FIX: type field was missing
                    amount=amount,
                    transaction_type=tx_type,
                    description=description,
                    status="completed"
                )
                db.add(transaction)
                
                results.append({
                    "user_id": user_id,
                    "old_balance": str(old_balance),
                    "new_balance": str(new_balance),
                    "change": str(amount),
                    "change_type": change_type,
                    "transaction_id": transaction.id,
                    "success": True
                })
            
            # Log admin batch
            admin_log = AdminLog(
                admin_id=0,
                action="batch_wallet_update",
                details={
                    "updates_count": len(updates),
                    "total_changes": str(total_changes),
                    "user_ids": user_ids,
                    "results": results,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                },
                fees_amount=Decimal('0.00')
            )
            db.add(admin_log)
        
        db.commit()
        logger.info(f"✅ Batch update réussi: {len(updates)} wallets mis à jour")
        
        return {
            "success": True,
            "processed": len(updates),
            "total_changes": str(total_changes),
            "results": results,
            "concurrency_safe": True,
            "batch_locked": True
        }
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur batch update: {e}")
        raise ValueError(f"Erreur batch update: {str(e)}")

# ============ FONCTIONS DE DIAGNOSTIC ============

def get_concurrency_stats(db: Session) -> Dict[str, Any]:
    """
    Obtenir des statistiques sur les opérations concurrentielles.
    """
    from sqlalchemy import func
    
    # Compter les transactions avec locks
    total_transactions = db.query(func.count(Transaction.id)).scalar() or 0
    
    # Transactions importantes (> 100k)
    large_tx_count = db.query(func.count(Transaction.id)).filter(
        Transaction.amount > 100000
    ).scalar() or 0
    
    # Transactions récentes (24h)
    recent_tx_count = db.query(func.count(Transaction.id)).filter(
        Transaction.created_at >= datetime.now(timezone.utc) - timedelta(hours=24)
    ).scalar() or 0
    
    # Logs admin
    admin_logs_count = db.query(func.count(AdminLog.id)).scalar() or 0
    
    # Caisse
    treasury = get_platform_treasury(db)
    
    return {
        "database": {
            "total_transactions": total_transactions,
            "large_transactions": large_tx_count,
            "recent_transactions_24h": recent_tx_count,
            "admin_logs": admin_logs_count
        },
        "treasury": {
            "balance": str(treasury.balance),
            "currency": treasury.currency
        },
        "concurrency": {
            "lock_timeout": LOCK_TIMEOUT,
            "max_retries": MAX_RETRIES,
            "deadlock_retry_delay": DEADLOCK_RETRY_DELAY,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    }

def validate_wallet_integrity(db: Session, user_id: int) -> Dict[str, Any]:
    """
    Valider l'intégrité du wallet d'un utilisateur.
    Vérifie la cohérence entre les transactions et le solde.
    """
    logger.info(f"🔍 VALIDATE_WALLET_INTEGRITY: user={user_id}")
    
    try:
        # Récupérer le wallet avec lock
        with wallet_lock_context(db, user_id, "read") as wallet:
            if not wallet:
                return {
                    "valid": False,
                    "user_id": user_id,
                    "error": "Wallet non trouvé",
                    "balance": "0.00",
                    "calculated_balance": "0.00",
                    "difference": "0.00"
                }
            
            current_balance = wallet.balance if wallet.balance is not None else Decimal('0.00')
            
            # Calculer le solde à partir des transactions
            credit_types = ['deposit', 'transfer_received', 'boom_sell', 'refund',
                          'royalties_received', 'bonus_received', 'refund_received',
                          'correction_received', 'other_redistribution_received',
                          'income', 'reward', 'cashback', 'gift_received']
            
            debit_types = ['purchase', 'nft_purchase', 'withdrawal', 'transfer_sent',
                          'boom_purchase', 'royalties_payout', 'bonus_payout',
                          'refund_payout', 'correction_payout', 'other_redistribution_payout',
                          'fee', 'commission', 'penalty', 'gift_fee', 'gift_sharing_fee']
            
            from sqlalchemy import func
            credits = db.query(func.sum(Transaction.amount)).filter(
                Transaction.user_id == user_id,
                Transaction.transaction_type.in_(credit_types)
            ).scalar() or Decimal('0.00')
            
            debits = db.query(func.sum(Transaction.amount)).filter(
                Transaction.user_id == user_id,
                Transaction.transaction_type.in_(debit_types)
            ).scalar() or Decimal('0.00')
            
            calculated_balance = credits - debits
            difference = abs(current_balance - calculated_balance)
            
            is_valid = difference < Decimal('0.01')  # Tolérance de 0.01 FCFA
            
            result = {
                "valid": is_valid,
                "user_id": user_id,
                "balance": str(current_balance),
                "calculated_balance": str(calculated_balance),
                "difference": str(difference),
                "credits": str(credits),
                "debits": str(debits),
                "transaction_count": db.query(func.count(Transaction.id)).filter(
                    Transaction.user_id == user_id
                ).scalar() or 0,
                "locked": True
            }
            
            if not is_valid:
                logger.warning(f"⚠️ Incohérence wallet détectée pour user {user_id}: "
                              f"{current_balance} != {calculated_balance} (Δ{difference})")
            
            return result
            
    except Exception as e:
        logger.error(f"❌ Erreur validation wallet: {e}")
        return {
            "valid": False,
            "user_id": user_id,
            "error": str(e),
            "balance": "0.00",
            "calculated_balance": "0.00",
            "difference": "0.00",
            "locked": False
        }

# ============ FONCTIONS UTILITAIRES AJOUTÉES ============

def get_transaction_target(transaction_type: str) -> Dict[str, Any]:
    """
    Retourne la cible et l'opération pour un type de transaction.
    MISE À JOUR: Inclure gift_sent_real comme débit réel
    """
    if transaction_type in NEUTRAL_TYPES:
        return {"target": "neutral", "operation": "none"}
    
    # Gestion explicite des gifts
    if transaction_type == "gift_sent_real":
        return {"target": "real", "operation": "debit"}
    if transaction_type == "gift_received_real":
        return {"target": "real", "operation": "credit"}
    if transaction_type == "gift_fee_real":
        return {"target": "real", "operation": "debit"}
    
    if "redistribution" in transaction_type.lower():
        return {"target": "virtual", "operation": "credit"}
    
    # Par défaut : RÉEL
    if any(x in transaction_type.lower() for x in ['deposit', 'sell', 'received', 'refund', 'bonus']):
        return {"target": "real", "operation": "credit"}
    elif any(x in transaction_type.lower() for x in ['withdrawal', 'purchase', 'sent', 'fee', 'penalty']):
        return {"target": "real", "operation": "debit"}
    else:
        return {"target": "real", "operation": "credit"}


def explain_transaction_flow(transaction_type: str, amount: Decimal, user_id: int) -> str:
    """
    Génère une explication claire du flux pour les logs.
    """
    target_info = get_transaction_target(transaction_type)
    target = target_info["target"]
    operation = target_info["operation"]
    
    explanations = {
        "real": {
            "credit": f"💰 CRÉDIT RÉEL de {amount} FCFA pour user {user_id}",
            "debit": f"💸 DÉBIT RÉEL de {amount} FCFA pour user {user_id}"
        },
        "virtual": {
            "credit": f"🎁 CRÉDIT VIRTUEL (redistribution) de {amount} FCFA pour user {user_id}",
            "debit": f"⚠️ DÉBIT VIRTUEL (correction) de {amount} FCFA pour user {user_id}"
        },
        "neutral": f"📝 Transaction NEUTRE: {transaction_type}"
    }
    
    return explanations.get(target, {}).get(operation, f"Transaction {transaction_type}")

def verify_gift_transaction_integrity(db: Session, gift_reference: str) -> Dict[str, Any]:
    """
    Vérifie l'intégrité d'une transaction cadeau
    Utile pour debug et audit
    """
    logger.info(f"🔍 VERIFY GIFT TRANSACTION: {gift_reference}")
    
    try:
        # Trouver la transaction
        transaction = db.query(Transaction).filter(
            Transaction.reference == gift_reference,
            Transaction.transaction_type == "gift_sent_real"
        ).first()
        
        if not transaction:
            return {
                "found": False,
                "gift_reference": gift_reference,
                "error": "Transaction non trouvée"
            }
        
        # Vérifier CashBalance correspondant
        cash_balance = db.query(CashBalance).filter(
            CashBalance.user_id == transaction.user_id
        ).first()
        
        # Vérifier dans gift_transactions
        from app.models.gift_models import GiftTransaction
        gift = db.query(GiftTransaction).filter(
            GiftTransaction.transaction_reference == gift_reference
        ).first()
        
        result = {
            "found": True,
            "transaction": {
                "id": transaction.id,
                "user_id": transaction.user_id,
                "amount": float(transaction.amount),
                "type": transaction.transaction_type,
                "description": transaction.description,
                "created_at": transaction.created_at.isoformat() if transaction.created_at else None
            },
            "cash_balance": {
                "available": float(cash_balance.available_balance) if cash_balance else None,
                "user_id": cash_balance.user_id if cash_balance else None
            },
            "gift": {
                "exists": gift is not None,
                "id": gift.id if gift else None,
                "status": gift.status if gift else None,
                "wallet_transaction_ids": gift.wallet_transaction_ids if gift else None
            },
            "integrity_check": {
                "amount_match": gift and transaction and gift.gross_amount == transaction.amount,
                "user_match": gift and transaction and gift.sender_id == transaction.user_id,
                "in_wallet_ids": gift and transaction and transaction.id in (gift.wallet_transaction_ids or []),
                "timestamp_consistent": gift and transaction and (
                    gift.paid_at and transaction.created_at and 
                    abs((gift.paid_at - transaction.created_at).total_seconds()) < 5
                )
            }
        }
        
        logger.info(f"✅ Vérification gift {gift_reference}: {result['integrity_check']}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Erreur vérification gift: {e}")
        return {
            "found": False,
            "gift_reference": gift_reference,
            "error": str(e)
        }
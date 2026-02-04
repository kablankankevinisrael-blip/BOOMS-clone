from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from typing import List, Optional
import json
from decimal import Decimal
from pydantic import BaseModel 
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, IntegrityError
from app.database import get_db
from app.models.bom_models import BomAsset, NFTCollection, UserBom
from app.models.user_models import User, Wallet, TransactionType
from app.models.transaction_models import Transaction
from app.models.admin_models import AdminLog
from app.models.admin_models import PlatformTreasury
from app.models.payment_models import PaymentTransaction, CashBalance
from app.schemas.bom_schemas import NFTCreate, NFTResponse, CollectionCreate, CollectionResponse
from app.schemas.admin_schemas import AdminStats, UserAdminResponse, RedistributionRequest, TreasuryBalanceResponse, TreasuryTransactionResponse, TreasuryDepositRequest, TreasuryWithdrawRequest, TreasuryStatsResponse
from app.schemas.wallet_schemas import TransactionResponse
from app.schemas.payment_schemas import PaymentTransactionResponse
from app.schemas.gift_schemas import GiftResponse
from app.services.auth import get_current_user_from_token
from app.services.wallet_service import create_transaction
from app.services.wallet_service import get_platform_treasury
from app.websockets import broadcast_balance_update
import uuid
import logging
from datetime import datetime, timedelta
from sqlalchemy import func
import asyncio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# ============ CONSTANTES DE SÉCURITÉ ============
MAX_RETRIES = 3
DEADLOCK_RETRY_DELAY = 0.1
LOCK_TIMEOUT = 30

def verify_admin(current_user: User = Depends(get_current_user_from_token)):
    """Vérifier si l'utilisateur est admin"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")
    return current_user

# ============ FONCTION UTILITAIRE: CALCUL DES GAINS BOOM RÉELS ============
def calculate_user_boom_gains(user_id: int, db: Session) -> Decimal:
    """
    Calculer les vrais gains BOOM pour un utilisateur
    = Somme de (withdrawal_amount - purchase_price) pour chaque BOOM retraité
    
    Même logique que la page Treasury "Gains aux Utilisateurs"
    Les retraits se trouvent dans PaymentTransaction, les achats dans Transaction
    """
    total_gains = Decimal('0.00')
    
    # 1️⃣ Chercher les retraits BOOM dans PaymentTransaction (source de vérité)
    withdrawals = db.query(PaymentTransaction).filter(
        PaymentTransaction.user_id == user_id,
        PaymentTransaction.type.in_(['bom_withdrawal', 'boom_withdrawal'])
    ).all()
    
    logger.info(f"[GAINS] User {user_id}: Found {len(withdrawals)} BOM withdrawals from PaymentTransaction")
    
    for withdrawal in withdrawals:
        # Récupérer le nom du BOOM depuis la description
        # Format: "Retrait Bom externe: LACRANE vers ..."
        boom_name = None
        if withdrawal.description:
            parts = withdrawal.description.split(':')
            if len(parts) > 1:
                # Extraire le nom du BOOM (entre ":" et "vers")
                boom_part = parts[1].split('vers')[0].strip().upper()
                boom_name = boom_part
        
        if not boom_name:
            logger.debug(f"[GAINS] User {user_id}: Could not extract BOOM name from: {withdrawal.description}")
            continue
        
        logger.debug(f"[GAINS] User {user_id}: Processing {boom_name} withdrawal of {withdrawal.amount}")
        
        # 2️⃣ Chercher les achats correspondants dans Transaction
        purchases = db.query(Transaction).filter(
            Transaction.user_id == user_id,
            Transaction.transaction_type.in_(['boom_purchase', 'bom_purchase']),
            Transaction.description.ilike(f'%{boom_name}%')
        ).all()
        
        if not purchases:
            logger.debug(f"[GAINS] User {user_id}: No purchases found for {boom_name}")
            continue
        
        logger.debug(f"[GAINS] User {user_id}: Found {len(purchases)} purchases for {boom_name}")
        
        # Trouver l'achat le plus proche AVANT le retrait
        withdrawal_time = withdrawal.created_at.timestamp() if withdrawal.created_at else 0
        matching_purchase = None
        closest_time = -1
        
        for purchase in purchases:
            purchase_time = purchase.created_at.timestamp() if purchase.created_at else 0
            
            # L'achat doit être AVANT le retrait
            if purchase_time < withdrawal_time:
                # Chercher l'achat le plus proche (le plus récent avant le retrait)
                if purchase_time > closest_time:
                    closest_time = purchase_time
                    matching_purchase = purchase
        
        if matching_purchase:
            # Extraire la "Valeur Sociale" de la description (prix sans frais)
            # Format: "Valeur sociale: 5605.22 FCFA" ou "Valeur sociale: 3462,29"
            import re
            purchase_price = matching_purchase.amount
            social_value_match = re.search(
                r'Valeur\s+sociale:\s*([\d,\.]+)',
                matching_purchase.description or '',
                re.IGNORECASE
            )
            if social_value_match:
                social_value_str = social_value_match.group(1).replace(',', '.')
                try:
                    purchase_price = Decimal(social_value_str)
                    logger.debug(f"[GAINS] User {user_id}: Extracted social value {purchase_price} for {boom_name}")
                except:
                    logger.debug(f"[GAINS] User {user_id}: Could not convert social value {social_value_str}")
                    purchase_price = matching_purchase.amount
            
            # Calculer le gain: retrait - valeur sociale (pas les frais)
            withdrawal_amount = Decimal(str(withdrawal.amount))
            gain = withdrawal_amount - purchase_price
            logger.debug(f"[GAINS] User {user_id}: {boom_name} gain = {withdrawal_amount} - {purchase_price} = {gain}")
            if gain > 0:
                total_gains += gain
                logger.info(f"[GAINS] User {user_id}: ✅ Positive gain detected: {boom_name} = {gain}")
            else:
                logger.debug(f"[GAINS] User {user_id}: No positive gain for {boom_name} ({gain})")
        else:
            logger.debug(f"[GAINS] User {user_id}: No matching purchase before withdrawal for {boom_name}")
    
    logger.info(f"[GAINS] User {user_id}: Total gains = {total_gains} FCFA")
    return total_gains

# ============ NOUVELLES FONCTIONS POUR LES SOLDES DYNAMIQUES ============

@router.get("/user-funds", response_model=List[dict])
def get_all_user_funds(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Renvoie les soldes calculés dynamiquement depuis les transactions"""
    users = db.query(User).all()
    result = []

    # Types de transaction pour calcul des soldes
    CREDIT_TYPES = [
        'deposit', 'transfer_received', 'royalties_received', 
        'bonus_received', 'refund_received', 'correction_received',
        'other_redistribution_received', 'income', 'reward', 'cashback',
        'gift_received', 'boom_sell'
    ]
    
    DEBIT_TYPES = [
        'withdrawal', 'transfer_sent', 'royalties_payout', 
        'bonus_payout', 'refund_payout', 'correction_payout',
        'other_redistribution_payout', 'purchase', 'nft_purchase',
        'boom_purchase', 'fee', 'commission', 'penalty', 'gift_fee',
        'gift_sharing_fee'
    ]

    for user in users:
        # 1. Solde RÉEL depuis CashBalance (source de vérité)
        cash_balance = db.query(CashBalance).filter(CashBalance.user_id == user.id).first()
        real_balance = cash_balance.available_balance if cash_balance and cash_balance.available_balance is not None else Decimal('0.00')
        
        # 2. Solde VIRTUEL depuis Wallet (redistributions)
        wallet = db.query(Wallet).filter(Wallet.user_id == user.id).first()
        virtual_balance = wallet.balance if wallet and wallet.balance is not None else Decimal('0.00')
        
        # 3. Vérifier écart pour debug
        difference = abs(real_balance - virtual_balance)
        has_discrepancy = difference > Decimal('0.01')
        
        # Compter le nombre de transactions
        transaction_count = db.query(func.count(Transaction.id)).filter(
            Transaction.user_id == user.id
        ).scalar() or 0

        # Récupérer la dernière date de transaction (CORRECTION ICI)
        last_transaction_query = db.query(Transaction.created_at).filter(
            Transaction.user_id == user.id
        ).order_by(Transaction.created_at.desc()).first()
        
        # Convertir en string ISO ou None
        if last_transaction_query:
            last_transaction_date = last_transaction_query[0].isoformat() if last_transaction_query[0] else None
        else:
            last_transaction_date = None

        # Récupérer les retraits en attente (withdrawal avec status pending)
        pending_withdrawals = db.query(func.sum(Transaction.amount)).filter(
            Transaction.user_id == user.id,
            Transaction.transaction_type == 'withdrawal',
            Transaction.status == 'pending'
        ).scalar() or Decimal('0.00')
        
        # Récupérer les vrais gains BOOM (pas les frais!)
        boom_gains = calculate_user_boom_gains(user.id, db)

        result.append({
            "user_id": user.id,
            "full_name": user.full_name or "Inconnu",
            "phone": user.phone,
            "cash_balance": str(real_balance),  # Solde RÉEL (CashBalance) = argent déposé
            "wallet_balance": str(virtual_balance),  # Portefeuille VIRTUEL (Wallet) = redistributions
            "pending_withdrawals": str(pending_withdrawals),  # Retraits en attente (vrais)
            "total_commissions_earned": str(boom_gains),  # ✅ Gains RÉELS des retraits BOOM (pas frais!)
            "has_discrepancy": has_discrepancy,
            "discrepancy_amount": str(difference) if has_discrepancy else "0.00",
            "last_transaction_date": last_transaction_date
        })

    logger.info(f"📊 {len(result)} utilisateurs avec soldes calculés depuis transactions")
    return result

@router.get("/users/{user_id}/funds", response_model=dict)
def get_user_funds_detailed(
    user_id: int,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer les fonds d'un utilisateur depuis la source de vérité (CashBalance et Wallet)"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # 1. Solde RÉEL depuis CashBalance (source de vérité)
    cash_balance = db.query(CashBalance).filter(CashBalance.user_id == user_id).first()
    real_balance = cash_balance.available_balance if cash_balance and cash_balance.available_balance is not None else Decimal('0.00')
    
    # 2. Solde VIRTUEL depuis Wallet (redistributions)
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    virtual_balance = wallet.balance if wallet and wallet.balance is not None else Decimal('0.00')
    
    # 3. Retraits en attente
    pending_withdrawals = db.query(func.sum(Transaction.amount)).filter(
        Transaction.user_id == user_id,
        Transaction.transaction_type == 'withdrawal',
        Transaction.status == 'pending'
    ).scalar() or Decimal('0.00')
    
    # 4. Commissions gagnées
    commissions_earned = db.query(func.sum(PaymentTransaction.fees)).filter(
        PaymentTransaction.user_id == user_id,
        PaymentTransaction.fees > 0
    ).scalar() or Decimal('0.00')
    
    # 5. Écart (pour déterminer si OK ou pas)
    difference = abs(real_balance - virtual_balance)
    
    return {
        "success": True,
        "user_id": user_id,
        "full_name": user.full_name or f"User {user_id}",
        "phone": user.phone,
        "cash_balance": str(real_balance),  # Solde RÉEL = CashBalance.available_balance
        "wallet_balance": str(virtual_balance),  # Portefeuille VIRTUEL = Wallet.balance
        "pending_withdrawals": str(pending_withdrawals),  # Retraits en attente (vrais)
        "total_commissions_earned": str(commissions_earned),  # Commissions gagnées (vrais)
        "discrepancy": str(difference),  # Écart entre les deux
        "has_discrepancy": difference > Decimal('0.01')
    }

@router.post("/recalculate-balances")
async def recalculate_all_balances(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Recalculer tous les soldes depuis les transactions et synchroniser avec les wallets"""
    users = db.query(User).all()
    results = []
    discrepancies_fixed = 0
    
    # Types de transaction pour le calcul
    CREDIT_TYPES = [
        'deposit', 'transfer_received', 'royalties_received', 
        'bonus_received', 'refund_received', 'correction_received',
        'other_redistribution_received'
    ]
    
    DEBIT_TYPES = [
        'withdrawal', 'transfer_sent', 'royalties_payout', 
        'bonus_payout', 'refund_payout', 'correction_payout',
        'other_redistribution_payout'
    ]
    
    for user in users:
        # Calculer le solde depuis les transactions
        credits = db.query(func.sum(Transaction.amount)).filter(
            Transaction.user_id == user.id,
            Transaction.transaction_type.in_(CREDIT_TYPES)
        ).scalar() or Decimal('0.00')
        
        debits = db.query(func.sum(Transaction.amount)).filter(
            Transaction.user_id == user.id,
            Transaction.transaction_type.in_(DEBIT_TYPES)
        ).scalar() or Decimal('0.00')
        
        calculated_balance = credits - debits
        
        # Mettre à jour le wallet
        wallet = db.query(Wallet).filter(Wallet.user_id == user.id).first()
        if not wallet:
            wallet = Wallet(user_id=user.id, balance=calculated_balance, currency="FCFA")
            db.add(wallet)
            action = "created"
            discrepancies_fixed += 1
        else:
            old_balance = wallet.balance if wallet.balance is not None else Decimal('0.00')
            if abs(old_balance - calculated_balance) > Decimal('0.01'):
                wallet.balance = calculated_balance
                action = f"updated ({old_balance} → {calculated_balance})"
                discrepancies_fixed += 1
            else:
                action = "unchanged"
        
        results.append({
            "user_id": user.id,
            "phone": user.phone,
            "calculated_balance": str(calculated_balance),
            "wallet_balance": str(wallet.balance),
            "action": action
        })
    
    db.commit()
    
    # Log admin
    admin_log = AdminLog(
        admin_id=current_user.id,
        action="recalculate_balances",
        details={
            "users_count": len(users),
            "discrepancies_fixed": discrepancies_fixed,
            "results": results
        },
        fees_amount=Decimal('0.00')
    )
    db.add(admin_log)
    db.commit()
    
    logger.info(f"✅ Soldes recalculés: {len(users)} utilisateurs, {discrepancies_fixed} incohérences corrigées")
    
    return {
        "success": True,
        "message": f"Solde de {len(users)} utilisateurs recalculés, {discrepancies_fixed} incohérences corrigées",
        "users_processed": len(users),
        "discrepancies_fixed": discrepancies_fixed,
        "results": results
    }

@router.get("/balance-sync-check")
async def check_balance_sync(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Vérifier la synchronisation entre transactions et wallets"""
    users = db.query(User).all()
    discrepancies = []
    
    CREDIT_TYPES = [
        'deposit', 'transfer_received', 'royalties_received', 
        'bonus_received', 'refund_received', 'correction_received',
        'other_redistribution_received'
    ]
    
    DEBIT_TYPES = [
        'withdrawal', 'transfer_sent', 'royalties_payout', 
        'bonus_payout', 'refund_payout', 'correction_payout',
        'other_redistribution_payout'
    ]
    
    for user in users:
        # Calculer depuis transactions
        credits = db.query(func.sum(Transaction.amount)).filter(
            Transaction.user_id == user.id,
            Transaction.transaction_type.in_(CREDIT_TYPES)
        ).scalar() or Decimal('0.00')
        
        debits = db.query(func.sum(Transaction.amount)).filter(
            Transaction.user_id == user.id,
            Transaction.transaction_type.in_(DEBIT_TYPES)
        ).scalar() or Decimal('0.00')
        
        calculated = credits - debits
        
        # Récupérer le wallet
        wallet = db.query(Wallet).filter(Wallet.user_id == user.id).first()
        wallet_balance = wallet.balance if wallet else Decimal('0.00')
        
        # Vérifier la différence
        difference = abs(calculated - wallet_balance)
        if difference > Decimal('0.01'):
            discrepancies.append({
                "user_id": user.id,
                "phone": user.phone,
                "full_name": user.full_name or f"User {user.id}",
                "calculated": str(calculated),
                "wallet": str(wallet_balance),
                "difference": str(difference),
                "has_wallet": wallet is not None
            })
    
    return {
        "total_users": len(users),
        "discrepancies_count": len(discrepancies),
        "discrepancies": discrepancies,
        "all_synced": len(discrepancies) == 0,
        "check_time": datetime.utcnow().isoformat()
    }

# ============ ROUTE REDISTRIBUTION CORRIGÉE ============

@router.post("/redistribute", response_model=dict)
async def redistribute_funds(
    request: RedistributionRequest,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db),
):
    """
    Redistribution manuelle de fonds - Version 100% sécurisée avec transactions atomiques
    CORRIGÉE DÉFINITIVEMENT : Pas de with db.begin() - FastAPI gère la transaction
    """
  
    logger.info(f"💰 REDISTRIBUTION START - Admin:{current_user.id}, "
               f"From:{request.from_user_id}, To:{request.to_user_id}, "
               f"Amount:{request.amount}, Reason:{request.reason}")
  
    retry_count = 0
  
    while retry_count < MAX_RETRIES:
        try:
            # PAS DE with db.begin() ou begin_nested()
            # FastAPI gère déjà la transaction automatiquement

            # 1. VALIDATION
            if request.amount <= 0:
                raise HTTPException(status_code=400, detail="Le montant doit être positif")
          
            amount_decimal = Decimal(str(request.amount))
          
            # 2. CHARGEMENT DES UTILISATEURS + STOCKAGE IMMÉDIAT
            from_user = None
            from_user_id_log = request.from_user_id
            from_user_phone_log = "Plateforme"
            from_user_name_log = "Plateforme"
          
            if request.from_user_id:
                from_user_stmt = select(User).where(User.id == request.from_user_id).with_for_update()
                from_user = db.execute(from_user_stmt).scalar_one_or_none()
                if not from_user:
                    raise HTTPException(status_code=404, detail="Utilisateur source introuvable")
                from_user_phone_log = from_user.phone
                from_user_name_log = from_user.full_name or from_user.phone
          
            to_user_stmt = select(User).where(User.id == request.to_user_id).with_for_update()
            to_user = db.execute(to_user_stmt).scalar_one_or_none()
            if not to_user:
                raise HTTPException(status_code=404, detail="Utilisateur destinataire introuvable")
          
            to_user_id_log = to_user.id
            to_user_phone_log = to_user.phone
            to_user_name_log = to_user.full_name or to_user.phone
          
            logger.info(f"👤 Utilisateurs vérifiés: Source={from_user_id_log or 'Plateforme'}, Destinataire={to_user_id_log}")
          
            # 3. TYPES DE TRANSACTION
            transaction_types = {
                "royalties": {"sent": "royalties_payout", "received": "royalties_received"},
                "bonus": {"sent": "bonus_payout", "received": "bonus_received"},
                "refund": {"sent": "refund_payout", "received": "refund_received"},
                "correction": {"sent": "correction_payout", "received": "correction_received"},
                "other": {"sent": "other_redistribution_payout", "received": "other_redistribution_received"}
            }
            tx_type = transaction_types.get(request.reason, transaction_types["other"])
          
            debit_tx_id = "pending"
            credit_tx_id = "pending"
          
            # 4. GESTION SOURCE DES FONDS
            if not from_user:
                treasury_stmt = select(PlatformTreasury).with_for_update()
                treasury = db.execute(treasury_stmt).scalar_one_or_none()
                if not treasury:
                    treasury = PlatformTreasury(balance=Decimal('0.00'), currency="FCFA")
                    db.add(treasury)
              
                old_treasury_balance = treasury.balance
                if treasury.balance < amount_decimal:
                    raise HTTPException(status_code=400, detail=f"Solde caisse insuffisant: {treasury.balance} FCFA")
              
                treasury.balance -= amount_decimal
                new_treasury_balance = treasury.balance
              
                treasury_tx = create_transaction(
                    db=db,
                    user_id=0,
                    amount=float(amount_decimal),
                    transaction_type="treasury_withdrawal",
                    description=f"Redistribution admin vers user {to_user_id_log} - {request.reason}: {request.description or ''}"
                )
                debit_tx_id = treasury_tx.get("transaction_id", "pending")
          
            else:
                from_wallet_stmt = select(Wallet).where(Wallet.user_id == from_user_id_log).with_for_update()
                from_wallet = db.execute(from_wallet_stmt).scalar_one_or_none()
                if not from_wallet:
                    from_wallet = Wallet(user_id=from_user_id_log, balance=Decimal('0.00'), currency="FCFA")
                    db.add(from_wallet)
              
                old_from_balance = from_wallet.balance
                if from_wallet.balance < amount_decimal:
                    raise HTTPException(status_code=400, detail=f"Solde insuffisant user {from_user_id_log}")
              
                from_wallet.balance -= amount_decimal
                new_from_balance = from_wallet.balance
              
                debit_tx = create_transaction(
                    db=db,
                    user_id=from_user_id_log,
                    amount=float(amount_decimal),
                    transaction_type=tx_type["sent"],
                    description=f"Redistribution admin vers user {to_user_id_log} - {request.reason}: {request.description or ''}"
                )
                debit_tx_id = debit_tx.get("transaction_id", "pending")
          
            # 5. CRÉDIT DESTINATAIRE
            to_wallet_stmt = select(Wallet).where(Wallet.user_id == to_user_id_log).with_for_update()
            to_wallet = db.execute(to_wallet_stmt).scalar_one_or_none()
            if not to_wallet:
                to_wallet = Wallet(user_id=to_user_id_log, balance=Decimal('0.00'), currency="FCFA")
                db.add(to_wallet)
          
            old_to_balance = to_wallet.balance
            to_wallet.balance += amount_decimal
            new_to_balance = to_wallet.balance
          
            credit_tx = create_transaction(
                db=db,
                user_id=to_user_id_log,
                amount=float(amount_decimal),
                transaction_type=tx_type["received"],
                description=f"Redistribution admin reçue - {request.reason}: {request.description or ''}" +
                           (f" (de user {from_user_id_log})" if from_user else " (de la plateforme)")
            )
            credit_tx_id = credit_tx.get("transaction_id", "pending")
          
            # 6. LOG ADMIN
            log_details = {
                "admin_id": current_user.id,
                "from_user_id": from_user_id_log,
                "to_user_id": to_user_id_log,
                "amount": str(amount_decimal),
                "reason": request.reason,
                "description": request.description,
                "transaction_type_sent": tx_type["sent"],
                "transaction_type_received": tx_type["received"],
                "debit_tx_id": debit_tx_id,
                "credit_tx_id": credit_tx_id,
                "timestamp": datetime.utcnow().isoformat()
            }
           
            if not from_user:
                log_details.update({
                    "source": "platform_treasury",
                    "treasury_old_balance": str(old_treasury_balance),
                    "treasury_new_balance": str(new_treasury_balance)
                })
            else:
                log_details.update({
                    "source": f"user_{from_user_id_log}",
                    "from_wallet_old_balance": str(old_from_balance),
                    "from_wallet_new_balance": str(new_from_balance)
                })
           
            log_details.update({
                "to_wallet_old_balance": str(old_to_balance),
                "to_wallet_new_balance": str(new_to_balance)
            })
           
            admin_log = AdminLog(
                admin_id=current_user.id,
                action="redistribute_funds",
                details=log_details,
                fees_amount=Decimal('0.00')
            )
            db.add(admin_log)
         
            # PAS DE db.commit() manuel
            # FastAPI commit automatiquement à la fin de la request si pas d'exception
         
            logger.info(f"✅ Redistribution réussie: {amount_decimal} FCFA → {to_user_phone_log} ({request.reason})")
            logger.info(f" Transactions: débit ID={debit_tx_id}, crédit ID={credit_tx_id}")
         
            # Broadcast WebSocket
            try:
                from app.websockets import broadcast_balance_update
                await broadcast_balance_update(to_user_id_log, float(new_to_balance))
                if from_user:
                    await broadcast_balance_update(from_user_id_log, float(new_from_balance))
            except Exception as ws_error:
                logger.warning(f"⚠️ Erreur WebSocket broadcast: {ws_error}")
         
            # RÉPONSE
            response = {
                "success": True,
                "message": f"Redistribution de {str(amount_decimal)} FCFA vers {to_user_phone_log} réussie",
                "amount": str(amount_decimal),
                "reason": request.reason,
                "transaction_types": tx_type,
                "recipient": {
                    "id": to_user_id_log,
                    "phone": to_user_phone_log,
                    "full_name": to_user_name_log,
                    "new_balance": str(new_to_balance)
                },
                "source": "platform_treasury" if not from_user else f"user_{from_user_id_log}",
                "timestamp": datetime.utcnow().isoformat(),
                "security": {
                    "transaction_atomic": True,
                    "locks_acquired": ["User(s)", "Wallet(s)", "PlatformTreasury"],
                    "deadlock_protection": True,
                    "retry_count": retry_count
                }
            }
           
            if from_user:
                response["sender"] = {
                    "id": from_user_id_log,
                    "phone": from_user_phone_log,
                    "full_name": from_user_name_log,
                    "new_balance": str(new_from_balance)
                }
           
            return response
         
        except HTTPException:
            # rollback automatique par FastAPI
            raise
        except OperationalError as e:
            # rollback automatique
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                await asyncio.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle redistribute_funds: {e}")
                raise HTTPException(status_code=500, detail="Erreur opérationnelle persistante")
        except Exception as e:
            # rollback automatique
            logger.error(f"❌ Erreur redistribution inattendue: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="Erreur interne du serveur")
 
    raise HTTPException(status_code=500, detail="Échec après plusieurs tentatives de redistribution")

# ============ ROUTES ADMIN EXISTANTES ============

@router.post("/nfts", response_model=NFTResponse)
def create_nft(
    nft_data: NFTCreate,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Créer un nouveau NFT (admin seulement)
    """
    logger.info(f"🚀 [ADMIN] DÉBUT CRÉATION NFT - Admin:{current_user.id}")
    
    # === TRANSACTION ATOMIQUE ===
    retry_count = 0
    last_exception = None
    
    while retry_count < MAX_RETRIES:
        try:
            with db.begin_nested():
                # Validation des données
                if not nft_data.artist or not nft_data.artist.strip():
                    raise HTTPException(status_code=422, detail="Le champ 'artist' est requis")
                
                if not nft_data.category or not nft_data.category.strip():
                    raise HTTPException(status_code=422, detail="Le champ 'category' est requis")
                
                if not nft_data.animation_url:
                    raise HTTPException(status_code=422, detail="L'URL d'animation est requise")
                
                if not nft_data.preview_image:
                    raise HTTPException(status_code=422, detail="L'image de preview est requise")
                
                metadata = nft_data.to_nft_metadata(current_user.id)
                
                nft_dict = nft_data.dict()
                nft_dict.pop('attributes', None)
                
                nft_dict.update({
                    "token_id": str(uuid.uuid4()),
                    "creator_id": current_user.id,
                    "owner_id": current_user.id if nft_data.purchase_price == 0 else None,
                    "nft_metadata": metadata,
                    "is_minted": True,
                    "current_edition": 1,
                    "available_editions": nft_data.max_editions if nft_data.max_editions else None
                })
                
                nft = BomAsset(**nft_dict)
                db.add(nft)
            
            db.commit()
            db.refresh(nft)
            
            if hasattr(nft, 'nft_metadata'):
                nft.metadata = nft.nft_metadata if nft.nft_metadata else {}
            else:
                nft.metadata = {}
            
            logger.info(f"✅ [ADMIN] NFT créé avec succès - ID:{nft.id}, Token:{nft.token_id}")
            return nft
            
        except OperationalError as e:
            db.rollback()
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                last_exception = e
                logger.warning(f"🔄 Deadlock détecté dans create_nft, retry {retry_count}/{MAX_RETRIES}")
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle create_nft: {e}")
                raise
        except HTTPException:
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            logger.error(f"❌ [ADMIN] Erreur création NFT: {str(e)}")
            raise HTTPException(
                status_code=500, 
                detail=f"Erreur création NFT: {str(e)}"
            )
    
    if last_exception:
        logger.error(f"❌ Échec après {MAX_RETRIES} retries pour create_nft")
        raise HTTPException(status_code=500, detail=f"Échec création NFT après {MAX_RETRIES} tentatives")

@router.get("/users", response_model=List[UserAdminResponse])
def get_all_users(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer tous les utilisateurs (admin seulement)"""
    users = db.query(User).all()
    logger.info(f"📊 Récupération {len(users)} utilisateurs par admin {current_user.id}")
    return users

@router.patch("/users/{user_id}", response_model=UserAdminResponse)
def toggle_user_status(
    user_id: int,
    is_active: bool = Body(..., embed=True),
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Désactiver/activer un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    user.is_active = is_active
    db.commit()
    db.refresh(user)
    
    action = "activé" if is_active else "désactivé"
    logger.info(f"✅ [ADMIN] Utilisateur {user.phone} ({user_id}) {action} par admin {current_user.id}")
    return user

@router.patch("/users/{user_id}/admin", response_model=UserAdminResponse)
def toggle_user_admin(
    user_id: int,
    is_admin: bool = Body(..., embed=True),
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Promouvoir/rétrograder un utilisateur en admin"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    user.is_admin = is_admin
    db.commit()
    db.refresh(user)
    
    action = "promu admin" if is_admin else "rétrogradé utilisateur"
    logger.info(f"⬆️ [ADMIN] Utilisateur {user.phone} ({user_id}) {action} par admin {current_user.id}")
    return user

@router.delete("/users/{user_id}/ban", response_model=dict)
def ban_user(
    user_id: int,
    reason: Optional[str] = Body(None, embed=True),
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Bannir un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    user.is_active = False
    user.banned_at = datetime.utcnow()
    user.banned_by = current_user.id
    user.status_reason = reason or "Banni par un administrateur"
    
    db.commit()
    
    logger.warning(f"🚫 [ADMIN] Utilisateur {user.phone} ({user_id}) banni par admin {current_user.id} - Raison: {reason}")
    return {"success": True, "message": f"Utilisateur {user.phone} a été banni"}

@router.delete("/users/{user_id}", response_model=dict)
def delete_user(
    user_id: int,
    reason: Optional[str] = Body(None, embed=True),
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Supprimer complètement un utilisateur"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    # Empêcher auto-suppression
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous supprimer vous-même")
    
    phone = user.phone
    db.delete(user)
    db.commit()
    
    logger.critical(f"💀 [ADMIN] Utilisateur {phone} ({user_id}) supprimé définitivement par admin {current_user.id} - Raison: {reason}")
    return {"success": True, "message": f"Utilisateur {phone} a été supprimé définitivement"}

@router.get("/transactions", response_model=List[TransactionResponse])
def get_all_transactions(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer toutes les transactions (admin seulement)"""
    transactions = db.query(Transaction).order_by(Transaction.created_at.desc()).limit(100).all()
    logger.info(f"📊 Récupération {len(transactions)} transactions par admin {current_user.id}")
    return transactions

@router.get("/commissions", response_model=List[dict])
def get_commissions(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer toutes les commissions gagnees = gains BOOM reels (pas les frais!)"""
    # Pas d'imports supplementaires needed
    # Recuperer tous les utilisateurs
    users = db.query(User).all()
    
    result = []
    total_platform_gains = Decimal('0.00')
    
    for user in users:
        # Calculer les vrais gains BOOM pour chaque utilisateur
        user_gains = calculate_user_boom_gains(user.id, db)
        
        if user_gains > 0:
            total_platform_gains += user_gains
            result.append({
                'user_id': user.id,
                'user_name': user.full_name or 'Inconnu',
                'phone': user.phone or 'N/A',
                'amount': str(user_gains),
                'commission_type': 'BOOM Retrait Gains',
                'description': f'Gains de BOOM pour {user.full_name}',
                'created_at': datetime.now().isoformat(),
            })
    
    logger.info(f"Total gains BOOM: {total_platform_gains} FCFA")
    return result

@router.get("/treasury/boom-surplus", response_model=dict)
async def get_boom_surplus(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Calculer le surplus BOOMs = différence entre prix d'achat et prix de vente
    Surplus = Prix_achat - Prix_vente (pour chaque BOOM vendu)
    Exemple: Achat à 5000, Vente à 4000 → Surplus = 1000 FCFA
    """
    # Récupérer tous les BOOMs vendus (boom_sell, boom_sell_real)
    sold_boom_transactions = db.query(Transaction).filter(
        Transaction.transaction_type.in_(["boom_sell", "boom_sell_real"])
    ).all()
    
    total_surplus = Decimal('0.00')
    boom_details = []
    
    for sell_tx in sold_boom_transactions:
        # Chercher le boom_purchase correspondant
        purchase_tx = None
        
        # Chercher par user et timestamp (boom_id n'existe que dans PaymentTransaction)
        purchase_tx = db.query(Transaction).filter(
            Transaction.transaction_type == "boom_purchase",
            Transaction.user_id == sell_tx.user_id,
            Transaction.created_at < sell_tx.created_at
        ).order_by(Transaction.created_at.desc()).first()
        
        if purchase_tx:
            # Surplus = Prix_achat - Prix_vente (montant = ce que user a reçu)
            price_achat = abs(Decimal(str(purchase_tx.amount or '0.00')))
            price_vente = abs(Decimal(str(sell_tx.amount or '0.00')))
            surplus = price_achat - price_vente
            
            if surplus > 0:  # Seulement les vrais gains pour plateforme
                total_surplus += surplus
                boom_details.append({
                    "transaction_id": sell_tx.id,
                    "user_id": sell_tx.user_id,
                    "price_achat": str(price_achat),
                    "price_vente": str(price_vente),
                    "surplus": str(surplus),
                    "date_vente": sell_tx.created_at.isoformat() if sell_tx.created_at else None
                })
    
    logger.info(f"💎 Surplus BOOMs: {total_surplus} FCFA par admin {current_user.id}")
    
    return {
        "surplus": str(total_surplus),
        "currency": "FCFA",
        "boom_count": len(boom_details),
        "details": boom_details,
        "calculation": f"Total surplus de {len(boom_details)} BOOM(s) revendu(s)"
    }

@router.get("/treasury/user-gains", response_model=dict)
async def get_user_gains(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Calculer les gains utilisateurs = différence entre retrait et prix d'achat
    Gain utilisateur = Prix_retrait - Prix_achat (coût pour la plateforme)
    Exemple: Achat à 5000, Retrait à 5500 → Gain utilisateur = 500 FCFA
    C'est ce montant que la plateforme paie à l'utilisateur
    """
    from app.models.payment_models import PaymentTransaction
    
    # Récupérer tous les retraits de BOOM 
    withdrawal_transactions = db.query(PaymentTransaction).filter(
        PaymentTransaction.type.in_(["bom_withdrawal", "boom_withdrawal"])
    ).all()
    
    total_user_gains = Decimal('0.00')
    gains_details = []
    
    for withdrawal_tx in withdrawal_transactions:
        # Chercher le boom_purchase correspondant du même utilisateur
        purchase_tx = None
        
        # Essayer avec user_bom_id d'abord
        if hasattr(withdrawal_tx, 'user_bom_id') and withdrawal_tx.user_bom_id:
            from app.models.user_models import UserBom
            user_bom = db.query(UserBom).filter(UserBom.id == withdrawal_tx.user_bom_id).first()
            if user_bom and user_bom.boom_id:
                purchase_tx = db.query(Transaction).filter(
                    Transaction.transaction_type == "boom_purchase",
                    Transaction.boom_id == user_bom.boom_id,
                    Transaction.user_id == withdrawal_tx.user_id,
                    Transaction.created_at < withdrawal_tx.created_at
                ).order_by(Transaction.created_at.desc()).first()
        
        # Si pas trouvé, chercher le boom_purchase le plus récent avant ce retrait
        if not purchase_tx:
            purchase_tx = db.query(Transaction).filter(
                Transaction.transaction_type == "boom_purchase",
                Transaction.user_id == withdrawal_tx.user_id,
                Transaction.created_at < withdrawal_tx.created_at
            ).order_by(Transaction.created_at.desc()).first()
        
        if purchase_tx:
            # Gain utilisateur = Prix_retrait - Prix_achat
            withdrawal_amount = abs(Decimal(str(withdrawal_tx.amount or '0.00')))
            purchase_price = abs(Decimal(str(purchase_tx.amount or '0.00')))
            user_gain = withdrawal_amount - purchase_price
            
            if user_gain > 0:  # Seulement les gains positifs (coût pour plateforme)
                total_user_gains += user_gain
                gains_details.append({
                    "transaction_id": withdrawal_tx.id,
                    "user_id": withdrawal_tx.user_id,
                    "price_achat": str(purchase_price),
                    "price_retrait": str(withdrawal_amount),
                    "user_gain": str(user_gain),
                    "date_retrait": withdrawal_tx.created_at.isoformat() if withdrawal_tx.created_at else None
                })
    
    logger.info(f"👥 Gains utilisateurs: {total_user_gains} FCFA par admin {current_user.id}")
    
    return {
        "user_gains": str(total_user_gains),
        "currency": "FCFA",
        "boom_count": len(gains_details),
        "details": gains_details,
        "calculation": f"Total gains de {len(gains_details)} utilisateur(s) ayant retiré des BOOMs en profit"
    }
    
    return {
        "user_gains": str(total_user_gains),
        "currency": "FCFA",
        "boom_count": len(gains_details),
        "details": gains_details,
        "calculation": f"Total gains de {len(gains_details)} utilisateur(s) ayant retiré des BOOMs en profit"
    }

@router.get("/treasury/balance", response_model=TreasuryBalanceResponse)
async def get_treasury_balance(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer le solde de la caisse plateforme"""
    treasury = get_platform_treasury(db)
    
    logger.info(f"💰 Solde trésorerie récupéré par admin {current_user.id}: {treasury.balance} FCFA")
    
    return {
        "balance": str(treasury.balance),
        "currency": treasury.currency
    }

@router.get("/treasury/withdrawn", response_model=dict)
async def get_treasury_withdrawn(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer l'argent réellement déposé et retiré par l'admin"""
    # Argent DÉPOSÉ directement par l'admin dans la trésorerie
    deposited_transactions = db.query(Transaction).filter(
        Transaction.transaction_type == "treasury_deposit"
    ).all()
    
    total_deposited = Decimal('0.00')
    for tx in deposited_transactions:
        total_deposited += abs(tx.amount or Decimal('0.00'))
    
    # Argent RETIRÉ directement par l'admin de la trésorerie
    withdrawn_transactions = db.query(Transaction).filter(
        Transaction.transaction_type == "treasury_withdrawal"
    ).all()
    
    total_withdrawn = Decimal('0.00')
    for tx in withdrawn_transactions:
        total_withdrawn += abs(tx.amount or Decimal('0.00'))
    
    # Obtenir le solde actuel
    treasury = get_platform_treasury(db)
    current_balance = treasury.balance or Decimal('0.00')
    
    logger.info(f"💰 Dépôts admin: {total_deposited}, Retraits admin: {total_withdrawn} par admin {current_user.id}")
    
    return {
        "deposited": str(total_deposited),
        "withdrawn": str(total_withdrawn),
        "currency": "FCFA",
        "current_balance": str(current_balance),
        "calculation": f"Déposé: {total_deposited}, Retiré: {total_withdrawn}, Solde: {current_balance}"
    }

@router.get("/treasury/stats", response_model=TreasuryStatsResponse) 
async def get_treasury_stats(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Statistiques détaillées de la caisse plateforme"""
    treasury = get_platform_treasury(db)
    
    transactions = db.query(Transaction).filter(
        Transaction.transaction_type.in_([
            "boom_purchase", "boom_sell", "deposit_fee", "withdrawal_fee",
            "treasury_deposit", "treasury_withdrawal"
        ])
    ).all()
    
    fees_by_type = {}
    for tx in transactions:
        tx_type = tx.transaction_type
        if tx_type not in fees_by_type:
            fees_by_type[tx_type] = Decimal('0.00')
        
        if tx_type in ["treasury_deposit", "treasury_withdrawal"]:
            fees_by_type[tx_type] += abs(tx.amount)
        else:
            if tx.amount > 0:
                fees_by_type[tx_type] += tx.amount
    
    fees_by_type_str = {k: str(v) for k, v in fees_by_type.items()}
    
    logger.info(f"📊 Statistiques trésorerie récupérées par admin {current_user.id}")
    
    return {
        "current_balance": str(treasury.balance),
        "currency": treasury.currency,
        "created_at": treasury.created_at.isoformat() if treasury.created_at else None,
        "updated_at": treasury.updated_at.isoformat() if treasury.updated_at else None,
        "fees_by_category": fees_by_type_str,
        "total_fees_collected": str(sum(fees_by_type.values())),
        "transaction_count": len(transactions)
    }

# ============ ROUTES EXISTANTES (sécurisées) ============

@router.post("/collections", response_model=CollectionResponse)
def create_collection(
    collection_data: CollectionCreate,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Créer une nouvelle collection NFT"""
    
    # === TRANSACTION ATOMIQUE ===
    retry_count = 0
    last_exception = None
    
    while retry_count < MAX_RETRIES:
        try:
            with db.begin_nested():
                existing = db.query(NFTCollection).filter(
                    NFTCollection.name == collection_data.name
                ).first()
                
                if existing:
                    raise HTTPException(status_code=400, detail="Une collection avec ce nom existe déjà")
                
                collection = NFTCollection(
                    name=collection_data.name,
                    description=collection_data.description,
                    creator_id=current_user.id,
                    banner_image=collection_data.banner_image,
                    thumbnail_image=collection_data.thumbnail_image,
                    collection_metadata={
                        "category": collection_data.category,
                        "social_links": {},
                        "royalty_percentage": 5.0
                    }
                )
                
                db.add(collection)
            
            db.commit()
            db.refresh(collection)
            
            logger.info(f"✅ Collection créée: {collection.name} (ID:{collection.id}) par admin {current_user.id}")
            return collection
            
        except OperationalError as e:
            db.rollback()
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                last_exception = e
                logger.warning(f"🔄 Deadlock détecté dans create_collection, retry {retry_count}/{MAX_RETRIES}")
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle create_collection: {e}")
                raise
        except HTTPException:
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Erreur création collection: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Erreur création collection: {str(e)}")
    
    if last_exception:
        logger.error(f"❌ Échec après {MAX_RETRIES} retries pour create_collection")
        raise HTTPException(status_code=500, detail=f"Échec création collection après {MAX_RETRIES} tentatives")

@router.put("/nfts/{nft_id}", response_model=NFTResponse)
def update_nft(
    nft_id: str,
    nft_data: NFTCreate,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Mettre à jour un NFT existant"""
    
    # === TRANSACTION ATOMIQUE ===
    retry_count = 0
    last_exception = None
    
    while retry_count < MAX_RETRIES:
        try:
            with db.begin_nested():
                # Rechercher le NFT avec lock
                nft_stmt = select(BomAsset).where(
                    BomAsset.token_id == nft_id
                ).with_for_update()
                
                nft = db.execute(nft_stmt).scalar_one_or_none()
                
                if not nft:
                    # Essayer par ID
                    try:
                        nft_id_int = int(nft_id)
                        nft_stmt = select(BomAsset).where(
                            BomAsset.id == nft_id_int
                        ).with_for_update()
                        nft = db.execute(nft_stmt).scalar_one_or_none()
                    except ValueError:
                        nft = None
                
                if not nft:
                    raise HTTPException(status_code=404, detail="NFT non trouvé")
                
                logger.info(f"📥 [ADMIN] Mise à jour NFT {nft_id} (ID: {nft.id}) par admin {current_user.id}")
                
                # Mettre à jour les champs
                for field, value in nft_data.dict().items():
                    if value is not None:
                        setattr(nft, field, value)
                
                metadata = nft_data.to_nft_metadata(nft.creator_id)
                nft.nft_metadata = metadata
            
            db.commit()
            db.refresh(nft)
            
            logger.info(f"✅ NFT mis à jour: {nft.title} (ID:{nft.id})")
            return nft
            
        except OperationalError as e:
            db.rollback()
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                last_exception = e
                logger.warning(f"🔄 Deadlock détecté dans update_nft, retry {retry_count}/{MAX_RETRIES}")
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle update_nft: {e}")
                raise
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Erreur update_nft: {e}")
            raise
    
    if last_exception:
        logger.error(f"❌ Échec après {MAX_RETRIES} retries pour update_nft")
        raise HTTPException(status_code=500, detail=f"Échec mise à jour NFT après {MAX_RETRIES} tentatives")

@router.delete("/nfts/{nft_id}")
def delete_nft(
    nft_id: str,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Supprimer un NFT (désactivation)"""
    
    logger.info(f"🗑️ [ADMIN] Tentative suppression NFT: {nft_id} par admin {current_user.id}")
    
    # === TRANSACTION ATOMIQUE ===
    retry_count = 0
    last_exception = None
    
    while retry_count < MAX_RETRIES:
        try:
            with db.begin_nested():
                # Rechercher le NFT avec lock
                nft_stmt = select(BomAsset).where(
                    BomAsset.token_id == nft_id
                ).with_for_update()
                
                nft = db.execute(nft_stmt).scalar_one_or_none()
                
                if not nft:
                    # Essayer par ID
                    try:
                        nft_id_int = int(nft_id)
                        nft_stmt = select(BomAsset).where(
                            BomAsset.id == nft_id_int
                        ).with_for_update()
                        nft = db.execute(nft_stmt).scalar_one_or_none()
                    except ValueError:
                        nft = None
                
                if not nft:
                    raise HTTPException(status_code=404, detail="NFT non trouvé")
                
                logger.info(f"✅ NFT trouvé et locké: ID={nft.id}, Token={nft.token_id}, Titre={nft.title}")
                
                # Désactiver le NFT
                nft.is_active = False
            
            db.commit()
            
            logger.info(f"✅ NFT désactivé: {nft.title} (ID:{nft.id})")
            
            return {
                "message": "NFT désactivé avec succès", 
                "token_id": nft.token_id,
                "id": nft.id,
                "title": nft.title
            }
            
        except OperationalError as e:
            db.rollback()
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                last_exception = e
                logger.warning(f"🔄 Deadlock détecté dans delete_nft, retry {retry_count}/{MAX_RETRIES}")
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle delete_nft: {e}")
                raise
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Erreur delete_nft: {e}")
            raise
    
    if last_exception:
        logger.error(f"❌ Échec après {MAX_RETRIES} retries pour delete_nft")
        raise HTTPException(status_code=500, detail=f"Échec suppression NFT après {MAX_RETRIES} tentatives")

@router.put("/collections/{collection_id}/verify")
def verify_collection(
    collection_id: int,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Vérifier une collection"""
    
    # === TRANSACTION ATOMIQUE ===
    retry_count = 0
    last_exception = None
    
    while retry_count < MAX_RETRIES:
        try:
            with db.begin_nested():
                # Lock de la collection
                collection_stmt = select(NFTCollection).where(
                    NFTCollection.id == collection_id
                ).with_for_update()
                
                collection = db.execute(collection_stmt).scalar_one_or_none()
                
                if not collection:
                    raise HTTPException(status_code=404, detail="Collection non trouvée")
                
                # Vérifier la collection
                collection.is_verified = True
            
            db.commit()
            
            logger.info(f"✅ Collection vérifiée: {collection.name} (ID:{collection_id}) par admin {current_user.id}")
            
            return {"message": "Collection vérifiée avec succès", "collection_id": collection_id}
            
        except OperationalError as e:
            db.rollback()
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                last_exception = e
                logger.warning(f"🔄 Deadlock détecté dans verify_collection, retry {retry_count}/{MAX_RETRIES}")
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle verify_collection: {e}")
                raise
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Erreur verify_collection: {e}")
            raise
    
    if last_exception:
        logger.error(f"❌ Échec après {MAX_RETRIES} retries pour verify_collection")
        raise HTTPException(status_code=500, detail=f"Échec vérification collection après {MAX_RETRIES} tentatives")

@router.get("/nfts", response_model=List[NFTResponse])
def get_all_nfts(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db),
    limit: int = 100,
    show_inactive: bool = Query(False, description="Afficher aussi les NFTs inactifs")
):
    """Récupérer tous les NFTs"""
    query = db.query(BomAsset)
    
    if not show_inactive:
        query = query.filter(BomAsset.is_active == True)
    
    nfts = query.order_by(BomAsset.created_at.desc()).limit(limit).all()
    
    cleaned_nfts = []
    for nft in nfts:
        if nft.artist is None:
            nft.artist = "Unknown Artist"
        if nft.category is None:
            nft.category = "Uncategorized"
        if nft.animation_url is None and nft.preview_image:
            nft.animation_url = nft.preview_image
        elif nft.animation_url is None:
            nft.animation_url = ""
        if nft.preview_image is None:
            nft.preview_image = ""
        
        cleaned_nfts.append(nft)
    
    logger.info(f"📊 [ADMIN] NFTs retournés: {len(cleaned_nfts)} (inactifs: {'oui' if show_inactive else 'non'})")
    return cleaned_nfts

@router.get("/stats", response_model=AdminStats)
def get_admin_stats(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer les statistiques de la plateforme NFT"""
    total_users = db.query(User).count()
    total_nfts = db.query(BomAsset).count()
    active_nfts = db.query(BomAsset).filter(BomAsset.is_active == True).count()
    
    total_nft_value = db.query(BomAsset).filter(BomAsset.is_active == True).all()
    total_platform_value = sum([float(nft.value) for nft in total_nft_value])
    
    total_collections = db.query(NFTCollection).count()
    verified_collections = db.query(NFTCollection).filter(NFTCollection.is_verified == True).count()
    
    categories = db.query(BomAsset.category).filter(BomAsset.is_active == True).distinct().all()
    
    # 📊 Calculer le nombre total de transactions (combiner Transaction + PaymentTransaction)
    transaction_count = db.query(Transaction).count()
    payment_transaction_count = db.query(PaymentTransaction).count()
    total_transactions = transaction_count + payment_transaction_count
    
    # 📊 Calculer les utilisateurs actifs dans les 24 dernières heures
    # Vérifier les utilisateurs ayant une transaction (Transaction ou PaymentTransaction) dans les 24h
    twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=24)
    
    active_users_from_transactions = db.query(Transaction.user_id).filter(
        Transaction.created_at >= twenty_four_hours_ago
    ).distinct().count()
    
    active_users_from_payments = db.query(PaymentTransaction.user_id).filter(
        PaymentTransaction.created_at >= twenty_four_hours_ago
    ).distinct().count()
    
    # Compter les utilisateurs uniques (éviter double-comptage)
    active_user_ids = set()
    if active_users_from_transactions > 0:
        tx_users = db.query(Transaction.user_id).filter(
            Transaction.created_at >= twenty_four_hours_ago
        ).distinct().all()
        active_user_ids.update([u[0] for u in tx_users if u[0]])
    
    if active_users_from_payments > 0:
        pt_users = db.query(PaymentTransaction.user_id).filter(
            PaymentTransaction.created_at >= twenty_four_hours_ago
        ).distinct().all()
        active_user_ids.update([u[0] for u in pt_users if u[0]])
    
    daily_active_users = len(active_user_ids)
    
    logger.info(f"📊 Statistiques plateforme récupérées par admin {current_user.id}: {total_transactions} transactions, {daily_active_users} utilisateurs actifs (24h)")
    
    return AdminStats(
        total_users=total_users,
        total_boms=total_nfts,
        active_boms=active_nfts,
        total_platform_value=total_platform_value,
        total_transactions=total_transactions,
        daily_active_users=daily_active_users,
        total_collections=total_collections,
        verified_collections=verified_collections,
        categories=[cat[0] for cat in categories if cat[0]]
    )

@router.get("/payments", response_model=List[PaymentTransactionResponse])
def get_all_payments(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer tous les paiements"""
    from app.models.payment_models import PaymentTransaction
    
    payments = db.query(PaymentTransaction).order_by(PaymentTransaction.created_at.desc()).limit(100).all()
    
    logger.info(f"💰 Récupération {len(payments)} paiements par admin {current_user.id}")
    return payments

@router.get("/user-nfts/{user_id}", response_model=List[NFTResponse])
def get_user_nfts_admin(
    user_id: int,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Récupérer les NFTs d'un utilisateur"""
    nfts = db.query(BomAsset).filter(
        BomAsset.owner_id == user_id,
        BomAsset.is_active == True
    ).order_by(BomAsset.created_at.desc()).all()
    
    logger.info(f"📊 Récupération {len(nfts)} NFTs pour user {user_id} par admin {current_user.id}")
    return nfts

@router.put("/transfer-ownership/{token_id}")
def transfer_nft_ownership(
    token_id: str,
    new_owner_id: int,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Transférer la propriété d'un NFT"""
    
    # === TRANSACTION ATOMIQUE ===
    retry_count = 0
    last_exception = None
    
    while retry_count < MAX_RETRIES:
        try:
            with db.begin_nested():
                # Lock du NFT
                nft_stmt = select(BomAsset).where(
                    BomAsset.token_id == token_id
                ).with_for_update()
                
                nft = db.execute(nft_stmt).scalar_one_or_none()
                
                if not nft:
                    raise HTTPException(status_code=404, detail="NFT non trouvé")
                
                # Lock du nouveau propriétaire
                new_owner_stmt = select(User).where(User.id == new_owner_id).with_for_update()
                new_owner = db.execute(new_owner_stmt).scalar_one_or_none()
                
                if not new_owner:
                    raise HTTPException(status_code=404, detail="Nouveau propriétaire non trouvé")
                
                old_owner_id = nft.owner_id
                nft.owner_id = new_owner_id
                
                user_nft = UserBom(
                    user_id=new_owner_id,
                    bom_id=nft.id,
                    sender_id=old_owner_id,
                    receiver_id=new_owner_id,
                    transfer_id=str(uuid.uuid4()),
                    transfer_message="Transfert administratif"
                )
                
                db.add(user_nft)
            
            db.commit()
            
            logger.info(f"✅ Propriété transférée: NFT {token_id} de {old_owner_id} à {new_owner_id} par admin {current_user.id}")
            
            return {
                "message": "Propriété transférée avec succès",
                "token_id": token_id,
                "old_owner": old_owner_id,
                "new_owner": new_owner_id
            }
            
        except OperationalError as e:
            db.rollback()
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                last_exception = e
                logger.warning(f"🔄 Deadlock détecté dans transfer_nft_ownership, retry {retry_count}/{MAX_RETRIES}")
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle transfer_nft_ownership: {e}")
                raise
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Erreur transfer_nft_ownership: {e}")
            raise
    
    if last_exception:
        logger.error(f"❌ Échec après {MAX_RETRIES} retries pour transfer_nft_ownership")
        raise HTTPException(status_code=500, detail=f"Échec transfert propriété après {MAX_RETRIES} tentatives")

@router.post("/treasury/deposit")
async def deposit_to_treasury(
    deposit_data: TreasuryDepositRequest,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Déposer des fonds dans la caisse plateforme"""
    
    logger.info(f"💰 DEPOSIT TREASURY START - Admin:{current_user.id}, Amount:{deposit_data.amount}, Method:{deposit_data.method}")
    
    # Validation du montant
    if deposit_data.amount <= 0:
        logger.error(f"❌ Montant invalide: {deposit_data.amount}")
        raise HTTPException(status_code=400, detail="Le montant doit être positif")
    
    # === TRANSACTION ATOMIQUE AVEC RETRY ===
    retry_count = 0
    last_exception = None
    
    while retry_count < MAX_RETRIES:
        try:
            with db.begin_nested():  # Début transaction atomique
                # 🔒 1. Lock de la trésorerie
                treasury_stmt = select(PlatformTreasury).with_for_update()
                treasury = db.execute(treasury_stmt).scalar_one_or_none()
                
                # Créer la trésorerie si inexistante
                if not treasury:
                    logger.warning("⚠️ Trésorerie non trouvée, création...")
                    treasury = PlatformTreasury(balance=Decimal('0.00'), currency="FCFA")
                    db.add(treasury)
                
                # Convertir en Decimal pour précision
                amount_decimal = Decimal(str(deposit_data.amount))
                
                # Sauvegarder l'ancien solde
                old_balance = treasury.balance
                
                # 2. CRÉDITER la caisse
                treasury.balance += amount_decimal
                new_balance = treasury.balance
                
                logger.info(f"💰 Caisse créditée: {old_balance} → {new_balance} FCFA (+{amount_decimal})")
                
                # 3. CRÉER LA TRANSACTION (montant POSITIF pour un dépôt)
                # CORRECTION : Pas de signe négatif, le type indique la direction
                transaction_result = create_transaction(
                    db=db,
                    user_id=current_user.id,  # Admin qui effectue l'opération
                    amount=float(amount_decimal),  # ← CORRIGÉ : positif pour un dépôt
                    transaction_type="treasury_deposit",  # Type indique déjà que c'est un dépôt
                    description=f"Dépôt admin dans la caisse via {deposit_data.method}" + 
                               (f" - Réf: {deposit_data.reference}" if deposit_data.reference else ""),
                    status="completed"
                )
                
                logger.info(f"💳 Transaction créée: ID {transaction_result.get('transaction').id if transaction_result.get('transaction') else 'N/A'}")
                
                # 4. LOG ADMIN DÉTAILLÉ
                admin_log = AdminLog(
                    admin_id=current_user.id,
                    action="treasury_deposit",
                    details={
                        "operation": "deposit",
                        "admin_id": current_user.id,
                        "admin_name": current_user.full_name or current_user.phone,
                        "amount": str(amount_decimal),
                        "method": deposit_data.method,
                        "reference": deposit_data.reference,
                        "old_balance": str(old_balance),
                        "new_balance": str(new_balance),
                        "balance_change": f"+{amount_decimal}",
                        "transaction_id": transaction_result.get('transaction').id if transaction_result.get('transaction') else None,
                        "description": f"Dépôt caisse via {deposit_data.method}",
                        "timestamp": datetime.utcnow().isoformat()
                    },
                    fees_amount=Decimal('0.00')
                )
                db.add(admin_log)
                
                logger.info(f"📝 Log admin créé: dépôt de {amount_decimal} FCFA")
            
            # === COMMIT GLOBAL ===
            db.commit()
            
            logger.info(f"✅ DÉPÔT RÉUSSI - {amount_decimal} FCFA ajoutés à la caisse")
            logger.info(f"   Ancien solde: {old_balance} FCFA")
            logger.info(f"   Nouveau solde: {new_balance} FCFA")
            logger.info(f"   Admin: {current_user.id} ({current_user.phone})")
            logger.info(f"   Méthode: {deposit_data.method}")
            
            # 5. BROADCAST WEBSOCKET (asynchrone)
            try:
                from app.websockets import broadcast_treasury_update
                await broadcast_treasury_update({
                    "balance": float(new_balance),
                    "change": float(amount_decimal),
                    "operation": "deposit",
                    "admin_id": current_user.id,
                    "timestamp": datetime.utcnow().isoformat()
                })
                logger.info("🔌 Broadcast WebSocket envoyé")
            except Exception as ws_error:
                logger.warning(f"⚠️ Erreur WebSocket: {ws_error}")
            
            # 6. PRÉPARER RÉPONSE
            return {
                "success": True,
                "message": f"{amount_decimal} FCFA déposés dans la caisse avec succès",
                "operation": "deposit",
                "amount": float(amount_decimal),
                "old_balance": float(old_balance),
                "new_balance": float(new_balance),
                "balance_change": f"+{amount_decimal}",
                "currency": "FCFA",
                "method": deposit_data.method,
                "reference": deposit_data.reference,
                "admin": {
                    "id": current_user.id,
                    "phone": current_user.phone,
                    "name": current_user.full_name or current_user.phone
                },
                "transaction_id": transaction_result.get('transaction').id if transaction_result.get('transaction') else None,
                "timestamp": datetime.utcnow().isoformat(),
                "security": {
                    "transaction_atomic": True,
                    "lock_acquired": True,
                    "deadlock_protection": True,
                    "retry_count": retry_count
                }
            }
            
        except HTTPException:
            db.rollback()
            raise
            
        except OperationalError as e:
            db.rollback()
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                last_exception = e
                logger.warning(f"🔄 Deadlock détecté dans deposit_to_treasury, retry {retry_count}/{MAX_RETRIES}")
                await asyncio.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle deposit_to_treasury: {e}")
                raise HTTPException(status_code=500, detail=f"Erreur opérationnelle: {str(e)}")
                
        except IntegrityError as e:
            db.rollback()
            logger.error(f"❌ Erreur intégrité deposit_to_treasury: {e}")
            raise HTTPException(status_code=500, detail=f"Erreur d'intégrité: {str(e)}")
            
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Erreur deposit_to_treasury: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Erreur dépôt caisse: {str(e)}")
    
    if last_exception:
        logger.error(f"❌ Échec après {MAX_RETRIES} retries pour deposit_to_treasury")
        raise HTTPException(status_code=500, detail=f"Échec dépôt après {MAX_RETRIES} tentatives")
        
        
@router.get("/treasury/transactions", response_model=List[dict])
async def get_treasury_transactions(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db),
    limit: int = 50
):
    """Récupérer TOUS les transactions liées à la trésorerie avec infos utilisateur"""
    from app.models.payment_models import PaymentTransaction
    
    # === 1. Transactions de la table Transaction ===
    transaction_results = db.query(Transaction).filter(
        Transaction.transaction_type.in_([
            # Frais
            "deposit_fee", "withdrawal_fee", "boom_purchase",
            # Dépôts utilisateurs
            "deposit", "treasury_deposit",
            # Retraits utilisateurs
            "withdrawal", "treasury_withdrawal",
            # Ventes et retraits de BOOMs
            "boom_sell", "boom_sell_real", "boom_withdrawal",
            # Autres revenus/charges
            "commission", "penalty", "refund_received", "refund_payout"
        ])
    ).all()
    
    result = []
    for tx in transaction_results:
        user = db.query(User).filter(User.id == tx.user_id).first()
        result.append({
            'id': tx.id,
            'user_id': tx.user_id,
            'user_full_name': user.full_name if user else 'Inconnu',
            'user_phone': user.phone if user else 'N/A',
            'transaction_type': tx.transaction_type,
            'amount': str(tx.amount),
            'description': tx.description,
            'status': tx.status,
            'reference': tx.reference,
            'created_at': tx.created_at.isoformat() if tx.created_at else None,
        })
    
    # === 2. Transactions PaymentTransaction (Retraits BOOM, etc.) ===
    payment_results = db.query(PaymentTransaction).filter(
        PaymentTransaction.type.in_([
            "bom_withdrawal",  # Retraits de BOM
            "boom_withdrawal",  # Retraits de BOOM
        ])
    ).all()
    
    for pt in payment_results:
        user = db.query(User).filter(User.id == pt.user_id).first()
        result.append({
            'id': pt.id,
            'user_id': pt.user_id,
            'user_full_name': user.full_name if user else 'Inconnu',
            'user_phone': user.phone if user else 'N/A',
            'transaction_type': pt.type,  # "bom_withdrawal" ou "boom_withdrawal"
            'amount': str(pt.amount),
            'description': pt.description,
            'status': pt.status.value if hasattr(pt.status, 'value') else str(pt.status),
            'reference': pt.provider_reference,
            'created_at': pt.created_at.isoformat() if pt.created_at else None,
        })
    
    # === 3. Trier par date (plus récents d'abord) et limiter ===
    result.sort(key=lambda x: x['created_at'] or '', reverse=True)
    result = result[:limit]
    
    logger.info(f"📊 Récupération {len(result)} transactions trésorerie par admin {current_user.id}")
    return result

@router.post("/treasury/withdraw")
async def withdraw_from_treasury(
    withdraw_data: TreasuryWithdrawRequest,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Retirer des fonds de la caisse plateforme"""
    
    logger.info(f"💰 WITHDRAW TREASURY START - Admin:{current_user.id}, Amount:{withdraw_data.amount}, Method:{withdraw_data.method}")
    
    # Validation du montant
    if withdraw_data.amount <= 0:
        logger.error(f"❌ Montant invalide: {withdraw_data.amount}")
        raise HTTPException(status_code=400, detail="Le montant doit être positif")
    
    # Validation supplémentaire pour les transferts Wave
    if withdraw_data.method == 'wave' and not withdraw_data.recipient_phone:
        raise HTTPException(status_code=400, detail="Numéro de téléphone requis pour les retraits Wave")
    
    # === TRANSACTION ATOMIQUE AVEC RETRY ===
    retry_count = 0
    last_exception = None
    
    while retry_count < MAX_RETRIES:
        try:
            with db.begin_nested():  # Début transaction atomique
                # 🔒 1. Lock de la trésorerie
                treasury_stmt = select(PlatformTreasury).with_for_update()
                treasury = db.execute(treasury_stmt).scalar_one_or_none()
                
                if not treasury:
                    logger.error("❌ Caisse plateforme non trouvée")
                    raise HTTPException(status_code=404, detail="Caisse plateforme non trouvée")
                
                # Convertir en Decimal pour précision
                amount_decimal = Decimal(str(withdraw_data.amount))
                
                # Sauvegarder l'ancien solde
                old_balance = treasury.balance
                
                # 2. VÉRIFIER LE SOLDE DISPONIBLE (après lock)
                if treasury.balance < amount_decimal:
                    error_msg = f"Solde insuffisant: {treasury.balance} FCFA < {amount_decimal} FCFA"
                    logger.error(f"❌ {error_msg}")
                    raise HTTPException(
                        status_code=400, 
                        detail=f"Solde insuffisant. Disponible: {str(treasury.balance)} FCFA, Demande: {str(amount_decimal)} FCFA"
                    )
                
                # 3. DÉBITER la caisse
                treasury.balance -= amount_decimal
                new_balance = treasury.balance
                
                logger.info(f"💰 Caisse débitée: {old_balance} → {new_balance} FCFA (-{amount_decimal})")
                
                # 4. CRÉER LA TRANSACTION (montant POSITIF pour un retrait)
                # CORRECTION : Pas de signe négatif, le type indique la direction
                transaction_description = f"Retrait admin de la caisse via {withdraw_data.method}"
                
                # Ajouter les détails du destinataire
                if withdraw_data.method == 'wave' and withdraw_data.recipient_phone:
                    transaction_description += f" → {withdraw_data.recipient_phone}"
                elif withdraw_data.method == 'bank_transfer' and withdraw_data.recipient_account:
                    transaction_description += f" → Compte: {withdraw_data.recipient_account}"
                elif withdraw_data.method == 'orange' and withdraw_data.recipient_phone:
                    transaction_description += f" → {withdraw_data.recipient_phone}"
                
                if withdraw_data.reference:
                    transaction_description += f" (Réf: {withdraw_data.reference})"
                
                transaction_result = create_transaction(
                    db=db,
                    user_id=current_user.id,  # Admin qui effectue l'opération
                    amount=float(amount_decimal),  # ← CORRIGÉ : positif, le type indique que c'est un retrait
                    transaction_type="treasury_withdrawal",  # Type indique déjà que c'est un retrait
                    description=transaction_description,
                    status="completed"
                )
                
                logger.info(f"💳 Transaction créée: ID {transaction_result.get('transaction').id if transaction_result.get('transaction') else 'N/A'}")
                
                # 5. LOG ADMIN DÉTAILLÉ
                admin_log_details = {
                    "operation": "withdrawal",
                    "admin_id": current_user.id,
                    "admin_name": current_user.full_name or current_user.phone,
                    "amount": str(amount_decimal),
                    "method": withdraw_data.method,
                    "old_balance": str(old_balance),
                    "new_balance": str(new_balance),
                    "balance_change": f"-{amount_decimal}",
                    "transaction_id": transaction_result.get('transaction').id if transaction_result.get('transaction') else None,
                    "description": f"Retrait caisse via {withdraw_data.method}",
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                # Ajouter les infos destinataire selon la méthode
                if withdraw_data.method in ['wave', 'orange'] and withdraw_data.recipient_phone:
                    admin_log_details["recipient_phone"] = withdraw_data.recipient_phone
                
                if withdraw_data.method == 'bank_transfer' and withdraw_data.recipient_account:
                    admin_log_details["recipient_account"] = withdraw_data.recipient_account
                
                if withdraw_data.reference:
                    admin_log_details["reference"] = withdraw_data.reference
                
                admin_log = AdminLog(
                    admin_id=current_user.id,
                    action="treasury_withdrawal",
                    details=admin_log_details,
                    fees_amount=Decimal('0.00')
                )
                db.add(admin_log)
                
                logger.info(f"📝 Log admin créé: retrait de {amount_decimal} FCFA")
            
            # === COMMIT GLOBAL ===
            db.commit()
            
            logger.info(f"✅ RETRAIT RÉUSSI - {amount_decimal} FCFA retirés de la caisse")
            logger.info(f"   Ancien solde: {old_balance} FCFA")
            logger.info(f"   Nouveau solde: {new_balance} FCFA")
            logger.info(f"   Admin: {current_user.id} ({current_user.phone})")
            logger.info(f"   Méthode: {withdraw_data.method}")
            if withdraw_data.recipient_phone:
                logger.info(f"   Destinataire: {withdraw_data.recipient_phone}")
            
            # 6. BROADCAST WEBSOCKET (asynchrone)
            try:
                from app.websockets import broadcast_treasury_update
                await broadcast_treasury_update({
                    "balance": float(new_balance),
                    "change": -float(amount_decimal),  # Négatif pour un retrait
                    "operation": "withdrawal",
                    "admin_id": current_user.id,
                    "method": withdraw_data.method,
                    "recipient": withdraw_data.recipient_phone or withdraw_data.recipient_account,
                    "timestamp": datetime.utcnow().isoformat()
                })
                logger.info("🔌 Broadcast WebSocket envoyé")
            except Exception as ws_error:
                logger.warning(f"⚠️ Erreur WebSocket: {ws_error}")
            
            # 7. PRÉPARER RÉPONSE
            response_data = {
                "success": True,
                "message": f"{amount_decimal} FCFA retirés de la caisse avec succès",
                "operation": "withdrawal",
                "amount": float(amount_decimal),
                "old_balance": float(old_balance),
                "new_balance": float(new_balance),
                "balance_change": f"-{amount_decimal}",
                "currency": "FCFA",
                "method": withdraw_data.method,
                "admin": {
                    "id": current_user.id,
                    "phone": current_user.phone,
                    "name": current_user.full_name or current_user.phone
                },
                "transaction_id": transaction_result.get('transaction').id if transaction_result.get('transaction') else None,
                "payout_initiated": True,
                "timestamp": datetime.utcnow().isoformat(),
                "security": {
                    "transaction_atomic": True,
                    "lock_acquired": True,
                    "deadlock_protection": True,
                    "retry_count": retry_count
                }
            }
            
            # Ajouter les infos destinataire selon la méthode
            if withdraw_data.method in ['wave', 'orange'] and withdraw_data.recipient_phone:
                response_data["recipient_phone"] = withdraw_data.recipient_phone
            
            if withdraw_data.method == 'bank_transfer' and withdraw_data.recipient_account:
                response_data["recipient_account"] = withdraw_data.recipient_account
            
            if withdraw_data.reference:
                response_data["reference"] = withdraw_data.reference
            
            return response_data
            
        except HTTPException:
            db.rollback()
            raise
            
        except OperationalError as e:
            db.rollback()
            if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                retry_count += 1
                last_exception = e
                logger.warning(f"🔄 Deadlock détecté dans withdraw_from_treasury, retry {retry_count}/{MAX_RETRIES}")
                await asyncio.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                continue
            else:
                logger.error(f"❌ Erreur opérationnelle withdraw_from_treasury: {e}")
                raise HTTPException(status_code=500, detail=f"Erreur opérationnelle: {str(e)}")
                
        except IntegrityError as e:
            db.rollback()
            logger.error(f"❌ Erreur intégrité withdraw_from_treasury: {e}")
            raise HTTPException(status_code=500, detail=f"Erreur d'intégrité: {str(e)}")
            
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Erreur withdraw_from_treasury: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Erreur retrait caisse: {str(e)}")
    
    if last_exception:
        logger.error(f"❌ Échec après {MAX_RETRIES} retries pour withdraw_from_treasury")
        raise HTTPException(status_code=500, detail=f"Échec retrait après {MAX_RETRIES} tentatives")


# ============ ENDPOINTS CADEAUX (GIFTS) ============

@router.get("/gifts", response_model=List[dict])
def get_gifts(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Récupérer tous les cadeaux (GiftTransaction) avec les informations des utilisateurs
    """
    try:
        from app.models.gift_models import GiftTransaction
        
        gifts = db.query(GiftTransaction).all()
        
        result = []
        for gift in gifts:
            sender = db.query(User).filter(User.id == gift.sender_id).first()
            receiver = db.query(User).filter(User.id == gift.receiver_id).first()
            user_bom = db.query(UserBom).filter(UserBom.id == gift.user_bom_id).first()
            bom = db.query(BomAsset).filter(BomAsset.id == user_bom.bom_id).first() if user_bom else None
            
            result.append({
                'id': gift.id,
                'sender_id': gift.sender_id,
                'sender_name': sender.full_name if sender else 'Inconnu',
                'sender_phone': sender.phone if sender else 'N/A',
                'receiver_id': gift.receiver_id,
                'receiver_name': receiver.full_name if receiver else 'Inconnu',
                'receiver_phone': receiver.phone if receiver else 'N/A',
                'bom_title': bom.title if bom else 'N/A',
                'bom_id': bom.id if bom else None,
                'message': gift.message,
                'status': gift.status.value if hasattr(gift.status, 'value') else str(gift.status),
                'amount': str(gift.gross_amount or 0),
                'fee_amount': str(gift.fee_amount or 0),
                'net_amount': str(gift.net_amount or 0),
                'sent_at': gift.created_at.isoformat() if gift.created_at else None,
                'updated_at': gift.updated_at.isoformat() if hasattr(gift, 'updated_at') and gift.updated_at else None,
                'transaction_reference': gift.transaction_reference,
            })
        
        logger.info(f"✅ {len(result)} cadeaux récupérés")
        return result
        
    except Exception as e:
        logger.error(f"❌ Erreur récupération cadeaux: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur récupération cadeaux: {str(e)}")


# ============ ENDPOINTS PARAMÈTRES (SETTINGS) ============

@router.get("/settings", response_model=dict)
def get_settings(
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Récupérer tous les paramètres de la plateforme
    """
    try:
        from app.models.settings_models import PlatformSettings
        
        # Récupérer ou créer les paramètres par défaut
        settings = db.query(PlatformSettings).first()
        
        if not settings:
            # Créer les paramètres par défaut
            settings = PlatformSettings()
            db.add(settings)
            db.commit()
            db.refresh(settings)
            logger.info("✅ Paramètres par défaut créés")
        
        return settings.to_dict()
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur récupération paramètres: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur récupération paramètres: {str(e)}")


@router.put("/settings/general")
def update_settings_general(
    data: dict,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Mettre à jour les paramètres généraux
    """
    try:
        from app.models.settings_models import PlatformSettings
        
        settings = db.query(PlatformSettings).first()
        if not settings:
            settings = PlatformSettings()
            db.add(settings)
        
        # Mettre à jour les champs
        settings.platform_name = data.get('platform_name', settings.platform_name)
        settings.platform_description = data.get('platform_description', settings.platform_description)
        settings.support_email = data.get('support_email', settings.support_email)
        settings.support_phone = data.get('support_phone', settings.support_phone)
        
        db.commit()
        db.refresh(settings)
        
        logger.info("✅ Paramètres généraux mis à jour")
        return {'success': True, 'data': settings.to_dict()}
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur mise à jour paramètres généraux: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@router.put("/settings/fees")
def update_settings_fees(
    data: dict,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Mettre à jour les paramètres de frais
    """
    try:
        from app.models.settings_models import PlatformSettings
        
        settings = db.query(PlatformSettings).first()
        if not settings:
            settings = PlatformSettings()
            db.add(settings)
        
        # Mettre à jour les frais
        settings.transaction_fee_percent = float(data.get('transaction_fee_percent', settings.transaction_fee_percent))
        settings.minimum_transaction = float(data.get('minimum_transaction', settings.minimum_transaction))
        settings.maximum_transaction = float(data.get('maximum_transaction', settings.maximum_transaction))
        settings.wave_fee_percent = float(data.get('wave_fee_percent', settings.wave_fee_percent))
        settings.orange_money_fee_percent = float(data.get('orange_money_fee_percent', settings.orange_money_fee_percent))
        settings.stripe_fee_percent = float(data.get('stripe_fee_percent', settings.stripe_fee_percent))
        
        db.commit()
        db.refresh(settings)
        
        logger.info("✅ Paramètres de frais mis à jour")
        return {'success': True, 'data': settings.to_dict()}
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur mise à jour frais: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@router.put("/settings/payment")
def update_settings_payment(
    data: dict,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Mettre à jour les paramètres de paiement/dépôt
    """
    try:
        from app.models.settings_models import PlatformSettings
        
        settings = db.query(PlatformSettings).first()
        if not settings:
            settings = PlatformSettings()
            db.add(settings)
        
        # Mettre à jour les paramètres de paiement
        settings.minimum_deposit = float(data.get('minimum_deposit', settings.minimum_deposit))
        settings.maximum_deposit = float(data.get('maximum_deposit', settings.maximum_deposit))
        settings.minimum_withdrawal = float(data.get('minimum_withdrawal', settings.minimum_withdrawal))
        settings.maximum_withdrawal = float(data.get('maximum_withdrawal', settings.maximum_withdrawal))
        settings.withdrawal_processing_time_hours = int(data.get('withdrawal_processing_time_hours', settings.withdrawal_processing_time_hours))
        
        db.commit()
        db.refresh(settings)
        
        logger.info("✅ Paramètres de paiement mis à jour")
        return {'success': True, 'data': settings.to_dict()}
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur mise à jour paiement: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@router.put("/settings/notifications")
def update_settings_notifications(
    data: dict,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Mettre à jour les paramètres de notifications
    """
    try:
        from app.models.settings_models import PlatformSettings
        
        settings = db.query(PlatformSettings).first()
        if not settings:
            settings = PlatformSettings()
            db.add(settings)
        
        # Mettre à jour les notifications
        settings.notify_on_transaction = data.get('notify_on_transaction', settings.notify_on_transaction)
        settings.notify_on_deposit = data.get('notify_on_deposit', settings.notify_on_deposit)
        settings.notify_on_withdrawal = data.get('notify_on_withdrawal', settings.notify_on_withdrawal)
        settings.notify_on_gift = data.get('notify_on_gift', settings.notify_on_gift)
        settings.email_notifications_enabled = data.get('email_notifications_enabled', settings.email_notifications_enabled)
        settings.sms_notifications_enabled = data.get('sms_notifications_enabled', settings.sms_notifications_enabled)
        
        db.commit()
        db.refresh(settings)
        
        logger.info("✅ Paramètres de notifications mis à jour")
        return {'success': True, 'data': settings.to_dict()}
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur mise à jour notifications: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")


@router.put("/settings/security")
def update_settings_security(
    data: dict,
    current_user: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """
    Mettre à jour les paramètres de sécurité
    """
    try:
        from app.models.settings_models import PlatformSettings
        
        settings = db.query(PlatformSettings).first()
        if not settings:
            settings = PlatformSettings()
            db.add(settings)
        
        # Mettre à jour la sécurité
        settings.require_2fa = data.get('require_2fa', settings.require_2fa)
        settings.max_login_attempts = int(data.get('max_login_attempts', settings.max_login_attempts))
        settings.lockout_duration_minutes = int(data.get('lockout_duration_minutes', settings.lockout_duration_minutes))
        settings.session_timeout_minutes = int(data.get('session_timeout_minutes', settings.session_timeout_minutes))
        settings.password_min_length = int(data.get('password_min_length', settings.password_min_length))
        settings.maintenance_mode = data.get('maintenance_mode', settings.maintenance_mode)
        settings.maintenance_message = data.get('maintenance_message', settings.maintenance_message)
        
        db.commit()
        db.refresh(settings)
        
        logger.info("✅ Paramètres de sécurité mis à jour")
        return {'success': True, 'data': settings.to_dict()}
        
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur mise à jour sécurité: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur: {str(e)}")
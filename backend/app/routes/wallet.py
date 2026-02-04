from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from decimal import Decimal
from app.database import get_db
from app.models.user_models import User, Wallet
from app.models.payment_models import CashBalance
from app.schemas.wallet_schemas import (
    WalletBalance, TransactionResponse, DepositRequest, WithdrawalRequest
)
from app.services.wallet_service import (
    get_wallet_balance, get_transaction_history, create_transaction, has_sufficient_funds
)
from app.services.auth import get_current_user_from_token as get_current_user
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wallet", tags=["wallet"])

@router.get("/balance", response_model=WalletBalance)
def get_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Récupérer le solde du portefeuille VIRTUEL (Wallet)"""
    try:
        return get_wallet_balance(db, current_user.id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/cash-balance", response_model=WalletBalance)
def get_cash_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Récupérer le solde RÉEL (CashBalance) - pour achats BOOM"""
    try:
        cash_balance = db.query(CashBalance).filter(
            CashBalance.user_id == current_user.id
        ).first()
        
        if not cash_balance:
            cash_balance = CashBalance(
                user_id=current_user.id,
                available_balance=Decimal('0.00'),
                currency="FCFA"
            )
            db.add(cash_balance)
            db.commit()
            db.refresh(cash_balance)
        
        return WalletBalance(
            balance=float(cash_balance.available_balance),
            currency=cash_balance.currency
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur récupération CashBalance: {str(e)}")

# ✅ NOUVELLE ROUTE POUR LES DEUX SOLDES
@router.get("/dual-balance")
def get_dual_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Récupérer les DEUX soldes en une seule requête"""
    try:
        # 1. Argent RÉEL (CashBalance)
        cash_balance = db.query(CashBalance).filter(
            CashBalance.user_id == current_user.id
        ).first()
        
        real_balance = Decimal('0.00')
        if cash_balance and cash_balance.available_balance:
            real_balance = cash_balance.available_balance
        
        # 2. Argent VIRTUEL (Wallet)
        wallet_data = get_wallet_balance(db, current_user.id)
        virtual_balance = Decimal(str(wallet_data.get("balance", 0)))
        
        return {
            "real_balance": float(real_balance),
            "virtual_balance": float(virtual_balance),
            "total_balance": float(real_balance + virtual_balance),
            "currency": "FCFA",
            "real_source": "CashBalance - Pour achats BOOM",
            "virtual_source": "Wallet - Bonus & redistributions"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur récupération soldes: {str(e)}")

@router.get("/check-real-funds/{amount}")
def check_real_funds(
    amount: float,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Vérifier spécifiquement les fonds RÉELS (pour achats BOOM)
    """
    try:
        # Utiliser la fonction modifiée avec fund_type="real"
        from app.services.wallet_service import has_sufficient_funds
        result = has_sufficient_funds(
            db=db,
            user_id=current_user.id,
            amount=amount,
            lock_for_check=False,
            fund_type="real"
        )
        
        return {
            "can_purchase": result["has_funds"],
            "available_real_balance": float(Decimal(result["balance"])),
            "required_amount": amount,
            "missing": float(Decimal(result["missing"])),
            "source": result.get("source", "CashBalance")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur vérification fonds: {str(e)}")

@router.get("/transactions", response_model=list[TransactionResponse])
def get_transactions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Récupérer l'historique des transactions"""
    try:
        return get_transaction_history(db, current_user.id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/deposit", response_model=TransactionResponse)
def deposit_funds(
    deposit_data: DepositRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Déposer de l'argent RÉEL (Mobile Money -> CashBalance)"""
    try:
        if deposit_data.amount <= 0:
            raise HTTPException(status_code=400, detail="Le montant doit être positif")
        
        # 1. Vérifier/Créer CashBalance
        cash_balance = db.query(CashBalance).filter(
            CashBalance.user_id == current_user.id
        ).first()
        
        if not cash_balance:
            cash_balance = CashBalance(
                user_id=current_user.id,
                available_balance=Decimal('0.00'),
                currency="FCFA"
            )
            db.add(cash_balance)
            db.commit()
            db.refresh(cash_balance)
        
        # 2. Mettre à jour CashBalance
        old_balance = cash_balance.available_balance or Decimal('0.00')
        cash_balance.available_balance = old_balance + Decimal(str(deposit_data.amount))
        
        # 3. Créer transaction
        transaction = create_transaction(
            db=db,
            user_id=current_user.id,
            amount=deposit_data.amount,
            transaction_type="deposit_real",
            description=f"Dépôt Mobile Money - {deposit_data.phone_number}"
        )
        
        db.commit()
        
        logger.info(f"✅ Dépôt réussi: {old_balance} → {cash_balance.available_balance}")
        
        return transaction
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur lors du dépôt: {str(e)}")

@router.post("/withdraw", response_model=TransactionResponse)
def withdraw_funds(
    withdrawal_data: WithdrawalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retirer de l'argent RÉEL (CashBalance -> Mobile Money)"""
    try:
        if withdrawal_data.amount <= 0:
            raise HTTPException(status_code=400, detail="Le montant doit être positif")
        
        # 1. Vérifier CashBalance
        cash_balance = db.query(CashBalance).filter(
            CashBalance.user_id == current_user.id
        ).first()
        
        if not cash_balance:
            raise HTTPException(status_code=400, detail="Aucun solde réel disponible")
        
        available_balance = cash_balance.available_balance or Decimal('0.00')
        withdrawal_amount = Decimal(str(withdrawal_data.amount))
        
        # 2. Vérifier solde suffisant
        if available_balance < withdrawal_amount:
            raise HTTPException(
                status_code=400, 
                detail=f"Solde réel insuffisant: {available_balance} FCFA < {withdrawal_amount} FCFA"
            )
        
        # 3. Débiter CashBalance
        old_balance = available_balance
        cash_balance.available_balance = old_balance - withdrawal_amount
        
        # 4. Créer transaction
        transaction = create_transaction(
            db=db,
            user_id=current_user.id,
            amount=withdrawal_data.amount,
            transaction_type="withdrawal_real",
            description=f"Retrait vers {withdrawal_data.phone_number}"
        )
        
        db.commit()
        
        logger.info(f"✅ Retrait réussi: {old_balance} → {cash_balance.available_balance}")
        
        return transaction
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur lors du retrait: {str(e)}")
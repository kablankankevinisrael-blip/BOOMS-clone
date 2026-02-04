"""
ROUTES UTILISATEURS - AVEC CONVERSION DECIMAL VERS STRING POUR PRÉCISION
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from decimal import Decimal
from app.database import get_db
from app.models.user_models import User, Wallet
from app.schemas.user_schemas import UserResponse, UserStatusSnapshot, UserStatusUpdateRequest
from app.services.user_service import UserService
from app.services.auth import get_current_user_from_token  # ✅ CORRECTION: Utiliser le bon nom
import logging
from sqlalchemy import func
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])

# ✅ Créer un alias pour simplifier l'utilisation dans les routes
get_current_user = get_current_user_from_token

# ===============================
# 🔥 ROUTES STATIQUES D'ABORD (AVANT LES ROUTES DYNAMIQUES)
# ===============================

# AJOUT: NOUVEL ENDPOINT POUR L'ÉTAT COMPLET UTILISATEUR
@router.get("/complete-state")
def get_complete_user_state(
    current_user: User = Depends(get_current_user),  # ✅ CORRECTION: current_user en PREMIER
    db: Session = Depends(get_db),                   # ✅ db en SECOND
):
    """
    🎯 ENDPOINT CRITIQUE : Source unique de vérité frontend
    Retourne l'état COMPLET utilisateur (cash + wallet + inventory)
    """
    try:
        logger.info(f"📊 Complete state requested - User: {current_user.id}")
        
        # 1. Wallet virtuel (points, bonus)
        from app.services.wallet_service import get_wallet_balance
        wallet_state = get_wallet_balance(db, current_user.id)
        
        # 2. Cash réel (mobile money)
        from app.models.payment_models import CashBalance
        cash_balance = db.query(CashBalance).filter(
            CashBalance.user_id == current_user.id
        ).first()
        
        # 3. Inventaire BOOMS
        from app.services.purchase_service import PurchaseService
        purchase_service = PurchaseService(db)
        inventory_state = purchase_service.get_user_inventory(current_user.id)

        # 4. Statut de compte consolidé (suspension, limites, bannissement)
        status_snapshot = UserService.get_status_snapshot(db, current_user)
        
        # ✅ CORRECTION: Formater la réponse de manière cohérente
        wallet_balance_value = "0.00"
        if hasattr(wallet_state, 'balance') and wallet_state.balance is not None:
            wallet_balance_value = str(wallet_state.balance)
        elif isinstance(wallet_state, dict) and wallet_state.get("balance") is not None:
            wallet_balance_value = str(wallet_state.get("balance"))
        
        cash_balance_value = "0.00"
        if cash_balance and cash_balance.available_balance is not None:
            cash_balance_value = str(cash_balance.available_balance)
        
        locked_balance_value = "0.00"
        if cash_balance and hasattr(cash_balance, 'locked_balance') and cash_balance.locked_balance is not None:
            locked_balance_value = str(cash_balance.locked_balance)
        
        response = {
            "cash": {
                "real_balance": cash_balance_value,  # ⬅️ CORRECTION: string au lieu de float
                "currency": cash_balance.currency if cash_balance else "FCFA",
                "locked_balance": locked_balance_value  # ⬅️ CORRECTION: string au lieu de float
            },
            "wallet": {
                "virtual_balance": wallet_balance_value,  # ⬅️ CORRECTION: string au lieu de float
                "currency": wallet_state.currency if hasattr(wallet_state, 'currency') else wallet_state.get("currency", "FCFA")
            },
            "inventory": inventory_state,
            "inventory_count": len(inventory_state),
            "account_status": status_snapshot,
            "server_timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "1.0",
            "source": "backend_primary"
        }
        
        logger.info(f"✅ Complete state sent - User: {current_user.id}")
        return response
        
    except Exception as e:
        logger.error(f"❌ Complete state error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail=f"Erreur récupération état complet: {str(e)}"
        )


@router.get("/me/status", response_model=UserStatusSnapshot)
def get_my_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Retourner le statut de compte courant (actif, suspendu, limité)."""
    return UserService.get_status_snapshot(db, current_user)

@router.get("/me/profile")
def get_my_profile(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Récupérer le profil de l'utilisateur connecté avec précision financière"""
    logger.info(f"👤 Récupération profil utilisateur connecté: id={current_user.id}")
    
    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        logger.error(f"❌ Utilisateur {current_user.id} non trouvé en base (incohérence)")
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    wallet = db.query(Wallet).filter(Wallet.user_id == user.id).first()
    
    # ✅ CORRECTION: Préparation des données wallet avec précision
    wallet_data = None
    if wallet:
        balance_str = "0.00"
        if wallet.balance is not None:
            balance_str = str(wallet.balance)
        
        wallet_data = {
            "balance": balance_str,  # ⬅️ CHANGEMENT: string au lieu de float
            "currency": wallet.currency or "FCFA",
            "created_at": wallet.created_at.isoformat() if wallet.created_at else None,
            "updated_at": wallet.updated_at.isoformat() if wallet.updated_at else None
        }
        logger.debug(f"💰 Données wallet préparées: balance={balance_str}")
    else:
        logger.warning(f"⚠️ Pas de wallet pour user {user.id}")
        # Optionnel: créer le wallet s'il n'existe pas
        try:
            new_wallet = Wallet(
                user_id=user.id,
                balance=Decimal('0.00'),
                currency="FCFA"
            )
            db.add(new_wallet)
            db.commit()
            db.refresh(new_wallet)
            
            wallet_data = {
                "balance": "0.00",
                "currency": "FCFA",
                "created_at": new_wallet.created_at.isoformat() if new_wallet.created_at else None,
                "updated_at": None
            }
            logger.info(f"🎯 Wallet créé pour user {user.id}")
        except Exception as e:
            logger.error(f"❌ Erreur création wallet: {e}")
            wallet_data = {
                "balance": "0.00",
                "currency": "FCFA",
                "created_at": None,
                "updated_at": None
            }
    
    account_status = UserService.get_status_snapshot(db, current_user)

    user_profile = {
        "user": {
            "id": user.id,
            "phone": user.phone,
            "email": user.email or "",
            "full_name": user.full_name or "",
            "kyc_status": user.kyc_status or "pending",
            "is_active": user.is_active if user.is_active is not None else True,
            "is_admin": user.is_admin if user.is_admin is not None else False,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "updated_at": user.updated_at.isoformat() if user.updated_at else None
        },
        "wallet": wallet_data,
        "account_status": account_status
    }
    
    logger.info(f"✅ Profil récupéré pour user {user.id}")
    return user_profile

@router.get("/me/balance")
def get_my_balance(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Récupérer uniquement le solde de l'utilisateur connecté (endpoint léger)"""
    logger.info(f"💰 Récupération solde: user={current_user.id}")
    
    wallet = db.query(Wallet).filter(Wallet.user_id == current_user.id).first()
    
    if not wallet:
        logger.warning(f"⚠️ Pas de wallet pour user {current_user.id}, création...")
        try:
            wallet = Wallet(user_id=current_user.id, balance=Decimal('0.00'), currency="FCFA")
            db.add(wallet)
            db.commit()
            db.refresh(wallet)
            logger.info(f"🎯 Wallet créé pour user {current_user.id}")
        except Exception as e:
            logger.error(f"❌ Erreur création wallet: {e}")
            db.rollback()
            wallet = None
    
    balance_str = "0.00"
    if wallet and wallet.balance is not None:
        balance_str = str(wallet.balance)
    
    response = {
        "user_id": current_user.id,
        "balance": balance_str,  # ⬅️ CHANGEMENT: string au lieu de float
        "currency": wallet.currency if wallet else "FCFA",
        "timestamp": db.query(func.now()).scalar().isoformat() if hasattr(db.query(func.now()).scalar(), 'isoformat') else None
    }
    
    logger.info(f"✅ Solde récupéré: {balance_str} FCFA")
    return response

# ===============================
# 🔥 ROUTES DYNAMIQUES APRÈS (AVEC {user_id})
# ===============================


@router.get("/{user_id}/status", response_model=UserStatusSnapshot)
def get_user_status(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Consulter le statut d'un utilisateur (soi-même ou admin)."""
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    if current_user.id != user_id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès non autorisé")

    return UserService.get_status_snapshot(db, target_user)


@router.patch("/{user_id}/status", response_model=UserStatusSnapshot)
def admin_update_user_status(
    user_id: int,
    status_payload: UserStatusUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Modifier le statut d'un utilisateur (admin uniquement)."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    return UserService.update_user_status(db, target_user, status_payload, actor=current_user)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db)):
    """Récupérer les informations d'un utilisateur"""
    logger.info(f"👤 Récupération utilisateur: id={user_id}")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning(f"⚠️ Utilisateur {user_id} non trouvé")
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    logger.info(f"✅ Utilisateur trouvé: {user.phone}")
    return user

@router.get("/{user_id}/wallet")
def get_user_wallet(user_id: int, db: Session = Depends(get_db)):
    """Récupérer le portefeuille d'un utilisateur avec précision Decimal→String"""
    logger.info(f"💰 Récupération wallet: user_id={user_id}")
    
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if not wallet:
        logger.warning(f"⚠️ Wallet non trouvé pour user {user_id}")
        raise HTTPException(status_code=404, detail="Portefeuille non trouvé")
    
    # ✅ CORRECTION: Conversion Decimal → String pour préserver la précision
    balance_str = "0.00"
    if wallet.balance is not None:
        balance_str = str(wallet.balance)
    
    logger.info(f"✅ Wallet trouvé: balance={balance_str} {wallet.currency}")
    
    return {
        "balance": balance_str,  # ⬅️ CHANGEMENT: string au lieu de float
        "currency": wallet.currency or "FCFA",
        "user_id": wallet.user_id,
        "last_updated": wallet.updated_at.isoformat() if wallet.updated_at else None
    }

@router.get("/{user_id}/detailed")
def get_user_detailed(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Récupérer des informations détaillées sur un utilisateur (admin ou soi-même)"""
    logger.info(f"📊 Récupération détaillée utilisateur: id={user_id} par user={current_user.id}")
    
    # Vérifier les permissions
    if current_user.id != user_id and not current_user.is_admin:
        logger.warning(f"⚠️ Accès refusé: user {current_user.id} tente d'accéder à {user_id}")
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")
    
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    
    # ✅ CORRECTION: Compter les possessions ACTIVES seulement
    from app.models.bom_models import UserBom
    bom_count = db.query(UserBom).filter(
        UserBom.user_id == user_id,
        UserBom.is_sold.is_(False), 
        UserBom.deleted_at.is_(None), 
        UserBom.transferred_at.is_(None)  # ← PATCH APPLIQUÉ
    ).count()
    logger.debug(f"📊 Boms comptés (actifs): {bom_count}")
    
    # Compter les transactions
    from app.models.transaction_models import Transaction
    transaction_count = db.query(Transaction).filter(Transaction.user_id == user_id).count()
    
    # Récupérer la dernière transaction
    last_transaction = db.query(Transaction).filter(
        Transaction.user_id == user_id
    ).order_by(Transaction.created_at.desc()).first()
    
    balance_str = "0.00"
    if wallet and wallet.balance is not None:
        balance_str = str(wallet.balance)
    
    detailed_info = {
        "user": {
            "id": user.id,
            "phone": user.phone,
            "email": user.email or "",
            "full_name": user.full_name or "",
            "kyc_status": user.kyc_status or "pending",
            "is_active": user.is_active if user.is_active is not None else True,
            "is_admin": user.is_admin if user.is_admin is not None else False,
            "created_at": user.created_at.isoformat() if user.created_at else None
        },
        "financial": {
            "wallet_balance": balance_str,
            "currency": wallet.currency if wallet else "FCFA",
            "bom_count": bom_count,
            "total_transactions": transaction_count,
            "last_transaction": {
                "id": last_transaction.id if last_transaction else None,
                "type": last_transaction.transaction_type if last_transaction else None,
                "amount": str(last_transaction.amount) if last_transaction and last_transaction.amount else "0.00",
                "date": last_transaction.created_at.isoformat() if last_transaction and last_transaction.created_at else None
            } if last_transaction else None
        },
        "activity": {
            "account_age_days": (db.query(func.now()).scalar() - user.created_at).days if user.created_at else 0,
            "has_wallet": wallet is not None,
            "wallet_created_at": wallet.created_at.isoformat() if wallet and wallet.created_at else None
        },
        "account_status": status_snapshot
    }
    
    logger.info(f"✅ Informations détaillées récupérées pour user {user_id}")
    return detailed_info

@router.get("/{user_id}/exists")
def check_user_exists(user_id: int, db: Session = Depends(get_db)):
    """Vérifier si un utilisateur existe (pour tests ou intégrations)"""
    logger.debug(f"🔍 Vérification existence utilisateur: id={user_id}")
    
    user_exists = db.query(User.id).filter(User.id == user_id).first() is not None
    
    return {
        "user_id": user_id,
        "exists": user_exists,
        "timestamp": db.query(func.now()).scalar().isoformat() if hasattr(db.query(func.now()).scalar(), 'isoformat') else None
    }

@router.get("/", response_model=list[UserResponse])
def list_users(db: Session = Depends(get_db)):
    """Retourne la liste de tous les utilisateurs avec valeurs sûres pour la validation."""
    users = db.query(User).all()
    safe_users = []
    for user in users:
        safe_users.append({
            "id": user.id,
            "phone": user.phone,
            "email": user.email or "",
            "full_name": user.full_name or "",
            "kyc_status": user.kyc_status or "pending",
            "is_active": user.is_active if user.is_active is not None else True,
            "is_admin": user.is_admin if user.is_admin is not None else False,
            "status": user.status.value if user.status else "active",
            "status_reason": user.status_reason or None,
            "status_message": user.status_message or None,
            "status_expires_at": user.status_expires_at,
            "status_source": user.status_source or "manual",
            "created_at": user.created_at,
        })
    return safe_users

# Fonction utilitaire pour formater les montants (si besoin ailleurs dans le code)
def format_amount(amount: Decimal) -> str:
    """Formater un montant Decimal en string avec précision"""
    if amount is None:
        return "0.00"
    
    try:
        # Deux décimales pour l'affichage, mais on garde la précision interne
        return str(amount.quantize(Decimal('0.01')))
    except Exception as e:
        logger.error(f"❌ Erreur formatage montant {amount}: {e}")
        return "0.00"
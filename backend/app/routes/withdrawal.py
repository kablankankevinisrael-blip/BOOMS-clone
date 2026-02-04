"""
ROUTES DE RETRAIT BOOMS - AVEC RATE LIMITING ET LOGS
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user_models import User
from app.schemas.payment_schemas import (
    BomWithdrawalValidationRequest, BomWithdrawalValidationResponse,
    BomWithdrawalExecuteRequest, BomWithdrawalExecuteResponse
)
from app.services.auth import get_current_user_from_token as get_current_user
from app.services.withdrawal_service import validate_bom_withdrawal, execute_bom_withdrawal

# ⬇️⬇️⬇️ RATE LIMITING IMPORT ⬇️⬇️⬇️
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import logging

# ⬇️⬇️⬇️ IMPORT LIMITER DEPUIS L'APP PRINCIPALE ⬇️⬇️⬇️
from app.main import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/withdrawal", tags=["withdrawal"])

@router.post("/bom/validate", response_model=BomWithdrawalValidationResponse)
@limiter.limit("10/minute")  # ⬅️ RATE LIMITING APPLIQUÉ
async def validate_bom_withdrawal_endpoint(
    request: Request,  # ⬅️ REQUIS pour rate limiting
    validation_data: BomWithdrawalValidationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Valider un Bom pour retrait - AVEC RATE LIMITING"""
    try:
        logger.info(f"🔍 Validation retrait - User:{current_user.id}, UserBom:{validation_data.user_bom_id}")
        
        result = validate_bom_withdrawal(db, current_user.id, validation_data.user_bom_id)
        
        logger.info(f"✅ Validation retrait - Résultat: {result.get('is_approved')}")
        
        return BomWithdrawalValidationResponse(
            is_approved=result["is_approved"],
            bom_title=result.get("bom", {}).title if result.get("bom") else "",
            bom_value=float(result.get("withdrawal_amount", 0)),
            withdrawal_amount=float(result.get("withdrawal_amount", 0)),
            fees=float(result.get("fees", 0)),
            net_amount=float(result.get("net_amount", 0)),
            security_checks=result.get("security_checks", {}),
            rejection_reason=result.get("rejection_reason")
        )
        
    except Exception as e:
        logger.error(f"❌ Erreur validation retrait: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/bom/execute", response_model=BomWithdrawalExecuteResponse)
@limiter.limit("3/minute")  # ⬅️ RATE LIMITING (plus restrictif)
async def execute_bom_withdrawal_endpoint(
    request: Request,  # ⬅️ REQUIS pour rate limiting
    withdrawal_data: BomWithdrawalExecuteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Exécuter le retrait d'un Bom - AVEC RATE LIMITING"""
    try:
        logger.info(f"💰 Exécution retrait - User:{current_user.id}, UserBom:{withdrawal_data.user_bom_id}")
        
        result = execute_bom_withdrawal(
            db, 
            current_user.id, 
            withdrawal_data.user_bom_id,
            phone_number=withdrawal_data.phone_number,
            provider=withdrawal_data.provider
        )
        
        logger.info(f"✅ Retrait exécuté - Transaction:{result.get('transaction_id', 'N/A')}")
        
        return BomWithdrawalExecuteResponse(**result)
        
    except Exception as e:
        logger.error(f"❌ Erreur exécution retrait: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

# ⬅️ AJOUT: Statistiques de retrait (admin seulement)
@router.get("/stats")
@limiter.limit("30/minute")  # ⬅️ RATE LIMITING
async def get_withdrawal_stats(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Récupérer les statistiques de retrait - ADMIN SEULEMENT AVEC RATE LIMITING"""
    try:
        # Vérifier si admin
        if not current_user.is_admin:
            raise HTTPException(status_code=403, detail="Accès non autorisé")
        
        from app.models.payment_models import PaymentTransaction
        from datetime import datetime, timedelta
        from sqlalchemy import func
        
        logger.info(f"📊 Statistiques retrait demandées par admin:{current_user.id}")
        
        # Calculer les stats des 30 derniers jours
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        
        # Total des retraits
        withdrawals = db.query(PaymentTransaction).filter(
            PaymentTransaction.type == "bom_withdrawal",
            PaymentTransaction.created_at >= thirty_days_ago,
            PaymentTransaction.status == "completed"
        ).all()
        
        total_withdrawn = sum(float(tx.amount) for tx in withdrawals)
        total_fees = sum(float(tx.fees) for tx in withdrawals)
        total_net = sum(float(tx.net_amount) for tx in withdrawals)
        
        # Statistiques par jour
        daily_stats = db.query(
            func.date(PaymentTransaction.created_at).label('date'),
            func.count(PaymentTransaction.id).label('count'),
            func.sum(PaymentTransaction.amount).label('total_amount'),
            func.sum(PaymentTransaction.fees).label('total_fees')
        ).filter(
            PaymentTransaction.type == "bom_withdrawal",
            PaymentTransaction.created_at >= thirty_days_ago,
            PaymentTransaction.status == "completed"
        ).group_by(func.date(PaymentTransaction.created_at)).order_by('date').all()
        
        logger.info(f"📈 Statistiques générées - {len(withdrawals)} retraits")
        
        return {
            "period": "30 derniers jours",
            "total_withdrawals": len(withdrawals),
            "total_withdrawn_amount": total_withdrawn,
            "total_fees_collected": total_fees,
            "total_net_amount": total_net,
            "average_withdrawal": total_withdrawn / len(withdrawals) if withdrawals else 0,
            "withdrawals_per_day": len(withdrawals) / 30,
            "daily_stats": [
                {
                    "date": stat.date.isoformat() if hasattr(stat.date, 'isoformat') else str(stat.date),
                    "count": stat.count,
                    "total_amount": float(stat.total_amount or 0),
                    "total_fees": float(stat.total_fees or 0)
                }
                for stat in daily_stats
            ]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Erreur statistiques retrait: {str(e)}")
        raise HTTPException(status_code=500, detail="Erreur interne")
"""
ROUTES DE PAIEMENT - AVEC RATE LIMITING ET SÉCURITÉ RENFORCÉE
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user_models import User
from app.schemas.payment_schemas import (
    DepositRequest, WavePaymentResponse, StripePaymentResponse,
    PaymentTransactionResponse, DetailedBalanceResponse,
    PaymentMethod, WithdrawalRequest, WithdrawalResponse, CommissionSummary,
    AdminTreasuryDepositRequest, AdminTreasuryWithdrawRequest, AdminTreasuryOperationResponse
)
from app.services.auth import get_current_user_from_token as get_current_user
from app.services.wave_service import WavePaymentService
from app.services.stripe_service import StripePaymentService
from app.services.orange_money_service import OrangeMoneyService
from app.services.mtn_momo_service import MTNMobileMoneyService  # ⬅️ AJOUT
from app.services.payment_service import get_detailed_balance, create_payment_transaction, get_user_cash_balance
from app.models.payment_models import PaymentStatus
from app.services.wallet_service import get_platform_treasury, update_platform_treasury
from app.models.admin_models import AdminLog

# ⬇️⬇️⬇️ RATE LIMITING IMPORT ⬇️⬇️⬇️
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# ⬇️⬇️⬇️ DEBUG EXISTANT ⬇️⬇️⬇️
try:
    from app.config import settings
    print("✅ SUCCÈS - Settings importées depuis app.config")
    # 🔐 NE JAMAIS afficher les clés API !
    key_preview = settings.WAVE_API_KEY[:4] + "****" + settings.WAVE_API_KEY[-4:] if settings.WAVE_API_KEY else "NOT SET"
    print(f"✅ WAVE_API_KEY: {key_preview}")
except ImportError as e:
    print(f"❌ ÉCHEC - Impossible d'importer settings: {e}")
    # Solution de secours
    class TempSettings:
        WAVE_API_KEY = "wave_test_key"
        STRIPE_SECRET_KEY = "sk_test_xxx"
    settings = TempSettings()
    print("🔄 Utilisation des settings temporaires")
# ⬆️⬆️⬆️ FIN DU DEBUG ⬆️⬆️⬆️

# ⚙️ CONFIGURATION CENTRALE
from app.config import settings
import uuid
import logging
from decimal import Decimal
import asyncio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"])

PROVIDER_LABELS = {
    PaymentMethod.WAVE: "Wave Côte d'Ivoire",
    PaymentMethod.STRIPE: "Stripe",
    PaymentMethod.ORANGE_MONEY: "Orange Money",
    PaymentMethod.MTN_MOMO: "MTN MoMo",
}


def ensure_provider_configured(method: PaymentMethod) -> None:
    """Vérifie que toutes les variables d'environnement nécessaires sont présentes."""
    provider_requirements = settings.PAYMENT_PROVIDER_KEYS.get(method.value, {})

    if not provider_requirements:
        return

    missing = [name for name, value in provider_requirements.items() if not value]
    if missing:
        provider_label = PROVIDER_LABELS.get(method, "ce service")
        logger.warning(
            "Service paiement désactivé faute de configuration",
            extra={"method": method.value, "missing": missing},
        )
        raise HTTPException(
            status_code=503,
            detail={
                "error": "PROVIDER_INDISPONIBLE",
                "message": (
                    f"Le service {provider_label} est momentanément indisponible. "
                    "Merci de réessayer plus tard."
                ),
            },
        )

# ⬇️⬇️⬇️ IMPORT LIMITER DEPUIS L'APP PRINCIPALE ⬇️⬇️⬇️
from app.main import limiter

@router.post("/deposit/initiate")
@limiter.limit("5/minute")  # ⬅️ RATE LIMITING APPLIQUÉ
async def initiate_deposit(
    request: Request,
    deposit_data: DepositRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Initier un dépôt avec messages d'erreur clairs - AVEC RATE LIMITING"""
    logger.info(f"💰 Initiation dépôt - User:{current_user.id}, Amount:{deposit_data.amount}, Method:{deposit_data.method}")
    
    ensure_provider_configured(deposit_data.method)

    # Si configuré, procéder normalement
    if deposit_data.method == PaymentMethod.WAVE:
        return await handle_wave_deposit(deposit_data, current_user, db)
    elif deposit_data.method == PaymentMethod.STRIPE:
        return await handle_stripe_deposit(deposit_data, current_user, db)
    elif deposit_data.method == PaymentMethod.ORANGE_MONEY:
        return await handle_orange_money_deposit(deposit_data, current_user, db)
    elif deposit_data.method == PaymentMethod.MTN_MOMO:  # ⬅️ AJOUT
        return await handle_mtn_momo_deposit(deposit_data, current_user, db)
    else:
        raise HTTPException(status_code=400, detail="Méthode de paiement non supportée")

async def handle_wave_deposit(deposit_data: DepositRequest, user: User, db: Session):
    """Gérer dépôt Wave"""
    if not deposit_data.phone_number:
        raise HTTPException(status_code=400, detail="Numéro de téléphone requis pour Wave")
        
    from app.services.commission_service import CommissionService
    from decimal import Decimal
    
    commission_calc = CommissionService.calculate_deposit_commission(
        db,
        Decimal(str(deposit_data.amount)),
        "wave",
    )
    
    wave_service = WavePaymentService()
    result = await wave_service.initiate_deposit(  # ⬅️ CORRECTION: initiate_deposit, pas initiate_payment
        deposit_data.amount, 
        deposit_data.phone_number,
        str(user.id)
    )
    
    # Créer transaction en attente
    transaction = create_payment_transaction(
        db=db,
        user_id=user.id,
        transaction_type="deposit",
        amount=deposit_data.amount,
        fees=0.00,
        net_amount=deposit_data.amount,
        status=PaymentStatus.PENDING,
        provider="wave",
        provider_reference=result.get("id"),
        description=f"Dépôt Wave - {deposit_data.phone_number}"
    )
    
    db.commit()
    
    return WavePaymentResponse(
        payment_url=result["payment_url"],
        transaction_id=transaction.id,
        qr_code_data=result.get("qr_code")
    )

async def handle_stripe_deposit(deposit_data: DepositRequest, user: User, db: Session):
    """Gérer dépôt Stripe"""
    stripe_service = StripePaymentService()
    result = await stripe_service.create_payment_intent(deposit_data.amount, str(user.id))
    
    # Créer transaction en attente
    transaction = create_payment_transaction(
        db=db,
        user_id=user.id,
        transaction_type="deposit",
        amount=deposit_data.amount,
        fees=0.00,
        net_amount=deposit_data.amount,
        status=PaymentStatus.PENDING,
        provider="stripe", 
        provider_reference=result["payment_intent_id"],
        description="Dépôt carte bancaire"
    )
    
    db.commit()
    
    return StripePaymentResponse(
        client_secret=result["client_secret"],
        payment_intent_id=result["payment_intent_id"]
    )

async def handle_orange_money_deposit(deposit_data: DepositRequest, user: User, db: Session):
    """Gérer dépôt Orange Money"""
    if not deposit_data.phone_number:
        raise HTTPException(status_code=400, detail="Numéro de téléphone requis pour Orange Money")
    
    orange_service = OrangeMoneyService()
    result = await orange_service.initiate_deposit(
        deposit_data.amount,
        deposit_data.phone_number,
        str(user.id)
    )
    
    # Créer transaction en attente
    transaction = create_payment_transaction(
        db=db,
        user_id=user.id,
        transaction_type="deposit",
        amount=deposit_data.amount,
        fees=0.00,
        net_amount=deposit_data.amount,
        status=PaymentStatus.PENDING,
        provider="orange_money",
        provider_reference=result.get("transaction_id"),
        description=f"Dépôt Orange Money - {deposit_data.phone_number}"
    )
    
    db.commit()
    
    return {
        "success": True,
        "transaction_id": transaction.id,
        "orange_transaction_id": result.get("transaction_id"),
        "merchant_reference": result.get("merchant_reference"),
        "status": result.get("status"),
        "instructions": result.get("instructions", "Veuillez confirmer le paiement sur votre mobile Orange Money"),
        "financial_details": result.get("financial_details", {})
    }

async def handle_mtn_momo_deposit(deposit_data: DepositRequest, user: User, db: Session):  # ⬅️ NOUVELLE FONCTION
    """Gérer dépôt MTN MoMo"""
    if not deposit_data.phone_number:
        raise HTTPException(status_code=400, detail="Numéro de téléphone requis pour MTN MoMo")
    
    from app.services.commission_service import CommissionService
    from decimal import Decimal
    
    # Calculer les commissions
    commission_calc = CommissionService.calculate_deposit_commission(
        db,
        Decimal(str(deposit_data.amount)),
        "mtn_momo",
    )
    
    # Initialiser le service MTN MoMo
    momo_service = MTNMobileMoneyService()
    
    # Générer un ID de référence unique
    external_id = f"BOOMS_DEPOSIT_{user.id}_{int(uuid.uuid4().timestamp())}"
    
    try:
        # Initier le paiement MTN MoMo
        status_code, response = momo_service.request_payment(
            deposit_data.amount,
            deposit_data.phone_number,
            external_id
        )
        
        if status_code != 202:  # 202 Accepted pour MTN MoMo
            error_msg = f"Erreur MTN MoMo: {status_code} - {response}"
            logger.error(f"❌ {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)
        
        # Créer transaction en attente
        transaction = create_payment_transaction(
            db=db,
            user_id=user.id,
            transaction_type="deposit",
            amount=deposit_data.amount,
            fees=0.00,
            net_amount=deposit_data.amount,
            status=PaymentStatus.PENDING,
            provider="mtn_momo",
            provider_reference=external_id,
            description=f"Dépôt MTN MoMo - {deposit_data.phone_number}"
        )
        
        db.commit()
        
        return {
            "success": True,
            "transaction_id": transaction.id,
            "external_id": external_id,
            "status": "pending",
            "instructions": "Veuillez confirmer le paiement sur votre mobile MTN MoMo",
            "financial_details": {
                "amount": float(deposit_data.amount),
                "momo_fee": float(commission_calc.get("provider_fee", 0)),
                "your_commission": float(commission_calc.get("your_commission", 0)),
                "net_to_user": float(commission_calc.get("net_to_user", deposit_data.amount)),
                "total_fees": float(commission_calc.get("total_fees", 0))
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Erreur initiation dépôt MTN MoMo: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Erreur initiation dépôt MTN MoMo: {str(e)}"
        )

@router.get("/balance/detailed", response_model=DetailedBalanceResponse)
async def get_detailed_balance_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Récupérer le solde détaillé"""
    return get_detailed_balance(db, current_user.id)

@router.post("/wave/webhook")
@limiter.limit("60/minute")  # ⬅️ RATE LIMITING pour webhook
async def wave_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    """Webhook Wave - AVEC RATE LIMITING"""
    payload = await request.body()
    signature = request.headers.get("X-Wave-Signature")
    
    wave_service = WavePaymentService()
    if not wave_service.verify_webhook_signature(payload.decode(), signature):
        raise HTTPException(status_code=401, detail="Signature invalide")
    
    webhook_data = await request.json()
    success = await wave_service.process_deposit_webhook(db, webhook_data)
    
    # ⬅️ AJOUT: Log admin pour webhook
    if success:
        admin_log = AdminLog(
            admin_id=0,  # Système
            action="wave_webhook_processed",
            details={
                "type": "deposit",
                "status": "success",
                "data": webhook_data.get("id", "unknown")
            }
        )
        db.add(admin_log)
        db.commit()
    
    return {"status": "success" if success else "ignored"}

@router.post("/orange/webhook")
@limiter.limit("60/minute")  # ⬅️ RATE LIMITING
async def orange_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    """Webhook Orange Money - AVEC RATE LIMITING"""
    payload = await request.body()
    signature = request.headers.get("X-Orange-Signature") or request.headers.get("X-Signature")
    
    orange_service = OrangeMoneyService()
    
    # Vérifier la signature si configurée
    if settings.ORANGE_WEBHOOK_SECRET and signature:
        if not orange_service.verify_webhook_signature(payload.decode(), signature):
            raise HTTPException(status_code=401, detail="Signature Orange invalide")
    
    webhook_data = await request.json()
    
    # Déterminer le type de transaction
    order_id = webhook_data.get("order_id", "")
    
    # ⬅️ AJOUT: Log admin pour webhook
    admin_log = AdminLog(
        admin_id=0,  # Système
        action="orange_webhook_received",
        details={
            "order_id": order_id,
            "type": "deposit" if "DEPOSIT" in order_id else "withdrawal",
            "data": webhook_data
        }
    )
    db.add(admin_log)
    
    if order_id.startswith("BOOMS_DEPOSIT_OM_"):
        success = await orange_service.process_deposit_webhook(db, webhook_data)
        return {"status": "deposit_processed" if success else "deposit_ignored"}
    elif order_id.startswith("BOOMS_WITHDRAWAL_OM_"):
        success = await orange_service.process_withdrawal_webhook(db, webhook_data)
        return {"status": "withdrawal_processed" if success else "withdrawal_ignored"}
    else:
        return {"status": "ignored", "reason": "order_id_non_reconnu"}

@router.post("/stripe/webhook")
@limiter.limit("60/minute")  # ⬅️ RATE LIMITING
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    """Webhook Stripe - AVEC RATE LIMITING"""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    stripe_service = StripePaymentService()
    success = await stripe_service.handle_deposit_webhook(db, payload, sig_header)
    
    # ⬅️ AJOUT: Log admin pour webhook
    if success:
        admin_log = AdminLog(
            admin_id=0,  # Système
            action="stripe_webhook_processed",
            details={
                "type": "deposit",
                "status": "success"
            }
        )
        db.add(admin_log)
        db.commit()
    
    return {"status": "processed" if success else "ignored"}

@router.post("/momo/webhook")  # ⬅️ AJOUT: Webhook MTN MoMo
@limiter.limit("60/minute")  # ⬅️ RATE LIMITING
async def momo_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    """Webhook MTN MoMo - AVEC RATE LIMITING"""
    momo_service = MTNMobileMoneyService()
    success = await momo_service.handle_momo_webhook(request, db)
    
    # ⬅️ AJOUT: Log admin pour webhook
    if success:
        admin_log = AdminLog(
            admin_id=0,  # Système
            action="momo_webhook_processed",
            details={
                "type": "deposit",
                "status": "success"
            }
        )
        db.add(admin_log)
        db.commit()
    
    return {"status": "processed" if success else "ignored"}

@router.post("/withdrawal/initiate", response_model=WithdrawalResponse)
@limiter.limit("5/minute")  # ⬅️ RATE LIMITING
async def initiate_withdrawal(
    request: Request,
    withdrawal_data: WithdrawalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Initier un retrait vers Wave, Orange Money, etc. - AVEC RATE LIMITING"""
    logger.info(f"💰 Initiation retrait - User:{current_user.id}, Amount:{withdrawal_data.amount}, Method:{withdrawal_data.method}")
    
    # Vérifier le solde
    cash_balance = get_user_cash_balance(db, current_user.id)
    if cash_balance.available_balance < withdrawal_data.amount:
        raise HTTPException(status_code=400, detail="Solde insuffisant")
    
    # Calculer les frais selon la méthode
    from decimal import Decimal
    amount_decimal = Decimal(str(withdrawal_data.amount))
    
    if withdrawal_data.method == PaymentMethod.WAVE:
        service_fee = amount_decimal * Decimal('0.02')  # 2% frais Wave
        provider = "wave"
    elif withdrawal_data.method == PaymentMethod.ORANGE_MONEY:
        service_fee = amount_decimal * Decimal('0.02')  # 2% frais Orange
        provider = "orange_money"
    elif withdrawal_data.method == PaymentMethod.STRIPE:
        service_fee = amount_decimal * Decimal('0.03')  # 3% frais Stripe
        provider = "stripe"
    elif withdrawal_data.method == PaymentMethod.MTN_MOMO:  # ⬅️ AJOUT
        service_fee = amount_decimal * Decimal('0.025')  # 2.5% frais MTN MoMo
        provider = "mtn_momo"
    else:
        raise HTTPException(status_code=400, detail="Méthode de retrait non supportée")
    
    # Vérifier solde après frais
    total_debit = amount_decimal + service_fee
    if cash_balance.available_balance < total_debit:
        raise HTTPException(status_code=400, detail=f"Solde insuffisant pour couvrir les frais. Total requis: {total_debit} FCFA")
    
    # ⬅️ AJOUT: Transaction atomique avec logs
    try:
        from sqlalchemy.exc import IntegrityError
        
        with db.begin_nested():
            # Bloquer le montant total (montant + frais)
            cash_balance.available_balance -= total_debit
            cash_balance.locked_balance += amount_decimal
            
            # Ajouter les frais à la caisse plateforme
            treasury = get_platform_treasury(db)
            treasury.balance += service_fee
            
            # Log admin pour frais
            admin_log = AdminLog(
                admin_id=0,  # Système
                action="withdrawal_fees_collected",
                details={
                    "user_id": current_user.id,
                    "amount": str(amount_decimal),
                    "fees": str(service_fee),
                    "provider": provider,
                    "phone_number": withdrawal_data.phone_number,
                    "old_treasury_balance": str(treasury.balance - service_fee),
                    "new_treasury_balance": str(treasury.balance)
                }
            )
            db.add(admin_log)
            
            # Sélectionner le service selon la méthode
            if withdrawal_data.method == PaymentMethod.WAVE:
                service = WavePaymentService()
                result = await service.initiate_withdrawal(
                    withdrawal_data.amount,
                    withdrawal_data.phone_number, 
                    str(current_user.id)
                )
                provider_ref = result.get("id")
                
            elif withdrawal_data.method == PaymentMethod.ORANGE_MONEY:
                service = OrangeMoneyService()
                result = await service.initiate_withdrawal(
                    withdrawal_data.amount,
                    withdrawal_data.phone_number,
                    str(current_user.id)
                )
                provider_ref = result.get("transaction_id")
            elif withdrawal_data.method == PaymentMethod.MTN_MOMO:  # ⬅️ AJOUT
                # TODO: Implémenter retrait MTN MoMo
                provider_ref = f"MTN_WITHDRAWAL_{current_user.id}_{int(uuid.uuid4().timestamp())}"
            else:
                provider_ref = str(uuid.uuid4())
            
            # Créer transaction
            transaction = create_payment_transaction(
                db=db,
                user_id=current_user.id,
                transaction_type="withdrawal",
                amount=float(amount_decimal),
                fees=float(service_fee),
                net_amount=float(amount_decimal),
                status=PaymentStatus.PENDING,
                provider=provider,
                provider_reference=provider_ref,
                description=f"Retrait {provider} - {withdrawal_data.phone_number}"
            )
        
        db.commit()
        
        logger.info(f"✅ Retrait initié - Transaction:{transaction.id}, Frais:{service_fee} FCFA")
        
        return WithdrawalResponse(
            status="pending", 
            transaction_id=transaction.id,
            estimated_processing_time="2-5 minutes"
        )
        
    except IntegrityError as e:
        db.rollback()
        logger.error(f"❌ Erreur transaction retrait: {str(e)}")
        raise HTTPException(status_code=500, detail="Erreur lors du traitement du retrait")
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Erreur retrait: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/admin/commissions/daily", response_model=CommissionSummary)
@limiter.limit("30/minute")  # ⬅️ RATE LIMITING
async def get_daily_commissions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Endpoint admin pour voir vos commissions - AVEC RATE LIMITING"""
    from app.services.commission_service import CommissionService
    from datetime import datetime
    
    # Vérifier que c'est un admin
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    
    logger.info(f"📊 Commissions quotidiennes demandées par admin:{current_user.id}")
    
    return CommissionService.get_daily_commissions(db)

@router.get("/orange/status/{transaction_id}")
@limiter.limit("10/minute")  # ⬅️ RATE LIMITING
async def check_orange_status(
    request: Request,
    transaction_id: str,
    current_user: User = Depends(get_current_user)
):
    """Vérifier le statut d'une transaction Orange Money - AVEC RATE LIMITING"""
    orange_service = OrangeMoneyService()
    status = await orange_service.check_transaction_status(transaction_id)
    
    return {
        "transaction_id": transaction_id,
        "status": status.get("status"),
        "details": status
    }

# ⬅️ AJOUT: Endpoint pour vérifier les frais de retrait
@router.get("/withdrawal/fees")
@limiter.limit("10/minute")
async def calculate_withdrawal_fees(
    request: Request,
    amount: float,
    method: PaymentMethod,
    current_user: User = Depends(get_current_user)
):
    """Calculer les frais de retrait - AVEC RATE LIMITING"""
    from decimal import Decimal
    
    amount_decimal = Decimal(str(amount))
    
    fees_map = {
        PaymentMethod.WAVE: Decimal('0.02'),  # 2%
        PaymentMethod.ORANGE_MONEY: Decimal('0.02'),  # 2%
        PaymentMethod.STRIPE: Decimal('0.03'),  # 3%
        PaymentMethod.MTN_MOMO: Decimal('0.025'),  # ⬅️ AJOUT: 2.5% pour MTN MoMo
    }
    
    fee_percentage = fees_map.get(method, Decimal('0.02'))
    fees = amount_decimal * fee_percentage
    net_amount = amount_decimal - fees
    
    return {
        "amount": str(amount_decimal),
        "method": method,
        "fee_percentage": float(fee_percentage * 100),
        "fees": str(fees),
        "net_amount": str(net_amount),
        "total_debit": str(amount_decimal + fees)
    }
    
# ============ ROUTES ADMIN TREASURY DÉFINITIVES ============

@router.post("/admin/treasury/deposit", response_model=AdminTreasuryOperationResponse)
@limiter.limit("10/minute")
async def admin_deposit_to_treasury(
    request: Request,
    deposit_request: AdminTreasuryDepositRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Endpoint définitif pour dépôt admin → treasury
    0% frais, transactions atomiques, logs complets
    """
    operation_id = f"route_dep_{current_user.id}_{int(datetime.now().timestamp())}"
    
    logger.info(f"🏦 ROUTE ADMIN DEPOSIT: {operation_id}", extra={
        "admin_id": current_user.id,
        "amount": deposit_request.amount,
        "method": deposit_request.method.value,
        "operation_id": operation_id
    })
    
    # Vérification admin (robuste)
    if not current_user or not current_user.is_admin:
        logger.warning(f"⚠️ Tentative accès non-admin: {current_user.id if current_user else 'none'}")
        raise HTTPException(
            status_code=403,
            detail="Accès réservé aux administrateurs certifiés"
        )
    
    try:
        amount_decimal = Decimal(str(deposit_request.amount))
        
        # Vérification de cohérence
        if amount_decimal <= Decimal('0'):
            raise ValueError("Montant doit être positif")
        
        # Utilisation du service perfectionné
        from app.services.admin_treasury_service import AdminTreasuryService
        
        result = await AdminTreasuryService.execute_admin_deposit(
            db=db,
            admin_user=current_user,
            amount=amount_decimal,
            method=deposit_request.method,
            phone_number=deposit_request.phone_number,
            description=deposit_request.description or f"Dépôt admin {operation_id}"
        )
        
        # IMPORTANT: Pas de db.commit() manuel - FastAPI gère
        
        # Ajouter l'ID d'opération au résultat
        result["operation_id"] = operation_id
        
        logger.info(f"✅ ROUTE ADMIN DEPOSIT SUCCESS: {operation_id}", extra={
            "transaction_id": result["transaction_id"],
            "treasury_new": result["new_treasury_balance"]
        })
        
        # Broadcast WebSocket (optionnel mais recommandé)
        try:
            from app.websockets import broadcast_treasury_update
            await broadcast_treasury_update({
                "type": "treasury_updated",
                "admin_id": current_user.id,
                "old_balance": result["old_treasury_balance"],
                "new_balance": result["new_treasury_balance"],
                "operation": "deposit",
                "amount": result["amount"],
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        except ImportError as e:
            logger.debug(f"WebSocket non disponible: {e}")
        except Exception as e:
            logger.warning(f"⚠️ WebSocket error: {e}")
        
        return AdminTreasuryOperationResponse(**result)
        
    except ValueError as e:
        logger.error(f"❌ ROUTE ADMIN DEPOSIT VALIDATION: {operation_id}", extra={
            "error": str(e),
            "admin_id": current_user.id
        })
        raise HTTPException(
            status_code=400,
            detail=str(e)
        )
    except HTTPException:
        raise  # Propager les HTTPException telles quelles
    except Exception as e:
        logger.critical(f"❌❌ ROUTE ADMIN DEPOSIT CRITICAL: {operation_id}", extra={
            "error": str(e),
            "admin_id": current_user.id,
            "trace": str(e.__traceback__) if settings.DEBUG else None
        }, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Erreur interne lors du dépôt admin" if not settings.DEBUG else f"Erreur: {str(e)}"
        )

@router.post("/admin/treasury/withdraw", response_model=AdminTreasuryOperationResponse)
@limiter.limit("10/minute")
async def admin_withdraw_from_treasury(
    request: Request,
    withdraw_request: AdminTreasuryWithdrawRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Endpoint définitif pour retrait treasury → admin
    0% frais, vérifications complètes, atomicité garantie
    """
    operation_id = f"route_wth_{current_user.id}_{int(datetime.now().timestamp())}"
    
    logger.info(f"🏦 ROUTE ADMIN WITHDRAWAL: {operation_id}", extra={
        "admin_id": current_user.id,
        "amount": withdraw_request.amount,
        "method": withdraw_request.method.value,
        "operation_id": operation_id
    })
    
    if not current_user or not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès réservé")
    
    try:
        amount_decimal = Decimal(str(withdraw_request.amount))
        
        # Vérification préalable
        if amount_decimal <= Decimal('0'):
            raise ValueError("Montant doit être positif")
        
        from app.services.admin_treasury_service import AdminTreasuryService
        
        result = await AdminTreasuryService.execute_admin_withdrawal(
            db=db,
            admin_user=current_user,
            amount=amount_decimal,
            method=withdraw_request.method,
            phone_number=withdraw_request.phone_number,
            description=withdraw_request.description or f"Retrait admin {operation_id}"
        )
        
        # Ajouter l'ID d'opération
        result["operation_id"] = operation_id
        
        logger.info(f"✅ ROUTE ADMIN WITHDRAWAL SUCCESS: {operation_id}", extra={
            "transaction_id": result["transaction_id"],
            "treasury_new": result["new_treasury_balance"]
        })
        
        # Broadcast
        try:
            from app.websockets import broadcast_treasury_update
            await broadcast_treasury_update({
                "type": "treasury_updated",
                "admin_id": current_user.id,
                "old_balance": result["old_treasury_balance"],
                "new_balance": result["new_treasury_balance"],
                "operation": "withdrawal",
                "amount": result["amount"],
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        except Exception as e:
            logger.debug(f"WebSocket non disponible: {e}")
        
        return AdminTreasuryOperationResponse(**result)
        
    except ValueError as e:
        logger.error(f"❌ ROUTE ADMIN WITHDRAWAL VALIDATION: {operation_id}", extra={
            "error": str(e),
            "admin_id": current_user.id
        })
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.critical(f"❌❌ ROUTE ADMIN WITHDRAWAL CRITICAL: {operation_id}", extra={
            "error": str(e),
            "admin_id": current_user.id
        }, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Erreur interne lors du retrait admin" if not settings.DEBUG else f"Erreur: {str(e)}"
        )

@router.get("/admin/treasury/status")
@limiter.limit("30/minute")
async def get_admin_treasury_status(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    detailed: bool = False
):
    """
    Endpoint définitif pour statut treasury
    Retour complet avec métriques et vérifications
    """
    if not current_user or not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès réservé")
    
    from app.models.admin_models import PlatformTreasury
    from sqlalchemy import func, desc
    from datetime import datetime, timedelta, timezone
    
    try:
        treasury = db.query(PlatformTreasury).first()
        
        if not treasury:
            # Retour structuré même si pas de treasury
            return {
                "status": "initialization_required",
                "treasury": {
                    "balance": "0.00",
                    "currency": "FCFA",
                    "total_fees_collected": "0.00",
                    "exists": False
                },
                "admin": {
                    "id": current_user.id,
                    "can_initialize": True
                },
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        
        # Métriques avancées si detailed=True
        metrics = {}
        if detailed:
            thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
            
            # Opérations admin
            admin_ops = db.query(AdminLog).filter(
                AdminLog.admin_id == current_user.id,
                AdminLog.action.in_(["treasury_deposit_admin", "treasury_withdrawal_admin"]),
                AdminLog.created_at >= thirty_days_ago
            )
            
            total_deposits = sum(
                Decimal(log.details.get("amount", "0")) 
                for log in admin_ops.filter(AdminLog.action == "treasury_deposit_admin").all()
            )
            
            total_withdrawals = sum(
                Decimal(log.details.get("amount", "0")) 
                for log in admin_ops.filter(AdminLog.action == "treasury_withdrawal_admin").all()
            )
            
            metrics = {
                "last_30_days": {
                    "deposits": str(total_deposits),
                    "withdrawals": str(total_withdrawals),
                    "net_flow": str(total_deposits - total_withdrawals),
                    "operation_count": admin_ops.count()
                }
            }
        
        # Dernières opérations
        recent_ops = db.query(AdminLog).filter(
            AdminLog.admin_id == current_user.id,
            AdminLog.action.in_(["treasury_deposit_admin", "treasury_withdrawal_admin"])
        ).order_by(desc(AdminLog.created_at)).limit(10).all()
        
        return {
            "status": "operational",
            "treasury": {
                "balance": str(treasury.balance),
                "currency": treasury.currency,
                "total_fees_collected": str(treasury.total_fees_collected),
                "last_updated": treasury.updated_at.isoformat() if treasury.updated_at else None,
                "created_at": treasury.created_at.isoformat() if treasury.created_at else None,
                "exists": True
            },
            "admin": {
                "id": current_user.id,
                "fees_policy": "0% pour toutes les opérations",
                "rate_limits": {
                    "deposit": "10/minute",
                    "withdrawal": "10/minute",
                    "status": "30/minute"
                }
            },
            "operations": {
                "recent": [
                    {
                        "id": op.id,
                        "action": op.action,
                        "amount": op.details.get("amount", "0.00") if op.details else "0.00",
                        "timestamp": op.created_at.isoformat() if op.created_at else None,
                        "fees": str(op.fees_amount),
                        "external_ref": op.details.get("external_reference") if op.details else None
                    }
                    for op in recent_ops
                ],
                "total_recent": len(recent_ops)
            },
            "metrics": metrics if detailed else {"available": "set detailed=true"},
            "system": {
                "currency": "FCFA",
                "admin_exempted": True,
                "atomic_operations": True,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error in treasury status: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Erreur lors de la récupération du statut" if not settings.DEBUG else str(e)
        )
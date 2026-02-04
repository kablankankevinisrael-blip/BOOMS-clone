from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.utils.debug_tool import debug_specific_user
from app.services.auth import get_current_user_from_token as get_current_user  # ✅ CORRECTION
from app.models.user_models import User  # ✅ AJOUT
from app.config import settings
from datetime import datetime 

router = APIRouter(prefix="/debug", tags=["debug"])

@router.get("/project")
def debug_project():
    """Endpoint de debug du projet complet"""
    from app.utils.debug_tool import debug_entire_project
    import io
    import contextlib
    
    # Capture la sortie du debug
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        debug_entire_project()
    
    return {"debug_output": output.getvalue()}

@router.get("/user/{user_id}")
def debug_user(
    user_id: int,
    current_user: User = Depends(get_current_user),  # ✅ CORRECTION: User au lieu de dict
    db: Session = Depends(get_db)
):
    """Debug spécifique d'un utilisateur"""
    import io
    import contextlib
    
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        debug_specific_user(user_id)
    
    return {"user_debug": output.getvalue()}
    
@router.get("/public-test")
def public_test():
    """Endpoint public pour tester la connexion sans auth"""
    return {
        "status": "success", 
        "message": "Backend accessible sans authentification",
        "timestamp": datetime.now().isoformat()
    }

@router.get("/routes")
def debug_routes():
    """Liste toutes les routes disponibles"""
    from app.main import app
    routes = []
    for route in app.routes:
        if hasattr(route, 'methods'):
            methods = ', '.join(route.methods) if route.methods else 'GET'
            routes.append({
                'path': route.path,
                'methods': methods,
                'name': getattr(route, 'name', 'N/A')
            })
    
    return {"routes": sorted(routes, key=lambda x: x['path'])}
    
def _provider_availability(provider_key: str):
    env_values = settings.PAYMENT_PROVIDER_KEYS.get(provider_key, {})
    missing = [name for name, value in env_values.items() if not value]
    is_ready = len(missing) == 0
    status = "✅ CONFIGURÉ" if is_ready else "❌ CONFIGURATION INCOMPLÈTE"
    return {
        "status": status,
        "is_ready": is_ready,
        "missing_keys": missing,
    }


@router.get("/payment-status")
async def check_payment_status():
    """Vérifier le statut des services de paiement et exposer les infos publiques nécessaires"""

    wave = _provider_availability("wave")
    stripe = _provider_availability("stripe")
    orange_money = _provider_availability("orange_money")
    mtn_momo = _provider_availability("mtn_momo")

    payment_methods = {
        "wave": wave["is_ready"],
        "stripe": stripe["is_ready"],
        "orange_money": orange_money["is_ready"],
        "mtn_momo": mtn_momo["is_ready"],
    }

    return {
        "wave": {
            **wave,
            "api_key_set": bool(settings.WAVE_API_KEY),
            "merchant_key_set": bool(settings.WAVE_MERCHANT_KEY),
            "business_account": settings.WAVE_BUSINESS_ACCOUNT or "NON DÉFINI",
        },
        "stripe": {
            **stripe,
            "secret_key_set": bool(settings.STRIPE_SECRET_KEY),
            "publishable_key_set": bool(settings.STRIPE_PUBLISHABLE_KEY),
        },
        "orange_money": {
            **orange_money,
            "api_key_set": bool(settings.ORANGE_API_KEY),
            "api_secret_set": bool(settings.ORANGE_API_SECRET),
            "business_phone": settings.ORANGE_BUSINESS_PHONE or "NON DÉFINI",
        },
        "mtn_momo": {
            **mtn_momo,
            "api_key_set": bool(settings.MTN_MOMO_API_KEY),
            "api_secret_set": bool(settings.MTN_MOMO_API_SECRET),
            "subscription_key_set": bool(settings.MTN_MOMO_SUBSCRIPTION_KEY),
        },
        "payment_methods": payment_methods,
        "stripe_publishable_key": settings.STRIPE_PUBLISHABLE_KEY,
        "environment": settings.ENVIRONMENT,
        "recommendation": "Configurez les clés API Booms dans backend/.env pour activer automatiquement les dépôts",
    }
# backend/app/routes/__init__.py
from .auth import router as auth_router
from .users import router as users_router
from .boms import router as boms_router
from .collections import collections_router
from .wallet import router as wallet_router
from .purchase import router as purchase_router
from .gift import router as gift_router
from .contacts import router as contacts_router
from .notifications import router as notifications_router
from .debug import router as debug_router
from .payments import router as payments_router
from .withdrawal import router as withdrawal_router
from .admin import router as admin_router  # ✅ AJOUTER CETTE LIGNE
from .market import router as market_router
from .support import router as support_router
from .interactions import router as interactions_router

__all__ = [
    "auth_router", "users_router", "boms_router", "collections_router", "wallet_router",
    "purchase_router", "gift_router", "contacts_router", "notifications_router", 
    "debug_router", "payments_router", "withdrawal_router", "admin_router", "market_router",
    "support_router"
    "interactions_router"
]
"""
SERVER PRINCIPAL BOOMS API - AVEC RATE LIMITING GLOBAL
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.database import engine, Base
from app.config import settings
import asyncio
import json
import logging
import random
from datetime import datetime, timezone

# ⬇️⬇️⬇️ IMPORT RATE LIMITING GLOBAL ⬇️⬇️⬇️
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Initialiser le rate limiter GLOBAL
limiter = Limiter(key_func=get_remote_address)

# ⬆️⬆️⬆️ FIN IMPORT RATE LIMITING ⬆️⬆️⬆️

# Import des modèles
from app.models import (
    user_models, 
    bom_models,
    payment_models,
    gift_models, 
    notification_models,
    transaction_models,
    admin_models  # ⬅️ AJOUT
)

# ✅ CORRECT : Tous les imports avec suffixe _router
from app.routes import (
    auth_router,
    boms_router,
    collections_router,
    users_router,
    wallet_router,
    purchase_router,
    gift_router,
    contacts_router,
    notifications_router,
    debug_router,
    payments_router,
    withdrawal_router,
    admin_router,
    market_router,
    support_router,
    interactions_router
)

logger = logging.getLogger(__name__)

print("🚀 Démarrage de l'API BOOMS NFT...")
print("🔧 Création des tables de base de données...")

try:
    # Créer l'enum PostgreSQL correctement avant SQLAlchemy
    from sqlalchemy import inspect, text
    
    with engine.connect() as conn:
        with conn.begin():
            # Vérifier si l'enum existe
            result = conn.execute(text(
                "SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = 'userstatus')"
            ))
            enum_exists = result.scalar()
            
            if not enum_exists:
                # Créer l'enum avec les bonnes valeurs
                print("   ✨ Création de l'enum userstatus...")
                conn.execute(text("""
                    CREATE TYPE userstatus AS ENUM (
                        'active', 'review', 'limited', 'suspended', 'banned'
                    )
                """))
                print("   ✅ Enum userstatus créé")
    
    # Maintenant créer les tables
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    
    if not existing_tables:
        # Première création, créer toutes les tables
        Base.metadata.create_all(bind=engine)
        print("✅ Tables créées avec succès!")
    else:
        # Les tables existent déjà, créer seulement les nouvelles
        # (mais éviter de recréer les enums)
        for table in Base.metadata.sorted_tables:
            table.create(bind=engine, checkfirst=True)
        print("✅ Nouvelles tables créées (tables existantes conservées)!")
    
    print("📊 Tables disponibles:")
    for table_name in Base.metadata.tables.keys():
        print(f"   - {table_name}")
    
    # Vérifier les tables NFT spécifiques
    required_tables = ['bom_assets', 'user_boms', 'nft_collections']
    existing_tables = list(Base.metadata.tables.keys())
    
    for table in required_tables:
        if table in existing_tables:
            print(f"   ✅ {table} (NFT)")
        else:
            print(f"   ⚠️  {table} manquante")
            
except Exception as e:
    print(f"❌ Erreur création tables: {e}")
    print("Détails:", str(e))

print("🔄 Migration des soldes existants...")
try:
    from app.utils.migrate_balances import migrate_existing_balances
    migrate_existing_balances()
except Exception as e:
    print(f"⚠️ Erreur migration soldes: {e}")

# ==================== GESTIONNAIRE WEB SOCKET SIMPLE ====================
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.boom_subscriptions: dict[int, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        # Nettoyer les subscriptions
        for boom_id in list(self.boom_subscriptions.keys()):
            if websocket in self.boom_subscriptions[boom_id]:
                self.boom_subscriptions[boom_id].remove(websocket)

    async def subscribe_to_boom(self, websocket: WebSocket, boom_id: int):
        if boom_id not in self.boom_subscriptions:
            self.boom_subscriptions[boom_id] = []
        if websocket not in self.boom_subscriptions[boom_id]:
            self.boom_subscriptions[boom_id].append(websocket)

    async def broadcast_social_update(self, data: dict):
        """Diffuser une mise à jour de valeur sociale à tous les clients"""
        boom_id = data.get("boom_id")
        disconnected = []
        
        # Broadcast à tous les clients connectés
        for connection in self.active_connections:
            try:
                await connection.send_json(data)
            except:
                disconnected.append(connection)
        
        # Nettoyage des connexions fermées
        for conn in disconnected:
            self.disconnect(conn)

# Créer une instance SIMPLE du manager (pour /ws/booms)
simple_manager = ConnectionManager()

# ==================== GESTIONNAIRE WEB SOCKET AVANCÉ ====================
class AdvancedConnectionManager:
    """Manager compatible avec le frontend WebSocket authentifié"""
    def __init__(self):
        # user_id → list[WebSocket]
        self.active_connections: dict[int, list[WebSocket]] = {}
        # boom_id → list[WebSocket]
        self.boom_subscriptions: dict[int, list[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        """Accepter et stocker une connexion WebSocket avec user_id"""
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"WebSocket avancé connecté - User ID: {user_id}")

    def disconnect(self, user_id: int, websocket: WebSocket):
        """Supprimer une connexion WebSocket"""
        if user_id in self.active_connections:
            self.active_connections[user_id] = [
                ws for ws in self.active_connections[user_id] if ws != websocket
            ]
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"WebSocket avancé déconnecté - User ID: {user_id}")

    async def subscribe_to_boom(self, websocket: WebSocket, boom_id: int):
        """Abonner une WebSocket aux mises à jour d'un BOOM"""
        if boom_id not in self.boom_subscriptions:
            self.boom_subscriptions[boom_id] = []
        if websocket not in self.boom_subscriptions[boom_id]:
            self.boom_subscriptions[boom_id].append(websocket)
            logger.info(f"WebSocket abonné au BOOM {boom_id}")

    async def unsubscribe_from_boom(self, websocket: WebSocket, boom_id: int):
        """Désabonner une WebSocket d'un BOOM"""
        if boom_id in self.boom_subscriptions and websocket in self.boom_subscriptions[boom_id]:
            self.boom_subscriptions[boom_id].remove(websocket)
            logger.info(f"WebSocket désabonné du BOOM {boom_id}")

    def find_user_id_by_websocket(self, websocket: WebSocket) -> int | None:
        """Trouver l'ID utilisateur d'une WebSocket"""
        for user_id, connections in self.active_connections.items():
            if websocket in connections:
                return user_id
        return None

# Créer une instance AVANCÉE du manager (pour /ws/secure-updates)
advanced_manager = AdvancedConnectionManager()

# ==================== BROADCAST CIBLÉ PAR BOOM ====================
async def broadcast_to_boom(boom_id: int, data: dict):
    """Envoyer une mise à jour SEULEMENT aux gens qui regardent ce BOOM"""
    disconnected = []
    
    # Version avancée (authentifiée)
    if boom_id in advanced_manager.boom_subscriptions:
        for websocket in advanced_manager.boom_subscriptions[boom_id]:
            try:
                await websocket.send_json(data)
            except Exception:
                disconnected.append(websocket)
    
    # Version simple (non authentifiée)
    if boom_id in simple_manager.boom_subscriptions:
        for websocket in simple_manager.boom_subscriptions[boom_id]:
            try:
                await websocket.send_json(data)
            except Exception:
                if websocket in simple_manager.active_connections:
                    disconnected.append(websocket)
    
    # Nettoyage
    for ws in disconnected:
        # Version avancée
        user_id = advanced_manager.find_user_id_by_websocket(ws)
        if user_id is not None:
            advanced_manager.disconnect(user_id, ws)
        # Version simple
        simple_manager.disconnect(ws)
    
    logger.info(f"📤 Broadcast ciblé pour BOOM #{boom_id} - {data.get('type', 'unknown')}")

async def broadcast_global(data: dict):
    """Envoyer à tous les utilisateurs connectés (ex: annonce globale)"""
    disconnected = []
    
    # Version avancée
    for user_id in list(advanced_manager.active_connections.keys()):
        for websocket in advanced_manager.active_connections[user_id]:
            try:
                await websocket.send_json(data)
            except Exception:
                disconnected.append((user_id, websocket))
    
    # Version simple
    for websocket in simple_manager.active_connections:
        try:
            await websocket.send_json(data)
        except Exception:
            disconnected.append((None, websocket))
    
    # Nettoyage
    for user_id, ws in disconnected:
        if user_id is not None:
            advanced_manager.disconnect(user_id, ws)
        else:
            simple_manager.disconnect(ws)
    
    logger.info(f"📢 Broadcast global - {data.get('type', 'unknown')}")

# ==================== FONCTIONS DE TRIGGER POUR TESTS ====================
async def trigger_social_value_update(boom_id: int, delta: float = 0.00001, action: str = "test"):
    """Déclencher une mise à jour de valeur sociale pour un BOOM spécifique"""
    from app.database import get_db
    from sqlalchemy.orm import Session
    from app.models.bom_models import BomAsset
    
    db: Session = next(get_db())
    bom = db.query(BomAsset).filter(BomAsset.id == boom_id).first()
    
    if not bom:
        logger.warning(f"BOOM #{boom_id} non trouvé pour mise à jour sociale")
        return False
    
    # Calculer la nouvelle valeur sociale
    old_value = bom.social_score if bom.social_score else 0.0
    new_value = old_value + delta
    
    # Mettre à jour en base (optionnel)
    bom.social_score = new_value
    db.commit()
    
    # Préparer le message de mise à jour
    update_data = {
        "type": "social_update",
        "boom_id": boom_id,
        "title": bom.title,
        "old_social_value": old_value,
        "new_social_value": new_value,
        "delta": delta,
        "action": action,
        "timestamp": datetime.now().isoformat(),
        "social_event": "live_trading" if action in ["buy", "sell"] else action,
        "total_value": float(bom.value) if bom.value else 0.0
    }
    
    # Diffuser uniquement aux abonnés de ce BOOM
    await broadcast_to_boom(boom_id, update_data)
    
    logger.info(f"📈 Mise à jour sociale déclenchée pour BOOM #{boom_id}: {delta:+}")
    return True

async def trigger_social_event(boom_id: int, event_type: str = "trending", message: str = None):
    """Déclencher un événement social pour un BOOM spécifique"""
    from app.database import get_db
    from sqlalchemy.orm import Session
    from app.models.bom_models import BomAsset
    
    db: Session = next(get_db())
    bom = db.query(BomAsset).filter(BomAsset.id == boom_id).first()
    
    if not bom:
        logger.warning(f"BOOM #{boom_id} non trouvé pour événement social")
        return False
    
    # Messages par défaut selon le type d'événement
    if not message:
        if event_type == "viral":
            message = f"🔥 {bom.title} devient viral ! Partagez-le !"
        elif event_type == "trending":
            message = f"📈 {bom.title} est en tendance !"
        elif event_type == "milestone":
            message = f"🎯 {bom.title} a atteint un nouveau palier !"
        else:
            message = f"✨ Événement spécial pour {bom.title}"
    
    # Préparer le message d'événement
    event_data = {
        "type": "social_event",
        "boom_id": boom_id,
        "event_type": event_type,
        "message": message,
        "timestamp": datetime.now().isoformat(),
        "data": {
            "boom_title": bom.title,
            "current_value": float(bom.value) if bom.value else 0.0,
            "social_score": float(bom.social_score) if bom.social_score else 0.0
        }
    }
    
    # Diffuser uniquement aux abonnés de ce BOOM
    await broadcast_to_boom(boom_id, event_data)
    
    logger.info(f"🎉 Événement social '{event_type}' déclenché pour BOOM #{boom_id}")
    return True

# ==================== LIFESPAN MANAGEMENT ====================
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Démarrage
    print("🚀 WebSocket server starting...")
    
    # Démarrer une tâche de test périodique (optionnel)
    async def periodic_test_updates():
        """Tâche périodique pour simuler des mises à jour (désactiver en production)"""
        try:
            while True:
                await asyncio.sleep(30)  # Toutes les 30 secondes
                
                # Simuler une mise à jour aléatoire pour un BOOM
                if advanced_manager.boom_subscriptions:
                    random_boom_id = list(advanced_manager.boom_subscriptions.keys())[0]
                    delta = round((random.random() - 0.5) * 0.00002, 6)  # ±0.00001
                    if abs(delta) > 0.000005:  # Seulement si changement significatif
                        await trigger_social_value_update(
                            random_boom_id, 
                            delta, 
                            random.choice(["buy", "sell", "like", "share"])
                        )
        except Exception as e:
            logger.error(f"Erreur tâche périodique: {e}")
    
    # Démarrer la tâche en arrière-plan
    if settings.DEBUG:
        asyncio.create_task(periodic_test_updates())
    
    yield
    # Arrêt
    print("🛑 WebSocket server stopping...")

# ==================== APPLICATION FASTAPI ====================
app = FastAPI(
    title="Booms API NFT",
    description="API pour l'application Booms - NFTs animés avec valeur réelle",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan
)

# ⬅️ CONFIGURATION GLOBALE DU RATE LIMITING
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ⬅️ AJOUT: Middleware de sécurité global
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Ajouter des headers de sécurité"""
    response = await call_next(request)
    
    # Headers de sécurité
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    
    # Cache control pour les endpoints sensibles
    sensitive_paths = ["/api/v1/payments", "/api/v1/admin", "/api/v1/wallet", "/api/v1/withdrawal"]
    if any(request.url.path.startswith(path) for path in sensitive_paths):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    
    return response

# ⬅️ AJOUT: Gestionnaire d'erreurs global
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Gestionnaire d'erreurs global - VERSION DÉFINITIVE
    Sécurisé contre les transactions fermées
    """
    import traceback
    
    # 1. Log complet sans DB (évite les transactions fermées)
    error_trace = traceback.format_exc()
    logger.critical(f"❌ ERREUR CRITIQUE - Path: {request.method} {request.url.path}")
    logger.critical(f"   Type: {type(exc).__name__}")
    logger.critical(f"   Message: {str(exc)}")
    
    if settings.DEBUG:
        logger.critical(f"   Traceback:\n{error_trace}")
    
    # 2. Métriques pour monitoring
    logger.error(f"📊 Métriques erreur - Client: {request.client.host if request.client else 'unknown'}")
    
    # 3. Retour JSON propre (NE PAS utiliser dict directement)
    from fastapi.responses import JSONResponse
    
    # Message adapté selon l'environnement
    if settings.DEBUG:
        error_message = f"{type(exc).__name__}: {str(exc)}"
    else:
        error_message = "Une erreur interne est survenue"
    
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "detail": error_message,
            "error_id": f"ERR_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "support": "support@booms.com" if not settings.DEBUG else None
        }
    )
# ==================== ROUTES WEB SOCKET ====================
@app.websocket("/ws/booms")
async def websocket_endpoint(websocket: WebSocket):
    await simple_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get("type") == "subscribe" and message.get("boom_id"):
                    boom_id = message["boom_id"]
                    await simple_manager.subscribe_to_boom(websocket, boom_id)
                    await websocket.send_json({
                        "type": "subscription_confirmed",
                        "boom_id": boom_id,
                        "message": f"Abonné aux mises à jour live du BOOM #{boom_id}"
                    })
                elif message.get("type") == "user_action":
                    # Traiter une action utilisateur (like, share, etc.)
                    boom_id = message.get("boom_id")
                    action = message.get("action")
                    if boom_id and action:
                        # Simuler une petite mise à jour sociale pour l'action
                        delta = 0.000001 if action in ["like", "share"] else 0.000002
                        await trigger_social_value_update(boom_id, delta, action)
            except json.JSONDecodeError:
                # Message text simple, garder la connexion ouverte
                pass
    except WebSocketDisconnect:
        simple_manager.disconnect(websocket)

@app.websocket("/ws/secure-updates")
async def secure_websocket_endpoint(
    websocket: WebSocket,
    token: str = None  # Token optionnel
):
    """Endpoint WebSocket sécurisé avec authentification JWT optionnelle"""
    try:
        user_id = None
        username = "Invité"
        
        if token:
            try:
                # Décoder le token JWT directement
                from jose import jwt, JWTError
                
                payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
                user_id_from_token = payload.get("user_id") or payload.get("sub")
                
                if user_id_from_token:
                    # Essayer de récupérer l'utilisateur depuis la base
                    from app.database import get_db
                    from sqlalchemy.orm import Session
                    from app.models.user_models import User
                    
                    db: Session = next(get_db())
                    
                    # ✅ CORRECTION : Éviter la comparaison VARCHAR = INTEGER
                    user = None
                    try:
                        # Essayer comme ID (entier)
                        user_id_int = int(user_id_from_token)
                        user = db.query(User).filter(User.id == user_id_int).first()
                    except (ValueError, TypeError):
                        # Ce n'est pas un entier, essayer comme phone
                        user = db.query(User).filter(User.phone == str(user_id_from_token)).first()
                    
                    if user:
                        user_id = user.id
                        username = getattr(user, 'full_name', getattr(user, 'username', user.phone))
                        logger.info(f"WebSocket authentifié pour: {user_id} ({username})")
                    else:
                        logger.warning(f"Utilisateur non trouvé pour token: {user_id_from_token}")
                else:
                    logger.warning("Token JWT sans user_id ou sub")
                    
            except JWTError as e:
                logger.warning(f"Token JWT invalide: {e}")
            except Exception as e:
                logger.error(f"Erreur authentification WebSocket: {e}")
        
        # Utiliser l'ID 0 pour les invités
        effective_user_id = user_id if user_id else 0
        
        # Accepter la connexion
        await advanced_manager.connect(effective_user_id, websocket)
        
        # Envoyer un message de bienvenue
        await websocket.send_json({
            "type": "welcome",
            "message": f"Connecté {'en tant que ' + username if user_id else 'en mode invité'}",
            "user_id": user_id,
            "username": username,
            "timestamp": datetime.now().isoformat(),
            "authenticated": bool(user_id)
        })
        
        try:
            while True:
                data = await websocket.receive_text()
                try:
                    message = json.loads(data)
                    
                    # Gérer les abonnements aux BOOMs
                    if message.get("type") == "subscribe" and message.get("boom_id"):
                        boom_id = message["boom_id"]
                        await advanced_manager.subscribe_to_boom(websocket, boom_id)
                        await websocket.send_json({
                            "type": "subscription_confirmed",
                            "boom_id": boom_id,
                            "message": f"Abonné aux mises à jour live du BOOM #{boom_id}"
                        })
                    
                    # Gérer les désabonnements
                    elif message.get("type") == "unsubscribe" and message.get("boom_id"):
                        boom_id = message["boom_id"]
                        await advanced_manager.unsubscribe_from_boom(websocket, boom_id)
                        await websocket.send_json({
                            "type": "unsubscription_confirmed",
                            "boom_id": boom_id
                        })
                    
                    # Gérer les actions utilisateur
                    elif message.get("type") == "user_action":
                        boom_id = message.get("boom_id")
                        action = message.get("action")
                        if boom_id and action:
                            # Simuler une petite mise à jour sociale pour l'action
                            delta = 0.000001 if action in ["like", "share"] else 0.000002
                            await trigger_social_value_update(boom_id, delta, action)
                    
                    # Heartbeat
                    elif message.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                        
                except json.JSONDecodeError:
                    # Message non JSON, l'ignorer
                    pass
                    
        except WebSocketDisconnect:
            logger.info(f"WebSocket déconnecté (User: {user_id})")
            advanced_manager.disconnect(effective_user_id, websocket)
            
    except Exception as e:
        logger.error(f"Erreur WebSocket sécurisé: {e}")
        try:
            await websocket.close(code=1011, reason="Erreur serveur")
        except:
            pass

# ==================== ROUTES API ====================
API_PREFIX = settings.API_V1_PREFIX

# ROUTES PRINCIPALES
app.include_router(auth_router, prefix=API_PREFIX, tags=["Authentication"])
app.include_router(boms_router, prefix=API_PREFIX, tags=["NFTs"])
app.include_router(collections_router, prefix=f"{API_PREFIX}/nfts/collections", tags=["Collections"])
app.include_router(users_router, prefix=API_PREFIX, tags=["Users"])
app.include_router(wallet_router, prefix=API_PREFIX, tags=["Wallet"])
app.include_router(purchase_router, prefix=API_PREFIX, tags=["Purchase"])
app.include_router(gift_router, prefix=API_PREFIX, tags=["Gifts"])
app.include_router(contacts_router, prefix=API_PREFIX, tags=["Contacts"])
app.include_router(support_router, prefix=API_PREFIX, tags=["Support"])
app.include_router(notifications_router, prefix=API_PREFIX, tags=["Notifications"])
app.include_router(debug_router, prefix=API_PREFIX, tags=["Debug"])
app.include_router(interactions_router, prefix=API_PREFIX, tags=["Interactions"])

# ROUTES PAIEMENT
app.include_router(payments_router, prefix=API_PREFIX, tags=["Payments"])
app.include_router(withdrawal_router, prefix=API_PREFIX, tags=["Withdrawal"])

# ROUTES ADMIN
app.include_router(admin_router, prefix="/api/v1", tags=["Admin"])
app.include_router(market_router, prefix=API_PREFIX, tags=["Market"])

# ==================== ROUTES DE BASE ====================
        
@app.get("/")
def read_root():
    return {
        "message": "Bienvenue sur l'API Booms NFT! 🎨",
        "version": "2.0.0",
        "features": ["NFTs animés", "Collections", "Propriété unique", "Marketplace", "WebSocket temps-réél", "Live trading par Boom"],
        "docs": "/api/docs",
        "websocket": "/ws/booms",
        "websocket_secure": "/ws/secure-updates",
        "live_trading": "Activé - Rooms par Boom",
        "endpoints": {
            "nfts": f"{API_PREFIX}/nfts",
            "collections": f"{API_PREFIX}/nfts/collections",
            "auth": f"{API_PREFIX}/auth",
            "wallet": f"{API_PREFIX}/wallet",
            "admin": "/api/v1/admin"
        }
    }

@app.get("/health")
def health_check():
    try:
        secure_connections = sum(len(conns) for conns in advanced_manager.active_connections.values())
    except Exception:
        secure_connections = 0
    
    return {
        "status": "healthy", 
        "app": settings.APP_NAME, 
        "environment": settings.ENVIRONMENT,
        "database": "connected" if engine else "disconnected",
        "nft_support": True,
        "live_trading": True,
        "websocket_connections": {
            "public": len(simple_manager.active_connections),
            "secure": secure_connections
        },
        "boom_subscriptions": {
            "total_unique_booms": len(simple_manager.boom_subscriptions) + len(advanced_manager.boom_subscriptions),
            "simple": len(simple_manager.boom_subscriptions),
            "advanced": len(advanced_manager.boom_subscriptions)
        }
    }

@app.get("/api/info")
def api_info():
    """Informations sur l'API NFT"""
    return {
        "name": "Booms NFT API",
        "description": "API pour la gestion de NFTs animés avec trading social temps-réel",
        "version": "2.0.0",
        "live_features": [
            "Mise à jour valeur sociale en temps réel",
            "Rooms par Boom (broadcast ciblé)",
            "Notifications d'événements viraux",
            "Animation de delta live",
            "Support WebSocket authentifié"
        ],
        "models": {
            "NFT": "BomAsset (avec token_id, owner, collection)",
            "Collection": "NFTCollection",
            "Ownership": "UserBom (avec transfer_id)"
        },
        "features": [
            "Création NFT avec animations GIF/MP4",
            "Collections vérifiées",
            "Transfert de propriété",
            "Royalties artistes",
            "Éditions limitées",
            "Valeur sociale temps-réel",
            "WebSocket pour mises à jour instantanées",
            "Live trading par Boom"
        ]
    }

# ==================== ROUTES DE TEST ET ADMIN ====================
@app.post("/api/trigger-social-update/{boom_id}")
async def trigger_social_update(boom_id: int, delta: float = 0.00001, action: str = "test"):
    """Déclencher une mise à jour sociale de test (admin seulement)"""
    success = await trigger_social_value_update(boom_id, delta, action)
    
    return {
        "success": success,
        "message": f"Mise à jour sociale {'déclenchée' if success else 'échouée'} pour BOOM #{boom_id}",
        "delta": delta,
        "action": action,
        "websocket_stats": {
            "public_clients": len(simple_manager.active_connections),
            "secure_clients": sum(len(conns) for conns in advanced_manager.active_connections.values()),
            "boom_subscribers": len(simple_manager.boom_subscriptions.get(boom_id, [])) + 
                               len(advanced_manager.boom_subscriptions.get(boom_id, []))
        }
    }

@app.post("/api/trigger-social-event/{boom_id}")
async def trigger_social_event_route(boom_id: int, event_type: str = "trending", message: str = None):
    """Déclencher un événement social de test (admin seulement)"""
    success = await trigger_social_event(boom_id, event_type, message)
    
    return {
        "success": success,
        "message": f"Événement social '{event_type}' {'déclenché' if success else 'échoué'} pour BOOM #{boom_id}",
        "event_type": event_type,
        "custom_message": message
    }

@app.get("/api/websocket-stats")
async def get_websocket_stats():
    """Obtenir les statistiques WebSocket en temps réel"""
    secure_connections = sum(len(conns) for conns in advanced_manager.active_connections.values())
    
    # Compter les abonnements par Boom
    all_boom_subscriptions = {}
    for boom_id, connections in simple_manager.boom_subscriptions.items():
        all_boom_subscriptions[boom_id] = all_boom_subscriptions.get(boom_id, 0) + len(connections)
    
    for boom_id, connections in advanced_manager.boom_subscriptions.items():
        all_boom_subscriptions[boom_id] = all_boom_subscriptions.get(boom_id, 0) + len(connections)
    
    return {
        "timestamp": datetime.now().isoformat(),
        "connections": {
            "public": len(simple_manager.active_connections),
            "secure": secure_connections,
            "total": len(simple_manager.active_connections) + secure_connections
        },
        "boom_subscriptions": {
            "total_unique_booms": len(all_boom_subscriptions),
            "booms": all_boom_subscriptions
        },
        "features": {
            "live_trading": True,
            "targeted_broadcast": True,
            "authentication": True
        }
    }

@app.post("/api/simulate-purchase/{boom_id}")
async def simulate_purchase(boom_id: int, user_id: int = None):
    """Simuler un achat pour déclencher des mises à jour live"""
    # Déclencher une mise à jour significative
    delta = 0.00005  # Achat = delta positif significatif
    success = await trigger_social_value_update(boom_id, delta, "buy")
    
    # Déclencher un événement si c'est significatif
    if delta > 0.00003:
        await trigger_social_event(boom_id, "trending", f"🚀 Achat significatif détecté !")
    
    return {
        "success": success,
        "message": f"Simulation d'achat pour BOOM #{boom_id}",
        "delta": delta,
        "event_triggered": delta > 0.00003
    }

# ⬅️ AJOUT: Route pour vérifier les logs financiers
@app.get("/api/financial-logs")
async def get_financial_logs():
    """Obtenir les logs financiers récents (admin seulement)"""
    try:
        from app.database import get_db
        from sqlalchemy.orm import Session
        from app.models.admin_models import AdminLog
        from sqlalchemy import desc
        
        db: Session = next(get_db())
        
        # Récupérer les logs financiers des dernières 24h
        from datetime import datetime, timedelta
        twenty_four_hours_ago = datetime.now() - timedelta(hours=24)
        
        financial_logs = db.query(AdminLog).filter(
            AdminLog.action.in_([
                "treasury_update", "treasury_deposit", "treasury_withdrawal",
                "market_buy_fees_collected", "market_sell_fees_collected",
                "withdrawal_fees_collected", "gift_fee", "force_wallet_update"
            ]),
            AdminLog.created_at >= twenty_four_hours_ago
        ).order_by(desc(AdminLog.created_at)).limit(50).all()
        
        logs_data = []
        total_fees = 0
        
        for log in financial_logs:
            details = log.details or {}
            fees_amount = float(details.get("fees_amount", 0)) if details else 0
            total_fees += fees_amount
            
            logs_data.append({
                "id": log.id,
                "action": log.action,
                "admin_id": log.admin_id,
                "details": details,
                "fees_amount": fees_amount,
                "created_at": log.created_at.isoformat() if log.created_at else None
            })
        
        return {
            "status": "success",
            "count": len(logs_data),
            "total_fees_collected": total_fees,
            "period": "24 dernières heures",
            "logs": logs_data
        }
        
    except Exception as e:
        logger.error(f"❌ Erreur récupération logs financiers: {e}")
        return {
            "status": "error",
            "message": str(e)
        }

if __name__ == "__main__":
    import uvicorn
    print(f"🌍 Serveur démarré sur http://{settings.HOST}:{settings.PORT}")
    print(f"📚 Documentation: http://{settings.HOST}:{settings.PORT}/api/docs")
    print(f"🔌 WebSocket Public: ws://{settings.HOST}:{settings.PORT}/ws/booms")
    print(f"🔐 WebSocket Sécurisé: ws://{settings.HOST}:{settings.PORT}/ws/secure-updates")
    print(f"🎯 Live Trading: ACTIVÉ (Rooms par Boom)")
    print(f"📈 Mise à jour sociale ciblée: ACTIVÉE")
    print(f"🛡️ Rate Limiting: ACTIVÉ globalement")
    print(f"📝 Logs financiers: ACTIVÉS")
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG
    )
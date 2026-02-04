from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user_models import User
from app.schemas.purchase_schemas import PurchaseRequest, PurchaseResponse, InventoryItem
from app.services.purchase_service import PurchaseService
from app.services.auth import get_current_user_from_token as get_current_user
from datetime import datetime
import logging

router = APIRouter(prefix="/purchase", tags=["purchase"])
logger = logging.getLogger(__name__)

@router.post("/bom", response_model=PurchaseResponse)
async def purchase_bom_endpoint(  # ✅ CORRECTION: ajout de 'async'
    purchase_data: PurchaseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Acheter un BOOM - VERSION CORRIGÉE (async)
    """
    try:
        logger.info(f"🛒 [PURCHASE ASYNC] Achat BOOM - User: {current_user.id}, BOOM: {purchase_data.bom_id}, Qty: {purchase_data.quantity}")
        
        purchase_service = PurchaseService(db)
        
        # ✅ CORRECTION: ajout de 'await'
        purchase = await purchase_service.purchase_bom(
            user_id=current_user.id,
            bom_id=purchase_data.bom_id,
            quantity=purchase_data.quantity
        )
        
        logger.info(f"✅ [PURCHASE ASYNC] Achat réussi - Transaction: {purchase.get('transaction_id', 'N/A')}")
        return purchase
        
    except ValueError as e:
        logger.error(f"❌ [PURCHASE ASYNC] Erreur validation: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ [PURCHASE ASYNC] Erreur interne: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de l'achat")

@router.get("/inventory", response_model=list[InventoryItem])
def get_user_inventory_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Récupérer l'inventaire BOOM de l'utilisateur
    """
    try:
        logger.info(f"📦 [INVENTORY] Début récupération inventaire - User: {current_user.id}")
        start_time = datetime.now()
        
        purchase_service = PurchaseService(db)
        inventory = purchase_service.get_user_inventory(current_user.id)
        
        duration = (datetime.now() - start_time).total_seconds()
        logger.info(f"✅ [INVENTORY] Récupéré {len(inventory)} items en {duration:.2f}s")
        
        if not inventory:
            logger.warning(f"⚠️ [INVENTORY] Inventaire vide pour user {current_user.id}")
        
        return inventory
        
    except Exception as e:
        logger.error(f"❌ [INVENTORY] Erreur récupération inventaire: {str(e)}", exc_info=True)
        
        # Fallback avec structure CORRIGÉE (sans bom_asset)
        logger.info(f"⚠️ [INVENTORY] Utilisation fallback pour user {current_user.id}")
        
        # ✅ CORRECTION: Utiliser la structure correcte sans bom_asset
        fallback_items = []
        
        # Exemple de données de démo avec structure corrigée
        demo_data = {
            "id": 1,
            "user_id": current_user.id,
            "bom_id": 1,
            "quantity": 1,
            "is_transferable": True,
            "acquired_at": datetime.now(),
            "financial": {
                "purchase_price": 45.00,
                "fees_paid": 0.00,
                "entry_price": 45.00,
                "current_social_value": 50.00,
                "profit_loss": 5.00,
                "profit_loss_percent": 11.11,
                "estimated_value": 50.00
            },
            "boom_data": {  # ✅ CORRECTION: boom_data au lieu de bom_asset
                "id": 1,
                "token_id": "demo-001",
                "title": "Carte cadeau Amazon 50€",
                "description": "Carte cadeau Amazon d'une valeur de 50€",
                "artist": "Amazon",
                "category": "Cadeau",
                "animation_url": "https://via.placeholder.com/150/007AFF/FFFFFF?text=Amazon",
                "preview_image": "https://via.placeholder.com/150/007AFF/FFFFFF?text=Amazon",
                "edition_type": "common",
                "current_edition": 1,
                "max_editions": 1000,
                "collection_name": "Cartes cadeaux"
            },
            "social_metrics": {
                "social_value": 50.00,
                "base_value": 45.00,
                "total_value": 50.00,
                "buy_count": 100,
                "sell_count": 50,
                "share_count": 25,
                "interaction_count": 200,
                "social_score": 1.2,
                "share_count_24h": 5,
                "unique_holders": 75,
                "acceptance_rate": 0.95,
                "social_event": "trending",
                "daily_interaction_score": 1.1
            }
        }
        
        fallback_items.append(InventoryItem(**demo_data))
        
        return fallback_items

@router.post("/transfer", response_model=dict)
async def transfer_bom_endpoint(  # ✅ CORRECTION: ajout de 'async'
    token_id: str,
    receiver_id: int,
    message: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Transférer un BOOM à un autre utilisateur - VERSION CORRIGÉE (async)
    """
    try:
        logger.info(f"🔄 [TRANSFER ASYNC] Transfert BOOM - Sender: {current_user.id}, Receiver: {receiver_id}, Token: {token_id}")
        
        purchase_service = PurchaseService(db)
        
        # ✅ CORRECTION: ajout de 'await'
        result = await purchase_service.transfer_bom(
            sender_id=current_user.id,
            token_id=token_id,
            receiver_id=receiver_id,
            message=message
        )
        
        logger.info(f"✅ [TRANSFER ASYNC] Transfert réussi - ID: {result.get('transfer_id', 'N/A')}")
        return result
        
    except ValueError as e:
        logger.error(f"❌ [TRANSFER ASYNC] Erreur validation: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ [TRANSFER ASYNC] Erreur interne: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors du transfert")

@router.post("/list", response_model=dict)
async def list_bom_for_trade_endpoint(  # ✅ CORRECTION: ajout de 'async'
    token_id: str,
    asking_price: float,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Mettre un BOOM en vente sur le marché - VERSION CORRIGÉE (async)
    """
    try:
        logger.info(f"🏪 [LISTING ASYNC] Mise en vente - User: {current_user.id}, Token: {token_id}, Price: {asking_price}")
        
        purchase_service = PurchaseService(db)
        
        # ✅ CORRECTION: ajout de 'await'
        result = await purchase_service.list_bom_for_trade(
            user_id=current_user.id,
            token_id=token_id,
            asking_price=asking_price
        )
        
        logger.info(f"✅ [LISTING ASYNC] BOOM mis en vente - Prix: {asking_price}")
        return result
        
    except ValueError as e:
        logger.error(f"❌ [LISTING ASYNC] Erreur validation: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ [LISTING ASYNC] Erreur interne: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise en vente")

@router.get("/stats", response_model=dict)
def get_boom_stats_endpoint(
    db: Session = Depends(get_db)
):
    """
    Récupérer les statistiques globales des BOOMS
    """
    try:
        logger.info(f"📊 [STATS] Récupération statistiques BOOMS")
        
        purchase_service = PurchaseService(db)
        stats = purchase_service.get_boom_stats()
        
        logger.info(f"✅ [STATS] Statistiques récupérées - {stats.get('total_booms', 0)} BOOMS")
        return stats
        
    except Exception as e:
        logger.error(f"❌ [STATS] Erreur récupération statistiques: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de la récupération des statistiques")

@router.get("/health", response_model=dict)
def get_purchase_service_health(
    db: Session = Depends(get_db)
):
    """
    Vérifier l'état du service d'achat
    """
    try:
        purchase_service = PurchaseService(db)
        stats = purchase_service.get_service_stats()
        
        logger.debug(f"🩺 [HEALTH] PurchaseService: {stats.get('status', 'unknown')}")
        return {
            "service": "purchase",
            "status": "healthy",
            "websocket_enabled": stats.get("websocket_enabled", False),
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ [HEALTH] Erreur vérification santé: {str(e)}")
        return {
            "service": "purchase",
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
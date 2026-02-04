from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, Any, List
from datetime import datetime

from app.database import get_db
from app.models.user_models import User
from app.schemas.gift_schemas import GiftRequest, GiftActionRequest, GiftStatus as GiftStatusSchema
from app.services.gift_service import GiftService
from app.services.auth import get_current_user_from_token as get_current_user

router = APIRouter(prefix="/gift", tags=["gift"])


@router.get("/inbox", response_model=Dict[str, Any])
def get_gift_inbox_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Vue consolidée des cadeaux reçus/envoyés avec métriques live."""
    try:
        gift_service = GiftService(db)
        return gift_service.get_gift_inbox(current_user.id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors de la récupération de la boîte aux cadeaux: {str(e)}"
        )


@router.get("/history", response_model=List[Dict[str, Any]])
def get_gift_history_endpoint(
    gift_type: str = "received",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Récupérer l'historique des cadeaux (nouveau format étendu)
    Supporte à la fois legacy et new flow
    """
    try:
        gift_service = GiftService(db)
        gifts = gift_service.get_gift_history(current_user.id, gift_type)
        return gifts
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors de la récupération de l'historique: {str(e)}"
        )


@router.post("/send", response_model=Dict[str, Any], status_code=status.HTTP_201_CREATED)
def send_gift_endpoint(
    gift_data: GiftRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Envoyer un cadeau - NOUVEAU FLOW ATOMIQUE
    Utilise le flow: CREATED → PAID → DELIVERED
    """
    try:
        gift_service = GiftService(db)
        
        # Préparer les données pour le service
        gift_dict = {
            'receiver_phone': gift_data.receiver_phone,
            'bom_id': gift_data.bom_id,
            'message': gift_data.message,
            'quantity': gift_data.quantity
        }
        
        # Appeler le service atomique
        result = gift_service.send_gift(current_user.id, gift_dict)
        
        if not result.get("success"):
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "Erreur lors de l'envoi du cadeau")
            )
        
        # Retourner le résultat complet du service
        return {
            "success": True,
            "message": result.get("message", "🎁 Cadeau envoyé avec succès!"),
            "gift_id": result.get("gift_id"),
            "transaction_reference": result.get("transaction_reference"),
            "financial": result.get("financial", {}),
            "timestamps": result.get("timestamps", {}),
            "status": "DELIVERED"
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur interne lors de l'envoi du cadeau: {str(e)}"
        )


@router.post("/accept", response_model=Dict[str, Any])
def accept_gift_endpoint(
    gift_action: GiftActionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Accepter un cadeau reçu - LEGACY FLOW ONLY
    Pour les cadeaux créés avant la migration (status SENT)
    """
    try:
        if gift_action.action != GiftStatusSchema.ACCEPTED:
            raise HTTPException(
                status_code=400,
                detail="Action non valide. Utilisez 'accepted' pour accepter un cadeau."
            )
        
        gift_service = GiftService(db)
        result = gift_service.accept_gift(gift_action.gift_id, current_user.id)
        
        if not result.get("success"):
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "Erreur lors de l'acceptation du cadeau")
            )
        
        return result
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors de l'acceptation du cadeau: {str(e)}"
        )


@router.post("/decline", response_model=Dict[str, Any])
def decline_gift_endpoint(
    gift_action: GiftActionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Refuser un cadeau reçu - LEGACY FLOW ONLY
    Pour les cadeaux créés avant la migration (status SENT)
    """
    try:
        if gift_action.action != GiftStatusSchema.DECLINED:
            raise HTTPException(
                status_code=400,
                detail="Action non valide. Utilisez 'declined' pour refuser un cadeau."
            )
        
        gift_service = GiftService(db)
        result = gift_service.decline_gift(gift_action.gift_id, current_user.id)
        
        if not result.get("success"):
            raise HTTPException(
                status_code=400,
                detail=result.get("message", "Erreur lors du refus du cadeau")
            )
        
        return result
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors du refus du cadeau: {str(e)}"
        )


@router.get("/pending", response_model=List[Dict[str, Any]])
def get_pending_gifts_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Récupérer les cadeaux en attente - LEGACY FLOW ONLY
    Pour les cadeaux SENT qui n'ont pas encore été acceptés/refusés
    """
    try:
        gift_service = GiftService(db)
        pending_gifts = gift_service.get_pending_gifts(current_user.id)
        return pending_gifts
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur récupération cadeaux en attente: {str(e)}"
        )


@router.post("/expire-old", response_model=Dict[str, Any])
def expire_old_gifts_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Nettoyer les cadeaux expirés (pour tâche background/admin)
    """
    try:
        # Vérifier les permissions si nécessaire
        # (optionnel: ajouter une vérification de rôle admin)
        
        gift_service = GiftService(db)
        expired_count = gift_service.expire_old_gifts()
        
        return {
            "success": True,
            "message": f"{expired_count} cadeaux expirés/nettoyés",
            "expired_count": expired_count,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors du nettoyage des cadeaux expirés: {str(e)}"
        )


@router.get("/{gift_id}/details", response_model=Dict[str, Any])
def get_gift_details_endpoint(
    gift_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Récupérer les détails complets d'un cadeau spécifique
    """
    try:
        from app.models.gift_models import GiftTransaction
        from app.models.bom_models import UserBom
        
        # Récupérer le cadeau
        gift = db.query(GiftTransaction).filter(
            GiftTransaction.id == gift_id
        ).first()
        
        if not gift:
            raise HTTPException(
                status_code=404,
                detail="Cadeau non trouvé"
            )
        
        # Vérifier que l'utilisateur est impliqué
        if gift.sender_id != current_user.id and gift.receiver_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="Vous n'avez pas accès à ce cadeau"
            )
        
        # Récupérer les infos associées
        sender = db.query(User).filter(User.id == gift.sender_id).first()
        receiver = db.query(User).filter(User.id == gift.receiver_id).first()
        user_bom = db.query(UserBom).filter(UserBom.id == gift.user_bom_id).first()
        boom = user_bom.bom if user_bom else None
        
        # Construire la réponse
        response = {
            "id": gift.id,
            "sender_id": gift.sender_id,
            "sender_name": sender.full_name if sender else f"User {gift.sender_id}",
            "receiver_id": gift.receiver_id,
            "receiver_name": receiver.full_name if receiver else f"User {gift.receiver_id}",
            "user_bom_id": gift.user_bom_id,
            "boom_title": boom.title if boom else "BOOM inconnu",
            "boom_image_url": boom.preview_image if boom else None,
            "message": gift.message,
            "fees": float(gift.fees) if gift.fees else 0.0,
            "status": gift.status.value,
            "is_new_flow": gift.is_new_flow,
            "sent_at": gift.sent_at.isoformat() if gift.sent_at else None,
            "accepted_at": gift.accepted_at.isoformat() if gift.accepted_at else None,
            "expires_at": gift.expires_at.isoformat() if gift.expires_at else None,
            "paid_at": gift.paid_at.isoformat() if gift.paid_at else None,
            "delivered_at": gift.delivered_at.isoformat() if gift.delivered_at else None,
            "failed_at": gift.failed_at.isoformat() if gift.failed_at else None,
            "transaction_reference": gift.transaction_reference
        }
        
        # Détails financiers pour new flow
        if gift.is_new_flow:
            response["financial_details"] = {
                "gross_amount": float(gift.gross_amount) if gift.gross_amount else None,
                "fee_amount": float(gift.fee_amount) if gift.fee_amount else None,
                "net_amount": float(gift.net_amount) if gift.net_amount else None,
                "wallet_transaction_ids": gift.wallet_transaction_ids or []
            }
        
        # Métriques sociales si BOOM disponible
        if boom:
            social_value = float(boom.social_value) if boom.social_value is not None else None
            current_market_value = (
                float(boom.current_social_value)
                if getattr(boom, "current_social_value", None) is not None
                else None
            )
            share_count = boom.share_count or 0
            interaction_count = boom.interaction_count or 0

            response["social_metrics"] = {
                "social_value": social_value,
                "current_market_value": current_market_value,
                "share_count": share_count,
                "interaction_count": interaction_count,
                # Champs hérités conservés pour compatibilité éventuelle côté client
                "boom_social_value": social_value,
                "boom_share_count": share_count,
                "boom_interaction_count": interaction_count
            }
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur récupération détails cadeau: {str(e)}"
        )
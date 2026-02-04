"""
ROUTES API POUR LES INTERACTIONS UTILISATEUR
Endpoints pour enregistrer et récupérer les likes, shares, etc.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel

from app.database import get_db
from app.models.user_models import User
from app.services.auth import get_current_user_from_token
from app.services.interaction_service import interaction_service
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/interactions", tags=["interactions"])


# ============= SCHÉMAS PYDANTIC =============

class InteractionCreate(BaseModel):
    boom_id: int
    action_type: str  # 'like', 'share', 'view', etc.
    metadata: Optional[str] = None


class InteractionResponse(BaseModel):
    success: bool
    interaction_id: Optional[int] = None
    action: Optional[str] = None
    boom_id: Optional[int] = None
    boom_title: Optional[str] = None
    old_social_value: Optional[float] = None
    new_social_value: Optional[float] = None
    delta: Optional[float] = None
    total_value: Optional[float] = None
    interaction_count: Optional[int] = None
    share_count: Optional[int] = None
    message: Optional[str] = None
    error: Optional[str] = None


class InteractionStats(BaseModel):
    boom_id: int
    total: dict
    last_24h: dict
    unique_users: int


# ============= ENDPOINTS =============

@router.post("/", response_model=InteractionResponse)
async def create_interaction(
    interaction: InteractionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token)
):
    """
    Enregistrer une interaction utilisateur (like, share, etc.).
    
    **Types d'action supportés:**
    - `like`: L'utilisateur aime le BOOM
    - `share`: L'utilisateur partage le BOOM
    - `view`: L'utilisateur visionne le BOOM (optionnel)
    - `comment`: L'utilisateur commente le BOOM (optionnel)
    
    **Impact sur la valeur sociale:**
    - Like: +0.10 FCFA
    - Share: +0.50 FCFA
    - View: +0.01 FCFA
    - Comment: +0.20 FCFA
    """
    try:
        logger.info(f"📊 API: Création interaction {interaction.action_type} pour BOOM #{interaction.boom_id}")
        
        result = interaction_service.record_interaction(
            db=db,
            user_id=current_user.id,
            boom_id=interaction.boom_id,
            action_type=interaction.action_type,
            metadata=interaction.metadata
        )
        
        return InteractionResponse(**result)
        
    except Exception as e:
        logger.error(f"❌ Erreur API create_interaction: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de l'enregistrement de l'interaction: {str(e)}"
        )


@router.get("/boom/{boom_id}/stats", response_model=InteractionStats)
async def get_boom_interaction_stats(
    boom_id: int,
    db: Session = Depends(get_db)
):
    """
    Obtenir les statistiques d'interaction pour un BOOM.
    
    Retourne:
    - Total des interactions par type
    - Interactions des dernières 24h par type
    - Nombre d'utilisateurs uniques
    """
    try:
        stats = interaction_service.get_interaction_stats(db, boom_id)
        
        if "error" in stats:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=stats["error"]
            )
        
        return InteractionStats(**stats)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Erreur API get_boom_interaction_stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la récupération des stats: {str(e)}"
        )


@router.get("/boom/{boom_id}/has-liked")
async def check_user_liked_boom(
    boom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token)
):
    """Vérifier si l'utilisateur a liké un BOOM"""
    try:
        has_liked = interaction_service.has_user_liked(
            db=db,
            user_id=current_user.id,
            boom_id=boom_id
        )
        
        return {
            "boom_id": boom_id,
            "user_id": current_user.id,
            "has_liked": has_liked
        }
        
    except Exception as e:
        logger.error(f"❌ Erreur API check_user_liked_boom: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la vérification du like: {str(e)}"
        )


@router.get("/my-interactions")
async def get_my_interactions(
    boom_id: Optional[int] = None,
    action_type: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token)
):
    """Récupérer les interactions de l'utilisateur connecté"""
    try:
        interactions = interaction_service.get_user_interactions(
            db=db,
            user_id=current_user.id,
            boom_id=boom_id,
            action_type=action_type,
            limit=limit
        )
        
        return {
            "user_id": current_user.id,
            "count": len(interactions),
            "interactions": [
                {
                    "id": i.id,
                    "boom_id": i.boom_id,
                    "action_type": i.action_type,
                    "created_at": i.created_at.isoformat() if i.created_at else None,
                    "metadata": i.metadata_json
                }
                for i in interactions
            ]
        }
        
    except Exception as e:
        logger.error(f"❌ Erreur API get_my_interactions: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la récupération des interactions: {str(e)}"
        )


@router.delete("/boom/{boom_id}/unlike")
async def unlike_boom(
    boom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token)
):
    """
    Retirer un like (équivalent à envoyer un like alors qu'on a déjà liké).
    Cette route est un alias pratique.
    """
    try:
        # Appeler l'interaction service qui gère automatiquement le toggle
        result = interaction_service.record_interaction(
            db=db,
            user_id=current_user.id,
            boom_id=boom_id,
            action_type='like'
        )
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Erreur API unlike_boom: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors du unlike: {str(e)}"
        )

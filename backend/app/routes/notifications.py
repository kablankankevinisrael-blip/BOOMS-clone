from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user_models import User  # ✅ AJOUT
from app.schemas.notification_schemas import NotificationResponse, NotificationUpdate
from app.services.notification_service import (
    get_user_notifications, 
    mark_notification_as_read, 
    mark_all_notifications_as_read
)
from app.services.auth import get_current_user_from_token as get_current_user  # ✅ CORRECTION

router = APIRouter(prefix="/notifications", tags=["notifications"])

@router.get("", response_model=list[NotificationResponse])
def get_notifications_endpoint(
    unread_only: bool = Query(False, description="Afficher seulement les non lues"),
    limit: int = Query(50, description="Nombre maximum de notifications"),
    current_user: User = Depends(get_current_user),  # ✅ CORRECTION: User au lieu de dict
    db: Session = Depends(get_db)
):
    """Récupérer les notifications de l'utilisateur"""
    try:
        # ✅ CORRECTION: Utilise current_user.id au lieu de current_user["user_id"]
        notifications = get_user_notifications(db, current_user.id, unread_only, limit)
        return notifications
    except Exception as e:
        print(f"❌ Erreur dans get_notifications_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur interne du serveur: {str(e)}")

@router.patch("/{notification_id}/read")
def mark_notification_read_endpoint(
    notification_id: int,
    current_user: User = Depends(get_current_user),  # ✅ CORRECTION: User au lieu de dict
    db: Session = Depends(get_db)
):
    """Marquer une notification comme lue"""
    try:
        # ✅ CORRECTION: Utilise current_user.id au lieu de current_user["user_id"]
        notification = mark_notification_as_read(db, notification_id, current_user.id)
        if notification:
            return {"message": "Notification marquée comme lue"}
        else:
            raise HTTPException(status_code=404, detail="Notification non trouvée")
    except Exception as e:
        print(f"❌ Erreur dans mark_notification_read_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur interne du serveur: {str(e)}")

@router.post("/mark-all-read")
def mark_all_notifications_read_endpoint(
    current_user: User = Depends(get_current_user),  # ✅ CORRECTION: User au lieu de dict
    db: Session = Depends(get_db)
):
    """Marquer toutes les notifications comme lues"""
    try:
        # ✅ CORRECTION: Utilise current_user.id au lieu de current_user["user_id"]
        success = mark_all_notifications_as_read(db, current_user.id)
        if success:
            return {"message": "Toutes les notifications ont été marquées comme lues"}
        else:
            raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour")
    except Exception as e:
        print(f"❌ Erreur dans mark_all_notifications_read_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erreur interne du serveur: {str(e)}")
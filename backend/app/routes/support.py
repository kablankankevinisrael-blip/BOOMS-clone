from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.support_models import SupportPriority, SupportThreadStatus
from app.models.user_models import User, UserStatus
from app.schemas.support_schemas import (
    AdminResponseCreate,
    BannedMessageCreate,
    BannedMessageResponse,
    SupportAccountStatusResponse,
    SupportMessageCreate,
    SupportMessageResponse,
    SupportThreadCreate,
    SupportThreadDetailResponse,
    SupportThreadListItem,
    SupportThreadStatusUpdateRequest,
    SuggestedMessage,
    get_suggested_messages,
)
from app.schemas.user_schemas import UserStatusUpdateRequest
from app.services.auth import get_current_user_from_token as get_current_user
from app.services.support_service import SupportService
from app.services.user_service import UserService

router = APIRouter(prefix="/support", tags=["support"])
ThreadScope = Literal["mine", "assigned", "all"]


class SupportModerationRequest(BaseModel):
    reason: str = Field(default="", max_length=255)
    duration_hours: Optional[int] = Field(default=None, ge=1, le=720)


class SupportConversationDeleteRequest(BaseModel):
    user_id: Optional[int] = None
    user_phone: Optional[str] = None
    user_email: Optional[str] = None
    channel: Optional[str] = None


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> Optional[User]:
    """Autoriser les requêtes publiques tout en utilisant le token si présent."""
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None

    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token.strip())
    try:
        return get_current_user(credentials, db)
    except HTTPException:
        return None


@router.post("/threads", response_model=SupportThreadDetailResponse, status_code=status.HTTP_201_CREATED)
def create_thread(
    payload: SupportThreadCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Créer un ticket avec le support (message initial obligatoire)."""
    service = SupportService(db)
    thread = service.create_thread(current_user, payload)
    return service.get_thread(thread.id, current_user)


@router.get("/threads", response_model=list[SupportThreadListItem])
def list_threads(
    scope: ThreadScope = Query("mine", description="mine, assigned ou all"),
    status_filter: Optional[SupportThreadStatus] = Query(None, alias="status"),
    priority_filter: Optional[SupportPriority] = Query(None, alias="priority"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lister les tickets support visibles pour l'utilisateur courant."""
    if not current_user.is_admin and scope != "mine":
        raise HTTPException(status_code=403, detail="Scope réservé aux administrateurs")

    service = SupportService(db)
    threads = service.list_threads(
        current_user=current_user,
        scope=scope,
        status=status_filter,
        priority=priority_filter,
    )
    return threads


@router.get("/threads/{thread_id}", response_model=SupportThreadDetailResponse)
def get_thread(
    thread_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = SupportService(db)
    try:
        return service.get_thread(thread_id, current_user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/threads/{thread_id}", response_model=dict)
def delete_thread(
    thread_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    service = SupportService(db)
    try:
        service.delete_thread(thread_id)
        return {"success": True, "message": "Conversation supprimée"}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/threads/{thread_id}/messages", response_model=SupportMessageResponse)
def post_message(
    thread_id: int,
    payload: SupportMessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ajouter un message utilisateur/admin à un ticket existant."""
    service = SupportService(db)
    try:
        message = service.add_message(thread_id, payload, current_user)
        return message
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/threads/{thread_id}/status", response_model=SupportThreadDetailResponse)
def update_thread_status(
    thread_id: int,
    payload: SupportThreadStatusUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mettre à jour l'état d'un ticket. Les utilisateurs ne peuvent que clôturer leurs tickets."""
    service = SupportService(db)
    try:
        thread = service.update_status(thread_id, payload, current_user)
        return service.get_thread(thread.id, current_user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/templates", response_model=list[SuggestedMessage])
def list_suggested_messages():
    """Fournir des exemples de messages pour aider l'utilisateur à formuler sa demande."""
    return get_suggested_messages()


@router.post("/banned-messages", response_model=BannedMessageResponse, status_code=status.HTTP_201_CREATED)
def submit_banned_message(
    payload: BannedMessageCreate,
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Canal public permettant aux comptes bannis/supprimés de contester la décision."""
    service = SupportService(db)
    try:
        return service.submit_banned_message(payload, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/banned-messages", response_model=list[BannedMessageResponse])
def list_banned_messages(
    status_filter: Optional[str] = Query(None, alias="status"),
    channel: Optional[str] = Query(None, alias="channel"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    service = SupportService(db)
    return service.list_banned_messages(status_filter, channel)


@router.get("/banned-messages/public", response_model=list[BannedMessageResponse])
def list_banned_messages_public(
    phone: Optional[str] = Query(None, alias="phone"),
    email: Optional[str] = Query(None, alias="email"),
    channel: Optional[str] = Query(None, alias="channel"),
    db: Session = Depends(get_db),
):
    """Canal public pour récupérer les réponses liées à un téléphone/email."""
    if not phone and not email:
        raise HTTPException(status_code=400, detail="Téléphone ou email requis")

    service = SupportService(db)
    return service.list_banned_messages_public(phone, email, channel)


@router.post("/banned-messages/{message_id}/response", response_model=BannedMessageResponse)
def respond_to_banned_message(
    message_id: int,
    payload: AdminResponseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    service = SupportService(db)
    try:
        return service.respond_to_banned_message(message_id, payload, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/banned-messages/conversation", response_model=dict)
def delete_banned_conversation(
    payload: SupportConversationDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    service = SupportService(db)
    try:
        deleted = service.delete_banned_conversation(
            user_id=payload.user_id,
            phone=payload.user_phone,
            email=payload.user_email,
            channel=payload.channel,
        )
        return {"success": True, "deleted": deleted}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/users/{user_id}/status", response_model=SupportAccountStatusResponse)
def get_support_user_status(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return SupportAccountStatusResponse(
            status="deleted",
            is_active=False,
        )

    if user.status == UserStatus.BANNED:
        status_value = "banned"
    elif user.is_active is False:
        status_value = "inactive"
    else:
        status_value = "active"

    ban_until = None
    if status_value == "banned" and user.banned_at:
        ban_until = user.banned_at + timedelta(hours=72)

    return SupportAccountStatusResponse(
        status=status_value,
        is_active=bool(user.is_active),
        banned_at=user.banned_at,
        banned_reason=user.status_reason if status_value == "banned" else None,
        ban_until=ban_until,
        deactivated_at=user.last_status_changed_at if status_value == "inactive" else None,
        deactivated_reason=user.status_reason if status_value == "inactive" else None,
        last_status_changed_at=user.last_status_changed_at,
    )


@router.patch("/users/{user_id}/deactivate", response_model=dict)
def deactivate_user_from_support(
    user_id: int,
    payload: Optional[SupportModerationRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    reason = payload.reason if payload else ""
    status_payload = UserStatusUpdateRequest(
        status=UserStatus.SUSPENDED,
        reason=reason or "Désactivation manuelle",
        message=reason or "Compte désactivé par le support",
        source="support",
    )
    UserService.update_user_status(db, user, status_payload, actor=current_user)
    user.banned_at = None
    user.banned_by = None
    db.add(user)
    db.commit()

    return {"success": True, "message": "Compte désactivé"}


@router.patch("/users/{user_id}/ban", response_model=dict)
def ban_user_from_support(
    user_id: int,
    payload: Optional[SupportModerationRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    reason = payload.reason if payload else ""
    duration_hours = payload.duration_hours if payload and payload.duration_hours else 72
    ban_until = datetime.now(timezone.utc) + timedelta(hours=duration_hours)

    status_payload = UserStatusUpdateRequest(
        status=UserStatus.BANNED,
        reason=reason or "Bannissement manuel",
        message=reason or "Compte banni par le support",
        metadata={"ban_until": ban_until.isoformat(), "ban_duration_hours": duration_hours},
        source="support",
    )
    UserService.update_user_status(db, user, status_payload, actor=current_user)
    user.banned_at = datetime.now(timezone.utc)
    user.banned_by = current_user.id
    user.is_active = False
    db.add(user)
    db.commit()

    return {"success": True, "message": "Compte banni"}


@router.patch("/users/{user_id}/reactivate", response_model=dict)
def reactivate_user_from_support(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    status_payload = UserStatusUpdateRequest(
        status=UserStatus.ACTIVE,
        reason=None,
        message=None,
        source="support",
    )
    UserService.update_user_status(db, user, status_payload, actor=current_user)
    user.banned_at = None
    user.banned_by = None
    user.is_active = True
    db.add(user)
    db.commit()

    return {"success": True, "message": "Compte réactivé"}


@router.delete("/users/{user_id}", response_model=dict)
def delete_user_from_support(
    user_id: int,
    payload: Optional[SupportModerationRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous supprimer vous-même")

    db.delete(user)
    db.commit()

    return {"success": True, "message": "Utilisateur supprimé"}

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.support_models import SupportPriority, SupportThreadStatus
from app.models.user_models import User
from app.schemas.support_schemas import (
    AdminResponseCreate,
    BannedMessageCreate,
    BannedMessageResponse,
    SupportMessageCreate,
    SupportMessageResponse,
    SupportThreadCreate,
    SupportThreadDetailResponse,
    SupportThreadListItem,
    SupportThreadStatusUpdateRequest,
    SuggestedMessage,
    get_suggested_messages,
)
from app.services.auth import get_current_user_from_token as get_current_user
from app.services.support_service import SupportService

router = APIRouter(prefix="/support", tags=["support"])
ThreadScope = Literal["mine", "assigned", "all"]


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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès administrateur requis")

    service = SupportService(db)
    return service.list_banned_messages(status_filter)


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

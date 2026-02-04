from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.support_models import (
    SupportThread,
    SupportMessage,
    SupportThreadStatus,
    SupportPriority,
    SupportSenderType,
    BannedUserMessage,
)
from app.models.user_models import User
from app.models.user_models import UserStatus
from app.schemas.support_schemas import (
    SupportThreadCreate,
    SupportMessageCreate,
    SupportThreadStatusUpdateRequest,
    BannedMessageCreate,
    AdminResponseCreate,
)


class SupportService:
    """Encapsulates support thread lifecycle and messaging rules."""

    def __init__(self, db: Session):
        self.db = db

    # -----------------------------
    # Thread helpers
    # -----------------------------
    def create_thread(self, requester: User, payload: SupportThreadCreate) -> SupportThread:
        reference = self._generate_reference()
        now = datetime.now(timezone.utc)

        thread = SupportThread(
            reference=reference,
            user_id=requester.id,
            subject=payload.subject.strip(),
            category=payload.category.strip().lower(),
            priority=payload.priority,
            status=SupportThreadStatus.OPEN,
            context_payload=payload.context_payload or {},
            tags=[],
            last_message_preview=payload.message[:280],
            last_message_at=now,
            unread_admin_count=1,
            unread_user_count=0,
        )
        self.db.add(thread)
        self.db.flush()  # Need thread.id for the initial message

        message = SupportMessage(
            thread_id=thread.id,
            sender_id=requester.id,
            sender_type=SupportSenderType.ADMIN if requester.is_admin else SupportSenderType.USER,
            body=payload.message.strip(),
            attachments=payload.attachments or [],
            is_internal=False,
            context_snapshot=payload.context_payload or {},
        )
        self.db.add(message)
        self.db.commit()
        self.db.refresh(thread)

        return thread

    def list_threads(
        self,
        current_user: User,
        scope: str = "mine",
        status: Optional[SupportThreadStatus] = None,
        priority: Optional[SupportPriority] = None,
    ) -> list[SupportThread]:
        query = self.db.query(SupportThread)

        if not current_user.is_admin:
            query = query.filter(SupportThread.user_id == current_user.id)
        else:
            if scope == "assigned":
                query = query.filter(SupportThread.assigned_admin_id == current_user.id)
            elif scope == "all":
                pass  # keep all threads
            else:
                query = query.filter(SupportThread.user_id == current_user.id)

        if status:
            query = query.filter(SupportThread.status == status)

        if priority:
            query = query.filter(SupportThread.priority == priority)

        return query.order_by(
            SupportThread.last_message_at.desc().nullslast(),
            SupportThread.created_at.desc()
        ).all()

    def get_thread(self, thread_id: int, current_user: User) -> SupportThread:
        thread = self.db.query(SupportThread).filter(SupportThread.id == thread_id).first()
        if not thread:
            raise ValueError("Thread de support introuvable")

        self._ensure_can_access(thread, current_user)
        return thread

    # -----------------------------
    # Messaging helpers
    # -----------------------------
    def add_message(
        self,
        thread_id: int,
        payload: SupportMessageCreate,
        current_user: User,
    ) -> SupportMessage:
        thread = self.get_thread(thread_id, current_user)

        if payload.is_internal and not current_user.is_admin:
            raise PermissionError("Seul un administrateur peut ajouter une note interne")

        sender_type = SupportSenderType.ADMIN if current_user.is_admin else SupportSenderType.USER

        message = SupportMessage(
            thread_id=thread.id,
            sender_id=current_user.id,
            sender_type=sender_type,
            body=payload.message.strip(),
            attachments=payload.attachments or [],
            is_internal=payload.is_internal,
            context_snapshot=thread.context_payload,
        )
        self.db.add(message)

        self._apply_message_side_effects(thread, message, sender_type)
        self.db.commit()
        self.db.refresh(message)
        self.db.refresh(thread)

        return message

    def update_status(
        self,
        thread_id: int,
        payload: SupportThreadStatusUpdateRequest,
        current_user: User,
    ) -> SupportThread:
        thread = self.get_thread(thread_id, current_user)

        if not current_user.is_admin:
            if thread.user_id != current_user.id:
                raise PermissionError("Accès refusé")
            if payload.status not in {SupportThreadStatus.CLOSED, SupportThreadStatus.RESOLVED}:
                raise PermissionError("Seule la fermeture est autorisée côté utilisateur")

        if payload.assign_to_admin_id is not None:
            if not current_user.is_admin:
                raise PermissionError("Seul un admin peut assigner un ticket")
            assigned = self.db.query(User).filter(User.id == payload.assign_to_admin_id).first()
            if not assigned or not assigned.is_admin:
                raise ValueError("Administrateur assigné invalide")
            thread.assigned_admin_id = assigned.id

        thread.status = payload.status
        if payload.reason:
            thread.tags = (thread.tags or []) + [payload.reason]
        thread.updated_at = datetime.now(timezone.utc)
        if payload.status in {SupportThreadStatus.RESOLVED, SupportThreadStatus.CLOSED}:
            thread.unread_user_count = 0
            thread.unread_admin_count = 0

        self.db.add(thread)
        self.db.commit()
        self.db.refresh(thread)

        if payload.message:
            message_payload = SupportMessageCreate(
                message=payload.message,
                attachments=[],
                is_internal=not payload.notify_user,
            )
            self.add_message(thread.id, message_payload, current_user)

        return thread

    # -----------------------------
    # Internal helpers
    # -----------------------------
    def _ensure_can_access(self, thread: SupportThread, current_user: Optional[User]):
        if current_user is None:
            raise PermissionError("Utilisateur requis pour consulter ce ticket")

        if current_user.is_admin:
            return

        if thread.user_id != current_user.id:
            raise PermissionError("Vous n'avez pas accès à ce ticket")

    def _apply_message_side_effects(
        self,
        thread: SupportThread,
        message: SupportMessage,
        sender_type: SupportSenderType,
    ) -> None:
        now = datetime.now(timezone.utc)
        thread.last_message_preview = message.body[:280]
        thread.last_message_at = now

        if message.is_internal:
            self.db.add(thread)
            return

        if sender_type == SupportSenderType.ADMIN:
            thread.unread_user_count = (thread.unread_user_count or 0) + 1
            if thread.status == SupportThreadStatus.PENDING:
                thread.status = SupportThreadStatus.WAITING_USER
        else:
            thread.unread_admin_count = (thread.unread_admin_count or 0) + 1
            if thread.status in {SupportThreadStatus.RESOLVED, SupportThreadStatus.CLOSED, SupportThreadStatus.WAITING_USER}:
                thread.status = SupportThreadStatus.PENDING

        self.db.add(thread)

    @staticmethod
    def _generate_reference() -> str:
        return f"SUP-{uuid4().hex[:8].upper()}"

    # -----------------------------
    # Banned user messaging channel
    # -----------------------------
    def submit_banned_message(
        self,
        payload: BannedMessageCreate,
        current_user: Optional[User],
    ) -> dict:
        body = (payload.message or "").strip()
        if not body:
            raise ValueError("Le message est obligatoire")

        if current_user is None and not (payload.user_phone or payload.user_email):
            raise ValueError("Téléphone ou email requis pour vous identifier")

        resolved_user = None
        if current_user is None:
            resolved_user = self._resolve_user_by_contact(payload.user_phone, payload.user_email)

        message = BannedUserMessage(
            user_id=current_user.id if current_user else (resolved_user.id if resolved_user else None),
            user_phone=current_user.phone if current_user else payload.user_phone,
            user_email=current_user.email if current_user else payload.user_email,
            message=body,
            channel=(payload.channel or "app"),
            meta_payload=payload.metadata or {},
        )
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        return self._enrich_banned_message(message)

    def list_banned_messages(self, status_filter: Optional[str]) -> list[dict]:
        query = self.db.query(BannedUserMessage)
        if status_filter:
            query = query.filter(BannedUserMessage.status == status_filter)
        messages = query.order_by(BannedUserMessage.created_at.desc()).all()
        return self._enrich_banned_messages(messages)

    def list_banned_messages_public(self, phone: Optional[str], email: Optional[str]) -> list[dict]:
        query = self.db.query(BannedUserMessage)
        if phone and email:
            query = query.filter(
                (BannedUserMessage.user_phone == phone) | (BannedUserMessage.user_email == email)
            )
        elif phone:
            query = query.filter(BannedUserMessage.user_phone == phone)
        elif email:
            query = query.filter(BannedUserMessage.user_email == email)

        messages = query.order_by(BannedUserMessage.created_at.desc()).all()
        return self._enrich_banned_messages(messages)

    def respond_to_banned_message(
        self,
        message_id: int,
        payload: AdminResponseCreate,
        admin: User,
    ) -> dict:
        message = self.db.query(BannedUserMessage).filter(BannedUserMessage.id == message_id).first()
        if not message:
            raise ValueError("Message introuvable")

        response = (payload.response or "").strip()
        if not response:
            raise ValueError("La réponse ne peut pas être vide")

        message.admin_response = response
        message.status = "responded"
        message.responded_at = datetime.now(timezone.utc)
        message.responded_by = admin.id
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        return self._enrich_banned_message(message)

    def _enrich_banned_messages(self, messages: list[BannedUserMessage]) -> list[dict]:
        user_ids = {message.user_id for message in messages if message.user_id}
        users = []
        if user_ids:
            users = self.db.query(User).filter(User.id.in_(user_ids)).all()
        user_lookup = {user.id: user for user in users}
        return [self._enrich_banned_message(message, user_lookup) for message in messages]

    def _enrich_banned_message(
        self,
        message: BannedUserMessage,
        user_lookup: Optional[dict[int, User]] = None,
    ) -> dict:
        meta = message.meta_payload or {}
        user = user_lookup.get(message.user_id) if user_lookup and message.user_id else None
        if user is None and not message.user_id:
            user = self._resolve_user_by_contact(message.user_phone, message.user_email)

        current_status = None
        if user is None and message.user_id:
            current_status = "deleted"
        elif user:
            if user.status == UserStatus.BANNED:
                current_status = "banned"
            elif user.status == UserStatus.SUSPENDED or user.is_active is False:
                current_status = "inactive"
            else:
                current_status = "active"

        action_type = meta.get("action_type")
        if action_type not in {"inactive", "banned", "deleted"}:
            action_type = current_status

        action_reason = meta.get("action_reason") or meta.get("reason")
        if not action_reason and user:
            action_reason = user.status_reason

        action_at = meta.get("action_at")
        if not action_at and user:
            if current_status == "banned":
                action_at = user.banned_at or user.last_status_changed_at
            else:
                action_at = user.last_status_changed_at

        action_by = meta.get("action_by")
        if not action_by and user:
            if current_status == "banned":
                action_by = user.banned_by
            else:
                action_by = user.status_changed_by

        ban_until = meta.get("ban_until")
        if not ban_until and user and current_status == "banned" and user.banned_at:
            ban_until = user.banned_at + timedelta(hours=72)

        return {
            "id": message.id,
            "user_id": message.user_id,
            "user_phone": message.user_phone,
            "user_email": message.user_email,
            "message": message.message,
            "admin_response": message.admin_response,
            "status": message.status,
            "channel": message.channel,
            "created_at": message.created_at,
            "responded_at": message.responded_at,
            "responded_by": message.responded_by,
            "meta_payload": meta,
            "action_type": action_type,
            "action_reason": action_reason,
            "action_at": action_at,
            "action_by": action_by,
            "ban_until": ban_until,
            "current_account_status": current_status,
        }

    def _resolve_user_by_contact(self, phone: Optional[str], email: Optional[str]) -> Optional[User]:
        query = self.db.query(User)
        if phone and email:
            return query.filter((User.phone == phone) | (User.email == email)).first()
        if phone:
            return query.filter(User.phone == phone).first()
        if email:
            return query.filter(User.email == email).first()
        return None
    
    # ========== USER STATUS MANAGEMENT ==========
    def update_user_status(self, user_id: int, admin_id: int, 
                          status: str, reason: Optional[str] = None,
                          duration_hours: Optional[int] = None,
                          message: Optional[str] = None) -> User:
        """Admin: mettre à jour le statut d'un utilisateur"""
        from datetime import timedelta
        from app.models.user_models import UserStatus
        
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        
        status_map = {
            "active": UserStatus.ACTIVE,
            "suspended": UserStatus.SUSPENDED,
            "banned": UserStatus.BANNED,
            "limited": UserStatus.LIMITED,
            "review": UserStatus.REVIEW
        }
        new_status = status_map.get(status.lower())
        
        if not new_status:
            raise ValueError(f"Invalid status: {status}")
        
        user.status = new_status
        user.status_reason = reason
        user.status_message = message
        user.status_changed_by = admin_id
        user.last_status_changed_at = datetime.now(timezone.utc)
        
        if new_status == UserStatus.SUSPENDED:
            user.suspension_count += 1
            user.last_suspension_at = datetime.now(timezone.utc)
            if duration_hours:
                user.suspended_until = datetime.now(timezone.utc) + timedelta(hours=duration_hours)
            else:
                user.suspended_until = datetime.now(timezone.utc) + timedelta(hours=24)
            user.is_active = False
        
        elif new_status == UserStatus.BANNED:
            user.banned_at = datetime.now(timezone.utc)
            user.banned_by = admin_id
            user.is_active = False
        
        elif new_status == UserStatus.ACTIVE:
            user.suspended_until = None
            user.banned_at = None
            user.banned_by = None
            user.is_active = True
        
        self.db.commit()
        self.db.refresh(user)
        return user
    
    def check_auto_reactivation(self) -> int:
        """Vérifier et réactiver automatiquement les comptes suspendus expirés"""
        from app.models.user_models import UserStatus
        
        now = datetime.now(timezone.utc)
        suspended_users = self.db.query(User).filter(
            User.status == UserStatus.SUSPENDED,
            User.suspended_until.isnot(None),
            User.suspended_until <= now
        ).all()
        
        for user in suspended_users:
            user.status = UserStatus.ACTIVE
            user.is_active = True
            user.suspended_until = None
            user.status_message = "Compte réactivé automatiquement après expiration de la suspension"
            user.last_status_changed_at = now
        
        if suspended_users:
            self.db.commit()
        
        return len(suspended_users)
    
    def get_user_status(self, user_id: int) -> User:
        """Récupérer le statut d'un utilisateur"""
        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise ValueError("User not found")
        return user
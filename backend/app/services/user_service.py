from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session
from passlib.context import CryptContext

from app.models.user_models import User, Wallet, UserStatus
from app.schemas import UserCreate
from app.schemas.user_schemas import UserStatusUpdateRequest

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserService:
    """Utilities around account lifecycle and wallet bootstrap."""

    BLOCKING_STATUSES = {UserStatus.SUSPENDED, UserStatus.BANNED}
    AUTO_RESETTABLE_STATUSES = {UserStatus.REVIEW, UserStatus.LIMITED, UserStatus.SUSPENDED}

    @staticmethod
    def create_user(db: Session, user_data: UserCreate):
        """Create a user and provision an empty wallet."""
        if db.query(User).filter(User.phone == user_data.phone).first():
            raise ValueError("Un utilisateur avec ce téléphone existe déjà")

        if db.query(User).filter(User.email == user_data.email).first():
            raise ValueError("Un utilisateur avec cet email existe déjà")

        user = User(
            phone=user_data.phone,
            email=user_data.email,
            password_hash=pwd_context.hash(user_data.password),
            full_name=user_data.full_name,
            status=UserStatus.ACTIVE,
            status_source="bootstrap"
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        wallet = Wallet(user_id=user.id)
        db.add(wallet)
        db.commit()

        return user

    @staticmethod
    def get_user_by_phone(db: Session, phone: str):
        return db.query(User).filter(User.phone == phone).first()

    @classmethod
    def update_user_status(
        cls,
        db: Session,
        target_user: User,
        payload: UserStatusUpdateRequest,
        actor: Optional[User] = None,
    ) -> dict:
        """Persist a new status for the given account and return a normalized snapshot."""
        expires_at = payload.expires_at
        if payload.expires_in_minutes and not expires_at:
            expires_at = datetime.now(timezone.utc) + timedelta(minutes=payload.expires_in_minutes)
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        target_user.status = payload.status
        target_user.status_reason = payload.reason
        target_user.status_message = payload.message
        target_user.status_expires_at = expires_at
        target_user.status_metadata = dict(payload.metadata or {})
        target_user.status_source = payload.source
        target_user.status_changed_by = actor.id if actor else target_user.status_changed_by
        target_user.last_status_changed_at = datetime.now(timezone.utc)
        target_user.is_active = payload.status not in cls.BLOCKING_STATUSES

        db.add(target_user)
        db.commit()
        db.refresh(target_user)

        return cls.get_status_snapshot(db, target_user)

    @classmethod
    def get_status_snapshot(cls, db: Session, user: User) -> dict:
        """Return the latest status information (auto-resetting temporary locks)."""
        refreshed_user = cls._maybe_reset_status(db, user)
        status_value = cls._status_value(refreshed_user.status)
        status_enum = UserStatus(status_value)

        return {
            "code": status_enum,
            "is_blocking": refreshed_user.status in cls.BLOCKING_STATUSES,
            "reason": refreshed_user.status_reason,
            "message": refreshed_user.status_message,
            "expires_at": refreshed_user.status_expires_at,
            "last_changed_at": refreshed_user.last_status_changed_at,
            "changed_by": refreshed_user.status_changed_by,
            "metadata": refreshed_user.status_metadata or {},
            "source": refreshed_user.status_source,
        }

    @classmethod
    def _maybe_reset_status(cls, db: Session, user: User) -> User:
        if (
            user.status_expires_at
            and user.status in cls.AUTO_RESETTABLE_STATUSES
            and user.status_expires_at <= datetime.now(timezone.utc)
        ):
            user.status = UserStatus.ACTIVE
            user.status_reason = None
            user.status_message = None
            user.status_expires_at = None
            user.status_metadata = {}
            user.status_source = "auto_reset"
            user.is_active = True
            user.last_status_changed_at = datetime.now(timezone.utc)
            user.status_changed_by = None

            db.add(user)
            db.commit()
            db.refresh(user)

        return user

    @staticmethod
    def _status_value(status: UserStatus | str | None) -> str:
        if isinstance(status, UserStatus):
            return status.value
        return status or UserStatus.ACTIVE.value
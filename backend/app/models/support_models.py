from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, Text, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base


class SupportThreadStatus(enum.Enum):
    """Possible lifecycle states for support threads."""
    OPEN = "open"
    PENDING = "pending"
    WAITING_USER = "waiting_user"
    RESOLVED = "resolved"
    CLOSED = "closed"
    ESCALATED = "escalated"


class SupportPriority(enum.Enum):
    """Prioritization buckets to help admins triage."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class SupportSenderType(enum.Enum):
    """Origin of a support message."""
    USER = "user"
    ADMIN = "admin"
    SYSTEM = "system"


class SupportThread(Base):
    __tablename__ = "support_threads"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String(32), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subject = Column(String(255), nullable=False)
    category = Column(String(64), nullable=False, default="general")
    priority = Column(Enum(SupportPriority, name="supportpriority"), nullable=False, default=SupportPriority.NORMAL)
    status = Column(Enum(SupportThreadStatus, name="supportthreadstatus"), nullable=False, default=SupportThreadStatus.OPEN)
    context_payload = Column(JSONB, default=dict)
    tags = Column(JSONB, default=list)
    unread_admin_count = Column(Integer, default=0)
    unread_user_count = Column(Integer, default=0)
    last_message_preview = Column(String(280))
    last_message_at = Column(DateTime(timezone=True), server_default=func.now())
    assigned_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    closed_by_admin_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id], back_populates="support_threads")
    assigned_admin = relationship("User", foreign_keys=[assigned_admin_id])
    closed_by_admin = relationship("User", foreign_keys=[closed_by_admin_id])
    messages = relationship(
        "SupportMessage",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="SupportMessage.created_at"
    )

    @property
    def user_phone(self):
        return getattr(self.user, "phone", None)

    @property
    def user_email(self):
        return getattr(self.user, "email", None)

    @property
    def user_full_name(self):
        return getattr(self.user, "full_name", None)


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(Integer, ForeignKey("support_threads.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    sender_type = Column(Enum(SupportSenderType, name="supportsendertype"), nullable=False)
    body = Column(Text, nullable=False)
    attachments = Column(JSONB, default=list)
    is_internal = Column(Boolean, default=False)
    context_snapshot = Column(JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    thread = relationship("SupportThread", back_populates="messages")
    sender = relationship("User", back_populates="support_messages", foreign_keys=[sender_id])


class SupportTicket(Base):
    """Tickets de support pour messagerie utilisateurs"""
    __tablename__ = "support_tickets"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subject = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False)
    priority = Column(String(20), default="normal")
    status = Column(String(20), default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    assigned_to = Column(Integer, ForeignKey("users.id"))
    resolved_at = Column(DateTime(timezone=True))
    closed_at = Column(DateTime(timezone=True))
    context_data = Column("metadata", JSONB, default=dict)


class BannedUserMessage(Base):
    """Messages des utilisateurs bannis (canal séparé)"""
    __tablename__ = "banned_user_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=True)
    user_phone = Column(String(255))
    user_email = Column(String(255))
    message = Column(Text, nullable=False)
    admin_response = Column(Text)
    status = Column(String(20), default="pending")
    channel = Column(String(32), default="app")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    responded_at = Column(DateTime(timezone=True))
    responded_by = Column(Integer, ForeignKey("users.id"))
    meta_payload = Column("metadata", JSONB, default=dict)


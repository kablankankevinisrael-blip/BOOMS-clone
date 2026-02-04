from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, ConfigDict
from app.models.support_models import (
    SupportPriority,
    SupportThreadStatus,
    SupportSenderType,
)


class SupportThreadCreate(BaseModel):
    subject: str = Field(..., min_length=3, max_length=255)
    category: str = Field(default="general", max_length=64)
    priority: SupportPriority = Field(default=SupportPriority.NORMAL)
    message: str = Field(..., min_length=5, max_length=4000)
    context_payload: dict[str, Any] | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)

    model_config = ConfigDict(use_enum_values=True)


class SupportMessageCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    is_internal: bool = False

    model_config = ConfigDict(use_enum_values=True)


class SupportThreadStatusUpdateRequest(BaseModel):
    status: SupportThreadStatus
    reason: Optional[str] = Field(default=None, max_length=255)
    assign_to_admin_id: Optional[int] = Field(default=None, ge=1)
    message: Optional[str] = Field(default=None, max_length=4000)
    notify_user: bool = True

    model_config = ConfigDict(use_enum_values=True)


class SupportMessageResponse(BaseModel):
    id: int
    thread_id: int
    sender_id: Optional[int]
    sender_type: SupportSenderType
    body: str
    attachments: list[dict[str, Any]]
    is_internal: bool
    context_snapshot: dict[str, Any] | None
    created_at: datetime
    updated_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class SupportThreadListItem(BaseModel):
    id: int
    reference: str
    subject: str
    category: str
    status: SupportThreadStatus
    priority: SupportPriority
    user_phone: Optional[str] = None
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    last_message_preview: Optional[str]
    last_message_at: Optional[datetime]
    created_at: datetime
    updated_at: Optional[datetime]
    unread_admin_count: Optional[int]
    unread_user_count: Optional[int]

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class SupportThreadDetailResponse(BaseModel):
    id: int
    reference: str
    user_id: int
    user_phone: Optional[str] = None
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    assigned_admin_id: Optional[int]
    subject: str
    category: str
    status: SupportThreadStatus
    priority: SupportPriority
    context_payload: dict[str, Any] | None
    tags: list[str] | None
    created_at: datetime
    updated_at: Optional[datetime]
    last_message_at: Optional[datetime]
    messages: list[SupportMessageResponse]

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


# ========== SIMPLE TICKET SYSTEM (SEPARATE FROM THREADS) ==========
class TicketCreate(BaseModel):
    subject: str = Field(..., max_length=255)
    category: str
    message: str
    priority: Optional[str] = "normal"

class TicketMessageCreate(BaseModel):
    message: str
    attachments: Optional[list[str]] = []

class TicketMessage(BaseModel):
    id: int
    ticket_id: int
    sender_id: int
    message: str
    is_admin_response: bool
    created_at: datetime
    read_at: Optional[datetime]
    attachments: list[str]
    
    model_config = ConfigDict(from_attributes=True)

class TicketDetail(BaseModel):
    id: int
    user_id: int
    subject: str
    category: str
    priority: str
    status: str
    created_at: datetime
    updated_at: datetime
    assigned_to: Optional[int]
    resolved_at: Optional[datetime]
    closed_at: Optional[datetime]
    
    model_config = ConfigDict(from_attributes=True)

class TicketList(BaseModel):
    id: int
    user_id: int
    subject: str
    category: str
    priority: str
    status: str
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


# ========== BANNED USER MESSAGES ==========
class BannedMessageCreate(BaseModel):
    message: str
    user_phone: Optional[str]
    user_email: Optional[str]
    channel: str = Field(default="app", max_length=32)
    metadata: dict[str, Any] = Field(default_factory=dict)

class BannedMessageResponse(BaseModel):
    id: int
    user_id: Optional[int]
    user_phone: Optional[str]
    user_email: Optional[str]
    message: str
    admin_response: Optional[str]
    status: str
    channel: Optional[str]
    created_at: datetime
    responded_at: Optional[datetime]
    responded_by: Optional[int]
    metadata: dict[str, Any] = Field(default_factory=dict, alias="meta_payload")
    action_type: Optional[str] = None
    action_reason: Optional[str] = None
    action_at: Optional[datetime] = None
    action_by: Optional[int] = None
    ban_until: Optional[datetime] = None
    current_account_status: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

class AdminResponseCreate(BaseModel):
    response: str


class SupportAccountStatusResponse(BaseModel):
    status: str
    is_active: bool
    banned_at: Optional[datetime] = None
    banned_reason: Optional[str] = None
    ban_until: Optional[datetime] = None
    deactivated_at: Optional[datetime] = None
    deactivated_reason: Optional[str] = None
    last_status_changed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ========== USER STATUS MANAGEMENT ==========
class UserStatusUpdate(BaseModel):
    status: str  # active, suspended, banned
    reason: Optional[str]
    duration_hours: Optional[int]
    message: Optional[str]

class UserStatusResponse(BaseModel):
    id: int
    status: str
    is_active: bool
    suspended_until: Optional[datetime]
    suspension_count: int
    banned_at: Optional[datetime]
    status_reason: Optional[str]
    status_message: Optional[str]
    
    model_config = ConfigDict(from_attributes=True)


# ========== SUGGESTED MESSAGES ==========
class SuggestedMessage(BaseModel):
    category: str
    title: str
    template: str

def get_suggested_messages() -> list[SuggestedMessage]:
    return [
        SuggestedMessage(
            category="account_suspended",
            title="Demande de réactivation",
            template="Bonjour, mon compte a été suspendu. Pourriez-vous m'expliquer la raison et les démarches pour le réactiver ? Merci."
        ),
        SuggestedMessage(
            category="account_banned",
            title="Contestation de bannissement",
            template="Bonjour, mon compte a été banni. Je ne comprends pas pourquoi et souhaiterais avoir des explications. Pouvez-vous revoir ma situation ?"
        ),
        SuggestedMessage(
            category="payment_issue",
            title="Problème de paiement",
            template="Bonjour, j'ai rencontré un problème lors d'un paiement. Référence : [REF]. Pouvez-vous m'aider ?"
        ),
        SuggestedMessage(
            category="technical_issue",
            title="Problème technique",
            template="Bonjour, je rencontre un problème technique : [DESCRIPTION]. Pouvez-vous m'aider ?"
        ),
        SuggestedMessage(
            category="general_inquiry",
            title="Question générale",
            template="Bonjour, j'ai une question concernant [SUJET]. Pourriez-vous m'aider ?"
        ),
    ]


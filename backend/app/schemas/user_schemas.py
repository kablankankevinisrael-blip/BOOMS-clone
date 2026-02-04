# backend/app/schemas/user_schemas.py - CORRIGER
from pydantic import BaseModel, EmailStr, ConfigDict, Field
from typing import Optional, Any, Dict
from datetime import datetime
from app.models.user_models import UserStatus

class UserCreate(BaseModel):
    phone: str
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    
    # ✅ AJOUTER
    model_config = ConfigDict(extra='ignore')

class UserResponse(BaseModel):
    id: int
    phone: str
    email: str
    full_name: Optional[str]
    kyc_status: str
    is_active: bool
    is_admin: bool
    status: UserStatus
    status_reason: Optional[str]
    status_message: Optional[str]
    status_expires_at: Optional[datetime]
    status_source: Optional[str]
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)

class WalletResponse(BaseModel):
    id: int
    user_id: int
    balance: float
    currency: str
    
    model_config = ConfigDict(from_attributes=True)


class UserStatusSnapshot(BaseModel):
    code: UserStatus
    is_blocking: bool
    reason: Optional[str] = None
    message: Optional[str] = None
    expires_at: Optional[datetime] = None
    last_changed_at: Optional[datetime] = None
    changed_by: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    source: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class UserStatusUpdateRequest(BaseModel):
    status: UserStatus
    reason: Optional[str] = Field(default=None, max_length=255)
    message: Optional[str] = Field(default=None, max_length=2000)
    expires_at: Optional[datetime] = None
    expires_in_minutes: Optional[int] = Field(default=None, ge=5, le=43200)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    source: str = Field(default="manual", max_length=64)

    model_config = ConfigDict(use_enum_values=True)
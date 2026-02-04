from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ContactCreate(BaseModel):
    contact_phone: str
    nickname: Optional[str] = None

class ContactResponse(BaseModel):
    id: int
    contact_user_id: int
    nickname: Optional[str]
    is_favorite: bool
    created_at: datetime
    
    # Informations du contact
    contact_phone: str
    contact_name: Optional[str]
    
    class Config:
        from_attributes = True

class UserSearchResponse(BaseModel):
    id: int
    phone: str
    full_name: Optional[str]
    
    class Config:
        from_attributes = True
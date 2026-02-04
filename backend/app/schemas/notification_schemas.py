from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict, Any

class NotificationCreate(BaseModel):
    title: str
    message: str
    notification_type: str
    related_entity_id: Optional[int] = None
    notification_data: Optional[Dict[str, Any]] = None
    
class NotificationUpdate(BaseModel):
    is_read: Optional[bool] = None

class NotificationResponse(BaseModel):
    id: int
    user_id: int
    title: str
    message: str
    notification_type: str
    is_read: bool
    related_entity_id: Optional[int]
    notification_data: Optional[Dict[str, Any]]
    created_at: datetime
    
    class Config:
        from_attributes = True
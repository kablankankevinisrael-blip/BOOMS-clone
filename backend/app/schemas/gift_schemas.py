from pydantic import BaseModel, validator
from typing import Optional, List
from datetime import datetime
from enum import Enum

class GiftStatus(str, Enum):
    SENT = "sent"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EXPIRED = "expired"

class GiftRequest(BaseModel):
    receiver_phone: str
    bom_id: int
    quantity: int = 1
    message: Optional[str] = None
    
    @validator('quantity')
    def validate_quantity(cls, v):
        if v < 1:
            raise ValueError('La quantité doit être au moins 1')
        return v

class GiftResponse(BaseModel):
    id: int
    sender_id: int
    receiver_id: int
    user_bom_id: int
    message: Optional[str]
    fees: Optional[float] = 0.0  # AJOUT : Frais appliqués
    status: GiftStatus
    sent_at: datetime
    accepted_at: Optional[datetime]
    expires_at: Optional[datetime]
    
    # Informations étendues
    sender_name: Optional[str]
    receiver_name: Optional[str]
    bom_title: Optional[str]
    bom_image_url: Optional[str]
    
    class Config:
        from_attributes = True

class GiftActionRequest(BaseModel):
    gift_id: int
    action: GiftStatus  # ACCEPTED ou DECLINED

# AJOUT : Schéma pour réponse détaillée avec frais
class GiftWithFeesResponse(GiftResponse):
    financial_details: Optional[dict] = None
    social_impact: Optional[dict] = None
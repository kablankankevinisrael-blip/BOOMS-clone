from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime

class TransactionCreate(BaseModel):
    user_id: int
    type: str
    amount: float
    currency: str = "FCFA"
    reference: str
    transaction_data: Optional[Dict[str, Any]] = {}

class TransactionResponse(BaseModel):
    id: int
    user_id: int
    type: str
    amount: float
    currency: str
    status: str
    reference: str
    created_at: datetime
    
    class Config:
        from_attributes = True
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class WalletBalance(BaseModel):
    balance: float
    currency: str = "FCFA"

class TransactionResponse(BaseModel):
    id: int
    user_id: int
    amount: float
    transaction_type: str  # 'deposit', 'purchase', 'transfer', 'withdrawal'
    description: str
    status: str  # 'pending', 'completed', 'failed'
    created_at: datetime
    
    class Config:
        from_attributes = True

class DepositRequest(BaseModel):
    amount: float
    phone_number: str  # Pour Mobile Money

class WithdrawalRequest(BaseModel):
    amount: float
    phone_number: str

class TransactionCreate(BaseModel):
    amount: float
    transaction_type: str
    description: str
    status: str = "completed"
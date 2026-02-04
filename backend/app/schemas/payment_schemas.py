from pydantic import BaseModel, validator, Field 
from typing import Optional, List
from datetime import datetime
from enum import Enum

class PaymentMethod(str, Enum):
    WAVE = "wave"
    STRIPE = "stripe"
    ORANGE_MONEY = "orange_money"
    MTN_MOMO = "mtn_momo"


class PaymentStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class DepositRequest(BaseModel):
    amount: float
    method: PaymentMethod
    phone_number: Optional[str] = None
    
    @validator('amount')
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError('Le montant doit être positif')
        if v > 1000000:  # 1 million FCFA max
            raise ValueError('Le montant maximum est de 1,000,000 FCFA')
        return v

# ⬅️ AJOUTER CES NOUVEAUX SCHÉMAS
class WithdrawalRequest(BaseModel):
    amount: float
    phone_number: str
    method: PaymentMethod = PaymentMethod.WAVE
    
    @validator('amount')
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError('Le montant doit être positif')
        if v < 1000:  # Minimum 1000 FCFA
            raise ValueError('Le montant minimum est de 1,000 FCFA')
        if v > 500000:  # Maximum 500,000 FCFA
            raise ValueError('Le montant maximum est de 500,000 FCFA')
        return v
    
    @validator('phone_number')
    def validate_phone_number(cls, v):
        import re
        pattern = r'^(07|05|01)[0-9]{8}$'
        if not re.match(pattern, v.replace(" ", "")):
            raise ValueError('Numéro Wave Côte d\'Ivoire invalide. Format: 07xxxxxxxx, 05xxxxxxxx, 01xxxxxxxx')
        return v

class WithdrawalResponse(BaseModel):
    status: str
    transaction_id: str
    estimated_processing_time: str = "2-5 minutes"

class CommissionSummary(BaseModel):
    date: str
    deposit_commissions: float
    withdrawal_commissions: float
    total_commissions: float
    deposit_count: int
    withdrawal_count: int

class WavePaymentResponse(BaseModel):
    payment_url: str
    transaction_id: str
    qr_code_data: Optional[str] = None

class StripePaymentResponse(BaseModel):
    client_secret: str
    payment_intent_id: str

class PaymentTransactionResponse(BaseModel):
    id: str
    user_id: int
    type: str
    amount: float
    fees: float
    net_amount: float
    status: PaymentStatus
    provider: Optional[str]
    description: Optional[str]
    created_at: datetime
    
    class Config:
        from_attributes = True

class DetailedBalanceResponse(BaseModel):
    liquid_balance: float
    virtual_balance: float
    bom_value: float
    social_value: float
    total_balance: float
    currency: str

class BomWithdrawalValidationRequest(BaseModel):
    user_bom_id: int

class BomWithdrawalValidationResponse(BaseModel):
    is_approved: bool
    bom_title: str
    bom_value: float
    withdrawal_amount: float
    fees: float
    net_amount: float
    security_checks: dict
    rejection_reason: Optional[str] = None

class BomWithdrawalExecuteRequest(BaseModel):
    user_bom_id: int
    phone_number: str
    provider: PaymentMethod = PaymentMethod.WAVE

    @validator('phone_number')
    def validate_phone_number(cls, v):
        import re
        pattern = r'^(07|05|01|27)[0-9]{8}$'
        if not re.match(pattern, v.replace(" ", "")):
            raise ValueError('Format numéro invalide. Ex: 0700000000')
        return v

class BomWithdrawalExecuteResponse(BaseModel):
    success: bool
    transaction_id: str
    withdrawal_amount: float
    fees: float
    net_amount: float
    payout_channel: Optional[str] = None
    payout_reference: Optional[str] = None
    message: Optional[str] = None

class PaymentWebhook(BaseModel):
    transaction_id: str
    status: PaymentStatus
    external_reference: str
    amount: float
    
# ============ SCHEMAS ADMIN TREASURY DÉFINITIFS ============

class AdminTreasuryDepositRequest(BaseModel):
    """Requête pour dépôt admin vers treasury - 0% frais"""
    amount: float = Field(..., gt=0, le=10000000, description="Montant en FCFA (max: 10M)")
    method: PaymentMethod = Field(..., description="Méthode de paiement")
    phone_number: Optional[str] = Field(
        None,
        description="Numéro pour transfert (requis pour Wave/Orange/MTN)"
    )
    description: Optional[str] = Field(
        "Dépôt admin vers treasury",
        max_length=500,
        description="Description de l'opération"
    )
    
    @validator('phone_number')
    def validate_phone_if_required(cls, v, values):
        method = values.get('method')
        if method in [PaymentMethod.WAVE, PaymentMethod.ORANGE_MONEY, PaymentMethod.MTN_MOMO] and not v:
            raise ValueError(f'Numéro de téléphone requis pour {method.value}')
        
        # Validation format si fourni
        if v:
            import re
            pattern = r'^(07|05|01)[0-9]{8}$'
            if not re.match(pattern, v.replace(" ", "")):
                raise ValueError('Format numéro invalide. Ex: 0700000000')
        
        return v

class AdminTreasuryWithdrawRequest(BaseModel):
    """Requête pour retrait admin depuis treasury - 0% frais"""
    amount: float = Field(..., gt=0, le=5000000, description="Montant en FCFA (max: 5M)")
    method: PaymentMethod = Field(..., description="Méthode de paiement")
    phone_number: Optional[str] = Field(
        None,
        description="Numéro de destination (requis pour Wave/Orange/MTN)"
    )
    description: Optional[str] = Field(
        "Retrait admin depuis treasury",
        max_length=500,
        description="Description de l'opération"
    )
    
    @validator('phone_number')
    def validate_withdrawal_phone(cls, v, values):
        method = values.get('method')
        if method in [PaymentMethod.WAVE, PaymentMethod.ORANGE_MONEY, PaymentMethod.MTN_MOMO] and not v:
            raise ValueError(f'Numéro de destination requis pour {method.value}')
        return v

class AdminTreasuryOperationResponse(BaseModel):
    """Réponse standardisée pour opérations treasury admin"""
    success: bool
    message: str
    transaction_id: str = Field(..., description="ID PaymentTransaction")
    standard_transaction_id: str = Field(..., description="ID Transaction standard")
    external_reference: Optional[str] = Field(None, description="Référence externe")
    amount: str = Field(..., description="Montant en FCFA")
    fees_applied: str = Field(..., description="Frais appliqués (toujours 0.00)")
    old_treasury_balance: str = Field(..., description="Ancien solde treasury")
    new_treasury_balance: str = Field(..., description="Nouveau solde treasury")
    operation: str = Field(..., description="Type d'opération")
    is_admin: bool = Field(True, description="Opération admin")
    timestamp: datetime = Field(default_factory=datetime.now)
    operation_id: Optional[str] = Field(None, description="ID unique d'opération")
    fees_verification: str = Field("OK: 0% frais", description="Vérification frais")
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
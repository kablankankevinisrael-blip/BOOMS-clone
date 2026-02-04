from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from pydantic import field_validator

# Import avec gestion des erreurs pour éviter les circulaires
try:
    from .payment_schemas import PaymentTransactionResponse
    from .user_schemas import UserResponse
    from .bom_schemas import BomResponse
    from .wallet_schemas import TransactionResponse
except ImportError:
    # Pour éviter les erreurs d'import circulaire
    PaymentTransactionResponse = None
    UserResponse = None
    BomResponse = None
    TransactionResponse = None

class AdminStats(BaseModel):
    """Schéma pour les statistiques admin"""
    total_users: int
    total_boms: int
    active_boms: int
    total_platform_value: float
    total_transactions: Optional[int] = 0
    daily_active_users: Optional[int] = 0

    class Config:
        from_attributes = True

class UserAdminResponse(BaseModel):
    """Schéma utilisateur pour admin (avec plus d'infos)"""
    id: int
    full_name: Optional[str] = None
    phone: str
    email: Optional[str] = None
    is_active: bool
    is_admin: bool
    kyc_status: Optional[str] = "pending"
    created_at: datetime
    wallet_balance: Optional[float] = 0
    total_boms_owned: Optional[int] = 0
    
    class Config:
        from_attributes = True

class AdminTransactionResponse(BaseModel):
    """Transaction avec info utilisateur pour admin"""
    id: int
    user_id: int
    user_phone: str
    user_full_name: Optional[str] = None
    amount: float
    transaction_type: str
    description: str
    status: str
    created_at: datetime
    
    class Config:
        from_attributes = True

class BomAdminCreate(BaseModel):
    """Schéma pour créer un Bom depuis l'admin"""
    title: str
    description: Optional[str] = None
    artist: str
    category: str
    value: float
    cost: float
    stock: Optional[int] = None
    media_url: str
    audio_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    duration: Optional[int] = None
    edition_type: str = "common"
    total_editions: Optional[int] = None
    tags: List[str] = []
    
    class Config:
        from_attributes = True

class AdminGiftResponse(BaseModel):
    """Schéma pour les cadeaux vus par l'admin"""
    id: int
    sender_id: int
    receiver_id: int
    user_bom_id: int
    sender_name: str
    receiver_name: str
    bom_title: str
    bom_image_url: Optional[str] = None
    bom_media_url: Optional[str] = None
    message: Optional[str] = None
    status: str
    sent_at: datetime
    accepted_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class AdminPaymentResponse(BaseModel):
    """Schéma pour les paiements vus par l'admin"""
    id: str
    user_id: int
    user_phone: Optional[str] = None
    type: str
    amount: float
    fees: float
    net_amount: float
    status: str
    provider: str
    provider_reference: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class PlatformAnalytics(BaseModel):
    """Analytiques détaillées de la plateforme"""
    total_users: int
    total_boms: int
    active_boms: int
    total_platform_value: float
    total_transactions: int
    daily_active_users: int
    weekly_growth: float
    monthly_revenue: float
    avg_transaction_value: float
    top_categories: List[dict]
    top_artists: List[dict]
    
    class Config:
        from_attributes = True

class RedistributionRequest(BaseModel):
    """Schéma pour la redistribution de fonds par admin"""
    from_user_id: Optional[int] = None   # Peut être vide si redistribution depuis la plateforme
    to_user_id: int
    amount: float
    reason: str = "manual_redistribution"
    description: Optional[str] = None  # NOUVEAU : Détails supplémentaires

    @field_validator('amount')
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('Le montant doit être positif')
        return v
    
    @field_validator('reason')
    def reason_must_be_valid(cls, v):
        valid_reasons = ['royalties', 'bonus', 'refund', 'correction', 'other']
        if v not in valid_reasons:
            raise ValueError(f'Raison invalide. Doit être parmi: {", ".join(valid_reasons)}')
        return v
        

# ============ SCHÉMAS CAISSE PLATEFORME ============

class TreasuryBalanceResponse(BaseModel):
    """Schéma pour le solde de la caisse plateforme"""
    balance: float
    currency: str
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class TreasuryTransactionResponse(BaseModel):
    """Schéma pour une transaction de la caisse plateforme"""
    id: int
    user_id: int
    user_phone: Optional[str] = None
    user_full_name: Optional[str] = None
    amount: float
    transaction_type: str
    description: str
    created_at: datetime
    
    class Config:
        from_attributes = True

class TreasuryDepositRequest(BaseModel):
    """Schéma pour déposer dans la caisse plateforme"""
    amount: float
    method: str = "wave"
    reference: Optional[str] = None
    
    @field_validator('amount')
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('Le montant doit être positif')
        return v
    
    @field_validator('method')
    def method_must_be_valid(cls, v):
        valid_methods = ['wave', 'stripe', 'orange', 'manual']
        if v not in valid_methods:
            raise ValueError(f'Méthode invalide. Doit être parmi: {", ".join(valid_methods)}')
        return v

class TreasuryWithdrawRequest(BaseModel):
    """Schéma pour retirer de la caisse plateforme"""
    amount: float
    method: str = "wave"
    recipient_phone: Optional[str] = None
    recipient_account: Optional[str] = None
    reference: Optional[str] = None
    
    @field_validator('amount')
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('Le montant doit être positif')
        return v
    
    @field_validator('method')
    def method_must_be_valid(cls, v):
        valid_methods = ['wave', 'stripe', 'orange', 'bank_transfer']
        if v not in valid_methods:
            raise ValueError(f'Méthode invalide. Doit être parmi: {", ".join(valid_methods)}')
        return v

class TreasuryStatsResponse(BaseModel):
    """Statistiques détaillées de la caisse plateforme"""
    current_balance: float
    currency: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    fees_by_category: dict
    total_fees_collected: float
    transaction_count: int
    
    class Config:
        from_attributes = True
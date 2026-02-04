from .auth_schemas import UserLogin, UserRegister, UserCreate, Token, UserResponse

# IMPORT DES NOUVEAUX SCHÉMAS NFT
from .bom_schemas import (
    NFTCreate,           # NOUVEAU : remplace BomCreate
    NFTResponse,         # NOUVEAU : remplace BomResponse  
    UserNFTResponse,     # NOUVEAU : remplace UserBomResponse
    CollectionCreate,    # NOUVEAU : collections NFT
    CollectionResponse   # NOUVEAU : collections NFT
)

from .wallet_schemas import WalletBalance, TransactionResponse, DepositRequest as WalletDepositRequest, WithdrawalRequest
from .purchase_schemas import PurchaseRequest, PurchaseResponse, InventoryItem
from .gift_schemas import GiftRequest, GiftResponse, GiftActionRequest
from .notification_schemas import NotificationResponse, NotificationCreate, NotificationUpdate
from .payment_schemas import (
    DepositRequest, WavePaymentResponse, StripePaymentResponse, 
    PaymentTransactionResponse, DetailedBalanceResponse,
    BomWithdrawalValidationRequest, BomWithdrawalValidationResponse,
    BomWithdrawalExecuteRequest, BomWithdrawalExecuteResponse,
    PaymentMethod, PaymentStatus
)
from .admin_schemas import (
    AdminStats,
    UserAdminResponse,
    AdminTransactionResponse,
    BomAdminCreate,
    AdminGiftResponse,
    AdminPaymentResponse,
    PlatformAnalytics
)
from .support_schemas import (
    SupportThreadCreate,
    SupportMessageCreate,
    SupportThreadStatusUpdateRequest,
    SupportThreadDetailResponse,
    SupportThreadListItem,
    SupportMessageResponse,
)

# ============================================
# ALIAS POUR COMPATIBILITÉ ASCENDANTE
# Les anciens noms pointent vers les nouveaux schémas NFT
# ============================================
BomCreate = NFTCreate
BomResponse = NFTResponse
UserBomResponse = UserNFTResponse

__all__ = [
    # ============ AUTH ============
    "UserLogin", "UserRegister", "UserCreate", "Token", "UserResponse",
    
    # ============ NFT (NOUVEAUX NOMS) ============
    "NFTCreate", "NFTResponse", "UserNFTResponse", 
    "CollectionCreate", "CollectionResponse",
    
    # ============ BOOM (ALIAS POUR COMPATIBILITÉ) ============
    "BomCreate", "BomResponse", "UserBomResponse", 
    
    # ============ WALLET ============
    "WalletBalance", "TransactionResponse", "WalletDepositRequest", "WithdrawalRequest",
    
    # ============ PURCHASE ============
    "PurchaseRequest", "PurchaseResponse", "InventoryItem",
    
    # ============ GIFT ============
    "GiftRequest", "GiftResponse", "GiftActionRequest",
    
    # ============ NOTIFICATION ============
    "NotificationResponse", "NotificationCreate", "NotificationUpdate",
    
    # ============ PAYMENT ============
    "DepositRequest", "WavePaymentResponse", "StripePaymentResponse",
    "PaymentTransactionResponse", "DetailedBalanceResponse",
    "BomWithdrawalValidationRequest", "BomWithdrawalValidationResponse",
    "BomWithdrawalExecuteRequest", "BomWithdrawalExecuteResponse",
    "PaymentMethod", "PaymentStatus",
    
    # ============ ADMIN ============
    "AdminStats",
    "UserAdminResponse", 
    "AdminTransactionResponse",
    "BomAdminCreate",
    "AdminGiftResponse",
    "AdminPaymentResponse",
    "PlatformAnalytics",

    # ============ SUPPORT ============
    "SupportThreadCreate",
    "SupportMessageCreate",
    "SupportThreadStatusUpdateRequest",
    "SupportThreadDetailResponse",
    "SupportThreadListItem",
    "SupportMessageResponse",
]
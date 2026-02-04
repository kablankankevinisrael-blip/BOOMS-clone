from sqlalchemy import Column, Integer, String, DateTime, Numeric, Boolean, Text, ForeignKey, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
import enum
from app.database import Base

# CORRECTION: Ajout de l'Enum pour les types de transaction
class TransactionType(enum.Enum):
    """Enumération des types de transaction"""
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    PURCHASE = "purchase"
    TRANSFER = "transfer"
    REFUND = "refund"
    ROYALTIES = "royalties"
    BONUS = "bonus"
    CORRECTION = "correction"
    OTHER_REDISTRIBUTION = "other_redistribution"
    NFT_PURCHASE = "nft_purchase"
    BOOM_PURCHASE = "boom_purchase"
    BOOM_SELL = "boom_sell"
    GIFT_FEE = "gift_fee"
    COMMISSION = "commission"


class UserStatus(enum.Enum):
    """États métier supportés pour les comptes clients."""
    ACTIVE = "active"
    REVIEW = "review"
    LIMITED = "limited"
    SUSPENDED = "suspended"
    BANNED = "banned"

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String)
    kyc_status = Column(String, default="pending")
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    # 🔐 CORRECTION: native_enum=True pour PostgreSQL accepte les valeurs minuscules directement
    status = Column(Enum(UserStatus, name="userstatus", native_enum=True), nullable=False, server_default=UserStatus.ACTIVE.value)
    status_reason = Column(String(255))
    status_message = Column(Text)
    status_source = Column(String(64), default="manual")
    status_metadata = Column(JSONB, default=dict)
    status_expires_at = Column(DateTime(timezone=True))
    last_status_changed_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    status_changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    suspended_until = Column(DateTime(timezone=True))
    suspension_count = Column(Integer, default=0)
    last_suspension_at = Column(DateTime(timezone=True))
    banned_at = Column(DateTime(timezone=True))
    banned_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # AJOUT: Relations pour le système de paiement
    cash_balance = relationship("CashBalance", back_populates="user", uselist=False, cascade="all, delete-orphan")
    payment_transactions = relationship("PaymentTransaction", back_populates="user")
    bom_withdrawal_requests = relationship("BomWithdrawalRequest", back_populates="user")
    status_changed_by_user = relationship(
        "User",
        remote_side=[id],
        foreign_keys=[status_changed_by],
        post_update=True
    )
    support_threads = relationship(
        "SupportThread",
        back_populates="user",
        foreign_keys="SupportThread.user_id"
    )
    support_messages = relationship(
        "SupportMessage",
        back_populates="sender",
        foreign_keys="SupportMessage.sender_id"
    )
    
    def set_password(self, password: str):
        # Import différé pour éviter les circulaires
        from app.services.auth import get_password_hash
        self.password_hash = get_password_hash(password)
    
    def check_password(self, password: str) -> bool:
        # Import différé pour éviter les circulaires
        from app.services.auth import verify_password
        return verify_password(password, self.password_hash)

class Wallet(Base):
    __tablename__ = "wallets"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    balance = Column(Numeric(12, 2), default=0.00)
    currency = Column(String, default="FCFA")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class UserTransaction(Base):
    __tablename__ = "user_transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    # CORRECTION: Utilisation de l'Enum pour le type de transaction
    transaction_type = Column(Enum(TransactionType), nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String(20), default="completed")
    transaction_data = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relation
    user = relationship("User")
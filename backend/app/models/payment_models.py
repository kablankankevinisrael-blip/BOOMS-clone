from sqlalchemy import Column, Integer, String, DateTime, Numeric, Boolean, ForeignKey, Enum, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from app.database import Base
import enum

class PaymentMethod(str, enum.Enum):
    WAVE = "wave"
    STRIPE = "stripe"
    ORANGE_MONEY = "orange_money"

class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class CashBalance(Base):
    """Solde liquide réel de l'utilisateur"""
    __tablename__ = "cash_balances"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, index=True)
    available_balance = Column(Numeric(12, 2), default=0.00)
    locked_balance = Column(Numeric(12, 2), default=0.00)
    currency = Column(String, default="FCFA")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # AJOUT: Méthode de validation
    def __init__(self, **kwargs):
        # Forcer la devise FCFA si autre chose est fourni
        if 'currency' in kwargs and kwargs['currency'] != "FCFA":
            kwargs['currency'] = "FCFA"
        super().__init__(**kwargs)
    
    user = relationship("User", back_populates="cash_balance")

class PaymentTransaction(Base):
    """Transactions de paiement réelles"""
    __tablename__ = "payment_transactions"
    
    id = Column(String, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    type = Column(String, nullable=False)  # 'deposit', 'withdrawal', 'bom_purchase', 'bom_withdrawal'
    amount = Column(Numeric(12, 2), nullable=False)
    fees = Column(Numeric(12, 2), default=0.00)
    net_amount = Column(Numeric(12, 2), nullable=False)
    status = Column(Enum(PaymentStatus), default=PaymentStatus.PENDING)
    provider = Column(String)  # 'wave', 'stripe', 'system'
    provider_reference = Column(String)
    description = Column(Text)
    
    # Pour retraits Boms - tracking complet
    boom_id = Column(Integer, ForeignKey("bom_assets.id"), nullable=True, index=True)
    user_bom_id = Column(Integer, ForeignKey("user_boms.id"), nullable=True, index=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    user = relationship("User", back_populates="payment_transactions")
    user_bom = relationship("UserBom")

class BomWithdrawalRequest(Base):
    """Demandes de retrait de Boms"""
    __tablename__ = "bom_withdrawal_requests"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    user_bom_id = Column(Integer, ForeignKey("user_boms.id"), index=True)
    requested_amount = Column(Numeric(12, 2))
    fees = Column(Numeric(12, 2))
    net_amount = Column(Numeric(12, 2))
    status = Column(String, default="pending")  # 'pending', 'approved', 'rejected', 'processed'
    security_check = Column(JSONB, default={})
    rejection_reason = Column(Text)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)
    
    user = relationship("User")
    user_bom = relationship("UserBom")
from sqlalchemy import Column, Integer, String, DateTime, Numeric, Boolean, Text, JSON, ForeignKey
from sqlalchemy.sql import func
from app.database import Base

class Transaction(Base):
    __tablename__ = "transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    type = Column(String, nullable=False)
    transaction_type = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String, default="FCFA")
    status = Column(String, default="pending")
    reference = Column(String, unique=True, index=True)
    provider_reference = Column(String, nullable=True)
    transaction_data = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())
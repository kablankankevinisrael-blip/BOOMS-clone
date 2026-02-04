"""
MODÈLES ADMINISTRATEURS - AVEC SUPPORT POUR LES LOGS DE FRAIS DÉTAILLÉS
"""
from sqlalchemy import Column, Integer, String, Text, JSON, DateTime, Numeric, Index
from sqlalchemy.sql import func
from decimal import Decimal
from app.database import Base

class AdminLog(Base):
    """
    Logs d'actions administratives avec support détaillé pour les frais financiers
    """
    __tablename__ = "admin_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, nullable=False, index=True)
    action = Column(String(100), nullable=False, index=True)
    details = Column(JSON, nullable=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    fees_amount = Column(Numeric(12, 2), default=Decimal('0.00'), nullable=False)  # ⬅️ AJOUT: Montant des frais
    fees_currency = Column(String(10), default="FCFA", nullable=False)  # ⬅️ AJOUT: Devise des frais
    fees_description = Column(Text, nullable=True)  # ⬅️ AJOUT: Description des frais
    related_transaction_id = Column(String(100), nullable=True, index=True)  # ⬅️ AJOUT: ID transaction associée
    related_user_id = Column(Integer, nullable=True, index=True)  # ⬅️ AJOUT: ID utilisateur concerné
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Index composites pour optimiser les requêtes de reporting
    __table_args__ = (
        Index('idx_admin_logs_admin_action', 'admin_id', 'action'),
        Index('idx_admin_logs_fees', 'fees_amount', 'created_at'),
        Index('idx_admin_logs_created_at', 'created_at'),
    )
    
    def __repr__(self):
        return f"<AdminLog id={self.id} action={self.action} admin={self.admin_id} fees={self.fees_amount}>"
    
    def to_dict(self):
        """Convertir en dictionnaire pour l'API"""
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "action": self.action,
            "details": self.details or {},
            "fees": {
                "amount": str(self.fees_amount),
                "currency": self.fees_currency,
                "description": self.fees_description
            } if self.fees_amount > 0 else None,
            "related_ids": {
                "transaction": self.related_transaction_id,
                "user": self.related_user_id
            } if self.related_transaction_id or self.related_user_id else None,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
    
    @classmethod
    def create_fee_log(cls, admin_id: int, action: str, fees_amount: Decimal, 
                      fees_description: str = "", related_transaction_id: str = None,
                      related_user_id: int = None, details: dict = None):
        """Créer un log spécialisé pour les frais financiers"""
        return cls(
            admin_id=admin_id,
            action=action,
            details=details or {},
            fees_amount=fees_amount,
            fees_currency="FCFA",
            fees_description=fees_description,
            related_transaction_id=related_transaction_id,
            related_user_id=related_user_id
        )
    
    @classmethod
    def create_audit_log(cls, admin_id: int, action: str, details: dict = None,
                        ip_address: str = None, user_agent: str = None):
        """Créer un log d'audit standard (sans frais)"""
        return cls(
            admin_id=admin_id,
            action=action,
            details=details or {},
            ip_address=ip_address,
            user_agent=user_agent,
            fees_amount=Decimal('0.00')
        )

class PlatformTreasury(Base):
    """
    Modèle de caisse plateforme pour centraliser tous les revenus
    (frais de transaction, commissions, etc.)
    """
    __tablename__ = "platform_treasury"
    
    id = Column(Integer, primary_key=True, index=True)
    balance = Column(Numeric(20, 2), default=Decimal('0.00'), nullable=False)
    currency = Column(String(10), default="FCFA", nullable=False)
    total_fees_collected = Column(Numeric(20, 2), default=Decimal('0.00'), nullable=False)  # ⬅️ AJOUT: Total frais
    total_transactions = Column(Integer, default=0, nullable=False)  # ⬅️ AJOUT: Nombre transactions
    last_transaction_at = Column(DateTime(timezone=True), nullable=True)  # ⬅️ AJOUT: Dernière transaction
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Index pour optimiser les requêtes
    __table_args__ = (
        Index('idx_treasury_balance', 'balance'),
        Index('idx_treasury_updated', 'updated_at'),
    )
    
    def __repr__(self):
        return f"<PlatformTreasury(balance={self.balance} {self.currency} fees={self.total_fees_collected})>"
    
    def to_dict(self):
        """Convertir en dictionnaire pour l'API"""
        return {
            "id": self.id,
            "balance": str(self.balance),
            "currency": self.currency,
            "statistics": {
                "total_fees_collected": str(self.total_fees_collected),
                "total_transactions": self.total_transactions,
                "average_fee_per_transaction": str(self.total_fees_collected / max(self.total_transactions, 1))
            },
            "last_transaction_at": self.last_transaction_at.isoformat() if self.last_transaction_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
    
    def add_fees(self, amount: Decimal, transaction_count: int = 1):
        """Ajouter des frais à la caisse et mettre à jour les statistiques"""
        if amount > 0:
            self.balance += amount
            self.total_fees_collected += amount
            self.total_transactions += transaction_count
            self.last_transaction_at = func.now()
            return True
        return False
    
    def withdraw(self, amount: Decimal, description: str = ""):
        """Retirer des fonds de la caisse (pour paiements, redistributions, etc.)"""
        if amount <= 0:
            raise ValueError("Le montant de retrait doit être positif")
        
        if self.balance < amount:
            raise ValueError(f"Solde insuffisant: {self.balance} {self.currency} < {amount} {self.currency}")
        
        self.balance -= amount
        self.last_transaction_at = func.now()
        
        return {
            "success": True,
            "amount": str(amount),
            "new_balance": str(self.balance),
            "description": description
        }
    
    def get_stats(self, period_days: int = 30):
        """Obtenir des statistiques pour une période donnée"""
        from datetime import datetime, timedelta
        from app.models.admin_models import AdminLog
        
        # Cette méthode serait complétée dans le service correspondant
        # pour récupérer les logs de frais sur la période
        return {
            "period_days": period_days,
            "current_balance": str(self.balance),
            "total_fees_collected": str(self.total_fees_collected),
            "total_transactions": self.total_transactions
        }

class FeeCategory(Base):
    """
    Catégorisation des frais pour une meilleure traçabilité
    """
    __tablename__ = "fee_categories"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    default_percentage = Column(Numeric(5, 3), nullable=True)  # Pourcentage par défaut
    min_amount = Column(Numeric(12, 2), nullable=True)  # Montant minimum
    max_amount = Column(Numeric(12, 2), nullable=True)  # Montant maximum
    is_active = Column(Numeric(1, 0), default=1, nullable=False)  # 1=actif, 0=inactif
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    def __repr__(self):
        return f"<FeeCategory id={self.id} name={self.name} percentage={self.default_percentage}>"
    
    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "default_percentage": float(self.default_percentage) if self.default_percentage else None,
            "min_amount": str(self.min_amount) if self.min_amount else None,
            "max_amount": str(self.max_amount) if self.max_amount else None,
            "is_active": bool(self.is_active),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class TreasuryTransactionLog(Base):
    """
    Log détaillé des transactions de la caisse plateforme
    """
    __tablename__ = "treasury_transaction_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    treasury_id = Column(Integer, nullable=False, index=True)
    transaction_type = Column(String(50), nullable=False, index=True)  # 'deposit', 'withdrawal', 'fee_collection'
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(10), default="FCFA", nullable=False)
    description = Column(Text, nullable=True)
    related_admin_log_id = Column(Integer, nullable=True, index=True)
    related_user_id = Column(Integer, nullable=True, index=True)
    fee_category_id = Column(Integer, nullable=True, index=True)
    meta_data = Column(JSON, nullable=True)  # Données supplémentaires
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Index pour les requêtes de reporting
    __table_args__ = (
        Index('idx_treasury_tx_type_date', 'transaction_type', 'created_at'),
        Index('idx_treasury_tx_amount', 'amount', 'created_at'),
        Index('idx_treasury_tx_user', 'related_user_id', 'created_at'),
    )
    
    def __repr__(self):
        return f"<TreasuryTransactionLog id={self.id} type={self.transaction_type} amount={self.amount}>"
    
    def to_dict(self):
        return {
            "id": self.id,
            "treasury_id": self.treasury_id,
            "transaction_type": self.transaction_type,
            "amount": str(self.amount),
            "currency": self.currency,
            "description": self.description,
            "related_ids": {
                "admin_log": self.related_admin_log_id,
                "user": self.related_user_id,
                "fee_category": self.fee_category_id
            },
            "metadata": self.metadata or {},
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
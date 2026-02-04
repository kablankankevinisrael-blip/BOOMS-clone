from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base
import json
from datetime import datetime


class PlatformSettings(Base):
    """Paramètres de configuration de la plateforme"""
    
    __tablename__ = "platform_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # === PARAMÈTRES GÉNÉRAUX ===
    platform_name = Column(String(255), default="BOOMS")
    platform_description = Column(String(1000), nullable=True)
    support_email = Column(String(255), default="support@booms.app")
    support_phone = Column(String(20), nullable=True)
    
    # === FRAIS DE TRANSACTION ===
    transaction_fee_percent = Column(Float, default=2.5)  # Pourcentage des frais
    minimum_transaction = Column(Float, default=500.0)  # Montant minimum de transaction
    maximum_transaction = Column(Float, default=5000000.0)  # Montant maximum
    
    # === FRAIS DE PAIEMENT PAR MÉTHODE ===
    wave_fee_percent = Column(Float, default=3.5)
    orange_money_fee_percent = Column(Float, default=4.0)
    stripe_fee_percent = Column(Float, default=2.9)
    
    # === DÉPÔTS/RETRAITS ===
    minimum_deposit = Column(Float, default=1000.0)
    maximum_deposit = Column(Float, default=2000000.0)
    minimum_withdrawal = Column(Float, default=1000.0)
    maximum_withdrawal = Column(Float, default=1000000.0)
    withdrawal_processing_time_hours = Column(Integer, default=24)
    
    # === NOTIFICATIONS ===
    notify_on_transaction = Column(Boolean, default=True)
    notify_on_deposit = Column(Boolean, default=True)
    notify_on_withdrawal = Column(Boolean, default=True)
    notify_on_gift = Column(Boolean, default=True)
    email_notifications_enabled = Column(Boolean, default=True)
    sms_notifications_enabled = Column(Boolean, default=True)
    
    # === SÉCURITÉ ===
    require_2fa = Column(Boolean, default=False)
    max_login_attempts = Column(Integer, default=5)
    lockout_duration_minutes = Column(Integer, default=30)
    session_timeout_minutes = Column(Integer, default=60)
    password_min_length = Column(Integer, default=8)
    
    # === AUTRES PARAMÈTRES ===
    maintenance_mode = Column(Boolean, default=False)
    maintenance_message = Column(String(500), nullable=True)
    extra_settings = Column(JSON, nullable=True, default={})
    
    # === TIMESTAMPS ===
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    def to_dict(self):
        """Convertir en dictionnaire"""
        return {
            'id': self.id,
            'platform_name': self.platform_name,
            'platform_description': self.platform_description,
            'support_email': self.support_email,
            'support_phone': self.support_phone,
            'transaction_fee_percent': self.transaction_fee_percent,
            'minimum_transaction': self.minimum_transaction,
            'maximum_transaction': self.maximum_transaction,
            'wave_fee_percent': self.wave_fee_percent,
            'orange_money_fee_percent': self.orange_money_fee_percent,
            'stripe_fee_percent': self.stripe_fee_percent,
            'minimum_deposit': self.minimum_deposit,
            'maximum_deposit': self.maximum_deposit,
            'minimum_withdrawal': self.minimum_withdrawal,
            'maximum_withdrawal': self.maximum_withdrawal,
            'withdrawal_processing_time_hours': self.withdrawal_processing_time_hours,
            'notify_on_transaction': self.notify_on_transaction,
            'notify_on_deposit': self.notify_on_deposit,
            'notify_on_withdrawal': self.notify_on_withdrawal,
            'notify_on_gift': self.notify_on_gift,
            'email_notifications_enabled': self.email_notifications_enabled,
            'sms_notifications_enabled': self.sms_notifications_enabled,
            'require_2fa': self.require_2fa,
            'max_login_attempts': self.max_login_attempts,
            'lockout_duration_minutes': self.lockout_duration_minutes,
            'session_timeout_minutes': self.session_timeout_minutes,
            'password_min_length': self.password_min_length,
            'maintenance_mode': self.maintenance_mode,
            'maintenance_message': self.maintenance_message,
            'extra_settings': self.extra_settings or {},
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

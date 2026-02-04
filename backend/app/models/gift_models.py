from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey, Enum, UniqueConstraint, Numeric, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import enum
import uuid
import time

class GiftStatus(enum.Enum):
    SENT = "SENT"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    EXPIRED = "EXPIRED"
    
    # NOUVEAUX STATUTS POUR LE FLOW CORRIGÉ
    CREATED = "CREATED"      # Cadeau créé, pas encore payé
    PAID = "PAID"            # Sender débité
    DELIVERED = "DELIVERED"  # Receiver crédité + plateforme
    FAILED = "FAILED"        # Échec complet (rollback)

class GiftTransaction(Base):
    __tablename__ = "gift_transactions"
    
    # ============ CHAMPS EXISTANTS (inchangés) ============
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    user_bom_id = Column(Integer, ForeignKey("user_boms.id"), nullable=False)
    message = Column(Text, nullable=True)
    status = Column(Enum(GiftStatus), default=GiftStatus.SENT)
    fees = Column(Numeric(12, 2), default=0.00)
    
    # ============ NOUVEAUX CHAMPS FINANCIERS (NULLABLE pour migration) ============
    gross_amount = Column(Numeric(12, 2), nullable=True)    # Montant total payé par sender
    fee_amount = Column(Numeric(12, 2), nullable=True)      # Frais plateforme
    net_amount = Column(Numeric(12, 2), nullable=True)      # Montant net reçu
    
    # ============ RÉFÉRENCE MÉTIER (générée par le service) ============
    transaction_reference = Column(
        String(100), 
        nullable=True,        # Les anciens cadeaux seront NULL
        unique=True, 
        index=True
        # PAS DE DEFAULT ICI - sera générée par gift_service.py
    )
    
    # IDs des transactions wallet associées
    wallet_transaction_ids = Column(JSON, nullable=True, default=list)
    
    # ============ TIMESTAMPS EXISTANTS ============
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    
    # ============ NOUVEAUX TIMESTAMPS MÉTIER ============
    paid_at = Column(DateTime(timezone=True), nullable=True)       # Quand le sender a payé
    delivered_at = Column(DateTime(timezone=True), nullable=True)  # Quand le receiver a reçu
    failed_at = Column(DateTime(timezone=True), nullable=True)     # Quand l'opération a échoué
    
    # ============ RELATIONS (inchangées) ============
    sender = relationship("User", foreign_keys=[sender_id], backref="sent_gifts")
    receiver = relationship("User", foreign_keys=[receiver_id], backref="received_gifts")
    user_bom = relationship("UserBom", backref="gift_transactions")
    
    # ============ MÉTHODES UTILITAIRES ============
    @property
    def is_new_flow(self):
        """Vrai si ce gift utilise le nouveau flow (gross/net amounts)"""
        return self.gross_amount is not None and self.net_amount is not None
    
    @property
    def is_legacy(self):
        """Vrai si c'est un cadeau créé avant la migration"""
        return not self.is_new_flow
    
    @property
    def is_successfully_delivered(self):
        """Vrai si le cadeau a été livré (nouveau flow)"""
        return self.status == GiftStatus.DELIVERED
    
    @property
    def has_failed(self):
        """Vrai si l'opération a échoué (nouveau flow)"""
        return self.status == GiftStatus.FAILED
    
    def generate_transaction_reference(self):
        """
        Génère une référence transaction unique.
        Format: GIFT-TIMESTAMP-UUID
        Exemple: GIFT-1704067200000-ABC123DEF456
        """
        timestamp = int(time.time() * 1000)  # Millisecondes
        unique_id = uuid.uuid4().hex[:12].upper()  # 12 caractères hex
        return f"GIFT-{timestamp}-{unique_id}"
    
    def calculate_fee_percentage(self):
        """Calcule le pourcentage de frais"""
        if self.gross_amount and self.gross_amount > 0:
            return (self.fee_amount / self.gross_amount) * 100
        return 0.0
        
    def to_audit_dict(self):
        """Format pour logs d'audit"""
        return {
            "gift_id": self.id,
            "transaction_reference": self.transaction_reference,
            "sender_id": self.sender_id,
            "receiver_id": self.receiver_id,
            "amounts": {
                "gross": float(self.gross_amount) if self.gross_amount else None,
                "fee": float(self.fee_amount) if self.fee_amount else None,
                "net": float(self.net_amount) if self.net_amount else None
            },
            "status": self.status,
            "wallet_transaction_ids": self.wallet_transaction_ids or [],
            "timestamps": {
                "created": self.sent_at.isoformat() if self.sent_at else None,
                "paid": self.paid_at.isoformat() if self.paid_at else None,
                "delivered": self.delivered_at.isoformat() if self.delivered_at else None,
                "failed": self.failed_at.isoformat() if self.failed_at else None
            }
        }
        
    def validate_status_transition(self, new_status: GiftStatus) -> bool:
        """
        Valide les transitions de statut - SÉPARATION CLAIRE LEGACY/NEW
        Retourne True si la transition est autorisée
        """
        # NOUVEAU FLOW (avec argent réel)
        new_flow_transitions = {
            GiftStatus.CREATED: [GiftStatus.PAID, GiftStatus.FAILED],
            GiftStatus.PAID: [GiftStatus.DELIVERED, GiftStatus.FAILED],
            GiftStatus.DELIVERED: [],  # État terminal
            GiftStatus.FAILED: [],     # État terminal
        }
        
        # LEGACY FLOW (ancien système sans argent)
        legacy_flow_transitions = {
            GiftStatus.SENT: [GiftStatus.ACCEPTED, GiftStatus.DECLINED, GiftStatus.EXPIRED],
            GiftStatus.ACCEPTED: [],
            GiftStatus.DECLINED: [],
            GiftStatus.EXPIRED: []
        }
        
        # Déterminer quel flow utiliser
        if self.is_new_flow:
            allowed = new_flow_transitions.get(self.status, [])
        else:
            allowed = legacy_flow_transitions.get(self.status, [])
        
        return new_status in allowed

    def transition_to(self, new_status: GiftStatus) -> None:
        """
        Effectue une transition de statut avec validation
        Lève une exception si la transition est invalide
        """
        if not self.validate_status_transition(new_status):
            raise ValueError(
                f"Transition de statut invalide: {self.status.value} → {new_status.value}. "
                f"Utilise is_new_flow: {self.is_new_flow}"
            )
        
        self.status = new_status

class Contact(Base):
    __tablename__ = "contacts"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    contact_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    nickname = Column(String(100), nullable=True)
    is_favorite = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relations
    user = relationship("User", foreign_keys=[user_id], backref="user_contacts")
    contact_user = relationship("User", foreign_keys=[contact_user_id], backref="contact_of_users")
    
    # Contrainte d'unicité
    __table_args__ = (UniqueConstraint('user_id', 'contact_user_id', name='unique_contact'),)
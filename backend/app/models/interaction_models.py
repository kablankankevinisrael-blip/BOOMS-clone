"""
MODÈLES POUR LES INTERACTIONS UTILISATEUR (LIKE, SHARE)
Enregistre toutes les interactions pour calculer la valeur sociale
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base


class UserInteraction(Base):
    """
    Enregistre les interactions utilisateur avec les BOOMs (likes, shares).
    Utilisé pour calculer la valeur sociale et les métriques d'engagement.
    """
    __tablename__ = "user_interactions"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Utilisateur et BOOM concernés
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    boom_id = Column(Integer, ForeignKey("bom_assets.id"), nullable=False, index=True)
    
    # Type d'interaction
    action_type = Column(String(50), nullable=False, index=True)  # 'like', 'share', 'view', etc.
    
    # Métadonnées
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    metadata_json = Column(String(500), nullable=True)  # Infos supplémentaires (plateforme de partage, etc.)
    
    # Flag pour savoir si l'interaction a été traitée
    processed = Column(Boolean, default=False, nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relations
    user = relationship("User", backref="interactions")
    boom = relationship("BomAsset", backref="interactions")
    
    # Index composites pour optimiser les requêtes fréquentes
    __table_args__ = (
        Index('idx_user_boom_action', 'user_id', 'boom_id', 'action_type'),
        Index('idx_boom_action_date', 'boom_id', 'action_type', 'created_at'),
        Index('idx_unprocessed', 'processed', 'created_at'),
    )
    
    def __repr__(self):
        return f"<UserInteraction(user={self.user_id}, boom={self.boom_id}, action={self.action_type})>"

"""
SERVICE D'INTERACTIONS UTILISATEUR
Gère les likes, shares et autres interactions avec les BOOMs
"""

import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import Optional, Dict, List
from decimal import Decimal

from app.models.interaction_models import UserInteraction
from app.models.bom_models import BomAsset

logger = logging.getLogger(__name__)


class InteractionService:
    """Service pour gérer les interactions utilisateur (like, share, etc.)"""
    
    # Valeurs d'impact sur la valeur sociale
    IMPACT_VALUES = {
        'like': Decimal('0.10'),        # +0.10 FCFA par like
        'share': Decimal('0.50'),       # +0.50 FCFA par partage social
        'share_internal': Decimal('0'), # Impact défini dynamiquement côté service cadeau
        'view': Decimal('0.01'),        # +0.01 FCFA par vue (si implémenté)
        'comment': Decimal('0.20'),     # +0.20 FCFA par commentaire (si implémenté)
    }
    
    @staticmethod
    def record_interaction(
        db: Session,
        user_id: int,
        boom_id: int,
        action_type: str,
        metadata: Optional[str] = None,
        impact_override: Optional[Decimal] = None,
        auto_commit: bool = True
    ) -> Dict:
        """
        Enregistre une interaction utilisateur et met à jour la valeur sociale.
        
        Args:
            db: Session de base de données
            user_id: ID de l'utilisateur
            boom_id: ID du BOOM
            action_type: Type d'action ('like', 'share', etc.)
            metadata: Métadonnées optionnelles (JSON string)
        
        Returns:
            Dict avec les informations de l'interaction et la nouvelle valeur sociale
        """
        try:
            logger.info(f"📊 Enregistrement interaction: user={user_id}, boom={boom_id}, action={action_type}")
            
            # Vérifier si le BOOM existe
            boom = db.query(BomAsset).filter(BomAsset.id == boom_id).first()
            if not boom:
                logger.error(f"❌ BOOM #{boom_id} introuvable")
                return {"success": False, "error": "BOOM introuvable"}
            
            # Pour les likes, vérifier si l'utilisateur a déjà liké
            if action_type == 'like':
                existing_like = db.query(UserInteraction).filter(
                    and_(
                        UserInteraction.user_id == user_id,
                        UserInteraction.boom_id == boom_id,
                        UserInteraction.action_type == 'like'
                    )
                ).first()
                
                # Si le like existe déjà, on le supprime (toggle)
                if existing_like:
                    logger.info(f"🔄 Unlike détecté - suppression du like existant")
                    db.delete(existing_like)
                    
                    # Décrémenter les compteurs
                    boom.interaction_count = max(0, (boom.interaction_count or 0) - 1)
                    
                    # Retirer l'impact sur la valeur sociale
                    impact = InteractionService.IMPACT_VALUES.get(action_type, Decimal('0'))
                    old_social_value = boom.current_social_value or Decimal('0')
                    new_social_value = max(Decimal('0'), old_social_value - impact)
                    boom.current_social_value = new_social_value
                    boom.social_value = new_social_value
                    boom.sync_social_totals()
                    display_total = boom.get_display_total_value()
                    boom.total_value = display_total
                    boom.current_price = display_total
                    boom.value = display_total
                    
                    if auto_commit:
                        db.commit()
                        db.refresh(boom)
                    else:
                        db.flush()
                    
                    return {
                        "success": True,
                        "action": "unlike",
                        "boom_id": boom_id,
                        "old_social_value": float(old_social_value),
                        "new_social_value": float(new_social_value),
                        "delta": float(-impact),
                        "message": "Like retiré avec succès"
                    }
            
            # Créer l'interaction
            interaction = UserInteraction(
                user_id=user_id,
                boom_id=boom_id,
                action_type=action_type,
                metadata_json=metadata,
                processed=False
            )
            db.add(interaction)
            
            # Mettre à jour les compteurs du BOOM
            boom.interaction_count = (boom.interaction_count or 0) + 1
            boom.last_interaction_at = datetime.utcnow()
            
            if action_type == 'share':
                boom.share_count = (boom.share_count or 0) + 1
                boom.share_count_24h = (boom.share_count_24h or 0) + 1
                boom.total_shares = (boom.total_shares or 0) + 1
            
            # Calculer l'impact sur la valeur sociale
            if impact_override is not None:
                impact = impact_override
            else:
                impact = InteractionService.IMPACT_VALUES.get(action_type, Decimal('0'))
            old_social_value = boom.current_social_value or Decimal('0')
            new_social_value = old_social_value + impact
            
            # Mettre à jour les valeurs
            boom.current_social_value = new_social_value
            boom.social_value = new_social_value
            boom.sync_social_totals()
            display_total = boom.get_display_total_value()
            boom.total_value = display_total
            boom.current_price = display_total
            boom.value = display_total
            
            # Commit
            if auto_commit:
                db.commit()
                db.refresh(interaction)
                db.refresh(boom)
            else:
                db.flush()
            
            logger.info(f"✅ Interaction enregistrée avec succès")
            logger.info(f"   Impact: +{impact} FCFA")
            logger.info(f"   Valeur sociale: {old_social_value} → {new_social_value}")
            
            return {
                "success": True,
                "interaction_id": interaction.id,
                "action": action_type,
                "boom_id": boom_id,
                "boom_title": boom.title,
                "old_social_value": float(old_social_value),
                "new_social_value": float(new_social_value),
                "delta": float(impact),
                "total_value": float(boom.total_value),
                "interaction_count": boom.interaction_count,
                "share_count": boom.share_count if action_type == 'share' else None,
                "message": f"Interaction '{action_type}' enregistrée avec succès"
            }
            
        except Exception as e:
            logger.error(f"❌ Erreur lors de l'enregistrement de l'interaction: {e}", exc_info=True)
            if auto_commit:
                db.rollback()
            return {
                "success": False,
                "error": str(e)
            }
    
    @staticmethod
    def get_user_interactions(
        db: Session,
        user_id: int,
        boom_id: Optional[int] = None,
        action_type: Optional[str] = None,
        limit: int = 100
    ) -> List[UserInteraction]:
        """Récupérer les interactions d'un utilisateur"""
        query = db.query(UserInteraction).filter(UserInteraction.user_id == user_id)
        
        if boom_id:
            query = query.filter(UserInteraction.boom_id == boom_id)
        if action_type:
            query = query.filter(UserInteraction.action_type == action_type)
        
        return query.order_by(UserInteraction.created_at.desc()).limit(limit).all()
    
    @staticmethod
    def get_boom_interactions(
        db: Session,
        boom_id: int,
        action_type: Optional[str] = None,
        hours: Optional[int] = None
    ) -> List[UserInteraction]:
        """Récupérer les interactions sur un BOOM"""
        query = db.query(UserInteraction).filter(UserInteraction.boom_id == boom_id)
        
        if action_type:
            query = query.filter(UserInteraction.action_type == action_type)
        
        if hours:
            cutoff = datetime.utcnow() - timedelta(hours=hours)
            query = query.filter(UserInteraction.created_at >= cutoff)
        
        return query.order_by(UserInteraction.created_at.desc()).all()
    
    @staticmethod
    def get_interaction_stats(db: Session, boom_id: int) -> Dict:
        """Obtenir les statistiques d'interaction pour un BOOM"""
        try:
            # Total des interactions par type
            total_stats = db.query(
                UserInteraction.action_type,
                func.count(UserInteraction.id).label('count')
            ).filter(
                UserInteraction.boom_id == boom_id
            ).group_by(
                UserInteraction.action_type
            ).all()
            
            # Interactions des dernières 24h
            cutoff_24h = datetime.utcnow() - timedelta(hours=24)
            stats_24h = db.query(
                UserInteraction.action_type,
                func.count(UserInteraction.id).label('count')
            ).filter(
                and_(
                    UserInteraction.boom_id == boom_id,
                    UserInteraction.created_at >= cutoff_24h
                )
            ).group_by(
                UserInteraction.action_type
            ).all()
            
            # Utilisateurs uniques
            unique_users = db.query(
                func.count(func.distinct(UserInteraction.user_id))
            ).filter(
                UserInteraction.boom_id == boom_id
            ).scalar() or 0
            
            return {
                "boom_id": boom_id,
                "total": {row.action_type: row.count for row in total_stats},
                "last_24h": {row.action_type: row.count for row in stats_24h},
                "unique_users": unique_users
            }
            
        except Exception as e:
            logger.error(f"❌ Erreur lors de la récupération des stats: {e}")
            return {"error": str(e)}
    
    @staticmethod
    def has_user_liked(db: Session, user_id: int, boom_id: int) -> bool:
        """Vérifier si un utilisateur a liké un BOOM"""
        return db.query(UserInteraction).filter(
            and_(
                UserInteraction.user_id == user_id,
                UserInteraction.boom_id == boom_id,
                UserInteraction.action_type == 'like'
            )
        ).first() is not None
    
    @staticmethod
    async def reset_24h_counters(db: Session):
        """
        Réinitialiser les compteurs 24h (à exécuter via cron/scheduler).
        """
        try:
            logger.info("🔄 Réinitialisation des compteurs 24h...")
            
            db.query(BomAsset).update({
                BomAsset.share_count_24h: 0,
                BomAsset.buy_count_24h: 0
            })
            
            db.commit()
            logger.info("✅ Compteurs 24h réinitialisés avec succès")
            
        except Exception as e:
            logger.error(f"❌ Erreur lors de la réinitialisation des compteurs: {e}")
            db.rollback()


# Instance singleton
interaction_service = InteractionService()

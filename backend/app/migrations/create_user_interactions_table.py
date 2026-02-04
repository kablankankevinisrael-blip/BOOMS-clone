"""
MIGRATION: Créer la table user_interactions
Pour enregistrer les likes, shares et autres interactions utilisateur
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import create_engine, text
from app.config import settings
from app.database import Base
from app.models.interaction_models import UserInteraction
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def migrate():
    """Créer la table user_interactions avec tous les index"""
    try:
        logger.info("🔄 Création de la table user_interactions...")
        
        engine = create_engine(settings.DATABASE_URL)
        
        # Créer la table
        UserInteraction.__table__.create(engine, checkfirst=True)
        
        logger.info("✅ Table user_interactions créée avec succès")
        logger.info("   Colonnes:")
        logger.info("   - id (primary key)")
        logger.info("   - user_id (foreign key -> users)")
        logger.info("   - boom_id (foreign key -> bom_assets)")
        logger.info("   - action_type (like, share, view, etc.)")
        logger.info("   - created_at (timestamp)")
        logger.info("   - metadata (optionnel)")
        logger.info("   - processed (boolean)")
        logger.info("   - processed_at (timestamp)")
        logger.info("   Index créés:")
        logger.info("   - idx_user_boom_action")
        logger.info("   - idx_boom_action_date")
        logger.info("   - idx_unprocessed")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Erreur lors de la migration: {e}", exc_info=True)
        return False


if __name__ == "__main__":
    success = migrate()
    sys.exit(0 if success else 1)

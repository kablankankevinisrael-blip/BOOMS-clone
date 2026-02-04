"""
SERVICE DE VALEUR SOCIALE BOOMS - CALCULATOR + SERVICE
Gestion complète des valeurs sociales avec incréments/décréments
Compatibilité avec gift_service.py, market_service.py, purchase_service.py
Avec support WebSocket temps-réel amélioré
"""

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy.orm import Session
import asyncio
from typing import Dict, List, Optional, Tuple

# Import WebSocket corrigé
try:
    from app.websockets import broadcast_social_value_update, broadcast_social_event
    WEBSOCKET_AVAILABLE = True
    logger = logging.getLogger(__name__)
    logger.info("✅ WebSocket imports disponibles")
except ImportError as e:
    WEBSOCKET_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning(f"⚠️ WebSocket imports non disponibles: {e}")

# CONSTANTES BOOMS (nouvelle grille micro-influence)
SOCIAL_PRECISION = Decimal('0.000000000000001')
VALUE_PRECISION = Decimal('0.01')
DEFAULT_PALIER_THRESHOLD = Decimal('1000000')        # 1 M FCFA par palier
MICRO_IMPACT_RATE = Decimal('0.0002')                # 0.02 % du palier débloqué
TREASURY_RATE = Decimal('0.10')                      # 10 % partent dans le pool trésorerie
INACTIVITY_THRESHOLD_DAYS = 1
DECAY_RATIO_PER_DAY = Decimal('0.01')                # -1% d'influence virtuelle / jour après seuil
MAX_SOCIAL_VALUE = Decimal('10000000.0')             # plafond théorique (ajusté par capitalisation)
MIN_SOCIAL_VALUE = Decimal('0.0')
MAX_DECAY_RATIO = Decimal('0.5')                     # plafonner la décote à 50% par passage

ACTION_IMPACT_RULES = {
    'buy': {'weight': Decimal('0.002'), 'source': 'transaction'},          # +0,2 % sur un achat
    'sell': {'weight': Decimal('-0.001'), 'source': 'transaction'},        # -0,1 % sur une vente
    'share': {'weight': Decimal('0.0001'), 'source': 'base'},              # +0,01 % pour un partage
    'gift': {'weight': Decimal('0.0003'), 'source': 'base'},               # +0,03 % pour un cadeau/envoi
    'interaction': {'weight': Decimal('0.0001'), 'source': 'base'},        # +0,01 % pour une interaction générique
    'like': {'weight': Decimal('0.0001'), 'source': 'base'},               # +0,01 % pour un like
    'comment': {'weight': Decimal('0.0001'), 'source': 'base'},            # +0,01 % pour un commentaire
    'view': {'weight': Decimal('0.00005'), 'source': 'base'}               # +0,005 % pour une vue
}

DEFAULT_IMPACT_RULE = {'weight': Decimal('0.0001'), 'source': 'base'}

class SocialValueCalculator:
    """
    Classe principale pour calculer et gérer les valeurs sociales BOOMS
    Compatibilité avec tous les services existants
    Support WebSocket temps-réel intégré avec logs détaillés
    """
    
    def __init__(self, db: Session):
        self.db = db
        self.websocket_enabled = WEBSOCKET_AVAILABLE
        logger.info(f"✅ SocialValueCalculator initialisé (WebSocket: {'activé' if self.websocket_enabled else 'désactivé'})")
    
    # ==================== MÉTHODES DE COMPATIBILITÉ ====================
    
    def calculate_current_value(self, boom_id: int) -> Decimal:
        """
        Calculer la valeur actuelle d'un BOOM (base + social)
        Compatibilité avec gift_service.py, market_service.py, purchase_service.py
        """
        from app.models.bom_models import BomAsset
        
        logger.debug(f"🧮 Calcul valeur actuelle BOOM #{boom_id}")
        
        boom = self.db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if not boom:
            logger.error(f"❌ BOOM #{boom_id} non trouvé")
            raise ValueError(f"BOOM #{boom_id} non trouvé")
        
        # Valeur totale affichée (base + social + micro)
        base_source = boom.base_price if boom.base_price is not None else boom.purchase_price
        base_value = Decimal(str(base_source or 0))
        social_component = Decimal(str(boom.current_social_value or 0))
        micro_component = Decimal(str(boom.applied_micro_value or 0))
        total = boom.get_display_total_value()

        logger.debug(
            f"🧮 BOOM #{boom_id}: base={base_value}, social={social_component}, micro={micro_component}, total={total}"
        )
        
        return total
    
    def calculate_boom_social_value(self, boom_id: int) -> Dict:
        """Calculer la valeur sociale complète d'un BOOM"""
        from app.models.bom_models import BomAsset
        
        logger.debug(f"🧮 Calcul valeur sociale complète BOOM #{boom_id}")
        
        boom = self.db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if not boom:
            raise ValueError(f"BOOM {boom_id} non trouvé")
        
        base_value = Decimal(str(boom.base_price)) if boom.base_price else Decimal('1000')
        
        # === CALCUL DES FACTEURS ===
        
        # 1. Popularité (partages récents) - 30%
        popularity_score = self._calculate_popularity_score(boom_id)
        
        # 2. Engagement (taux d'acceptation) - 25%
        engagement_score = self._calculate_engagement_score(boom_id)
        
        # 3. Distribution (détenteurs uniques) - 20%
        distribution_score = self._calculate_distribution_score(boom_id)
        
        # 4. Stabilité (âge et régularité) - 15%
        stability_score = self._calculate_stability_score(boom_id)
        
        # 5. Viralité (tendance actuelle) - 10%
        virality_score = self._calculate_virality_score(boom_id)
        
        # === SCORE SOCIAL GLOBAL ===
        social_score = (
            popularity_score * Decimal('0.30') +
            engagement_score * Decimal('0.25') +
            distribution_score * Decimal('0.20') +
            stability_score * Decimal('0.15') +
            virality_score * Decimal('0.10')
        )
        
        # Limiter entre 0.7 et 2.3
        social_score = max(Decimal('0.7'), min(social_score, Decimal('2.3')))
        
        # === VALEUR SOCIALE FINALE ===
        social_value = base_value * social_score
        social_value = social_value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        
        logger.debug(f"🧮 BOOM #{boom_id}: score={social_score}, valeur={social_value}")
        
        return {
            "boom_id": boom_id,
            "base_value": float(base_value),
            "social_score": float(social_score),
            "social_value": float(social_value),
            "factors": {
                "popularity": float(popularity_score),
                "engagement": float(engagement_score),
                "distribution": float(distribution_score),
                "stability": float(stability_score),
                "virality": float(virality_score)
            },
            "calculated_at": datetime.now(timezone.utc).isoformat()
        }
    
    # ==================== MÉTHODES DE SERVICE MODERNE ====================
    
    async def update_social_value(self, bom_id: int, action: str, user_id: Optional[int] = None, metadata: Dict = None) -> Dict:
        """Appliquer une action sociale via le nouveau moteur micro-impact."""
        from app.models.bom_models import BomAsset

        logger.info(f"📈 Mise à jour valeur sociale: BOOM #{bom_id}, action={action}, user={user_id}")

        try:
            boom = self.db.query(BomAsset).filter(BomAsset.id == bom_id).with_for_update().first()
        except Exception as lock_error:
            logger.error(f"❌ Erreur verrouillage BOOM #{bom_id}: {lock_error}")
            boom = self.db.query(BomAsset).filter(BomAsset.id == bom_id).first()

        if not boom:
            logger.error(f"❌ BOOM #{bom_id} non trouvé")
            raise ValueError(f"BOOM #{bom_id} non trouvé")

        metadata = metadata or {}
        action_result, event_triggered = self._process_social_action(
            boom=boom,
            action=action,
            user_id=user_id,
            metadata=metadata,
            create_history=True
        )

        try:
            self.db.commit()
            self.db.refresh(boom)
            logger.info(
                "✅ Valeur sociale BOOM #%s mise à jour: %s → Δ %s",
                bom_id,
                action,
                action_result["delta"]
            )
        except Exception as commit_error:
            self.db.rollback()
            logger.error(f"❌ Erreur commit BOOM #{bom_id}: {commit_error}")
            raise

        response_data = self._serialize_action_result(action_result)

        if self.websocket_enabled:
            await self._broadcast_social_update(
                boom,
                action,
                response_data["delta"],
                user_id,
                response_data
            )

        if event_triggered and self.websocket_enabled:
            await self._broadcast_social_event(boom, event_triggered)

        return response_data
    
    async def _broadcast_social_update(self, boom, action: str, delta: float, user_id: Optional[int], data: Dict):
        """Diffuser la mise à jour via WebSocket à tous les clients connectés"""
        if not self.websocket_enabled:
            logger.debug(f"🔌 WebSocket désactivé, pas de broadcast pour BOOM #{boom.id}")
            return
        
        try:
            logger.debug(f"🔌 Préparation broadcast BOOM #{boom.id} {action} Δ{delta}")
            
            # Appeler la fonction de broadcast existante
            await broadcast_social_value_update(
                boom_id=boom.id,
                boom_title=boom.title,
                old_value=float(data["old_social_value"]),
                new_value=float(data["new_social_value"]),
                delta=delta,
                action=action,
                user_id=user_id
            )
            
            logger.info(f"🔌 Broadcast WebSocket réussi pour BOOM #{boom.id}")
            
        except Exception as e:
            logger.error(f"❌ Erreur WebSocket broadcast BOOM #{boom.id}: {e}")
            # Ne pas lever l'exception pour ne pas interrompre le flux principal
    
    async def _broadcast_social_event(self, boom, event_type: str):
        """Diffuser un événement social"""
        if not self.websocket_enabled:
            return
        
        try:
            event_messages = {
                'viral': "🔥 BOOM VIRAL! Forte activité sociale détectée",
                'trending': "📈 BOOM TRENDING! Achat massif en cours",
                'new': "🆕 NOUVEAU BOOM! Premiers acquéreurs",
                'milestone': "🎯 MILESTONE! Objectif de valeur atteint"
            }
            
            message = event_messages.get(event_type, f"Événement {event_type} sur le BOOM")
            
            await broadcast_social_event(
                boom_id=boom.id,
                event_type=event_type,
                message=message,
                data={
                    "boom_title": boom.title,
                    "social_value": float(boom.social_value or 0),
                    "total_value": float(boom.total_value or 0)
                }
            )
            
            logger.info(f"🎉 Événement {event_type} diffusé pour BOOM #{boom.id}")
            
        except Exception as e:
            logger.error(f"❌ Erreur diffusion événement {event_type} BOOM #{boom.id}: {e}")
    
    def apply_social_action(
        self,
        boom,
        action: str,
        user_id: Optional[int] = None,
        metadata: Optional[Dict] = None,
        create_history: bool = False
    ) -> Tuple[Dict, Optional[str]]:
        """Appliquer une action sociale de manière synchrone (sans commit/broadcast)."""
        result, event = self._process_social_action(
            boom=boom,
            action=action,
            user_id=user_id,
            metadata=metadata or {},
            create_history=create_history
        )
        return result, event

    def _process_social_action(
        self,
        boom,
        action: str,
        user_id: Optional[int],
        metadata: Dict,
        create_history: bool = False
    ) -> Tuple[Dict, Optional[str]]:
        base_value = Decimal(str(boom.base_price)) if boom.base_price else Decimal('0')
        old_social_value = Decimal(str(boom.applied_micro_value or boom.social_value or 0))
        old_total_value = Decimal(str(boom.total_value or 0))

        decay_loss = self._apply_decay(boom)
        self._update_counters(boom, action)
        impact_value = self._calculate_action_impact_value(boom, action, metadata, base_value)
        engine_result = self._apply_micro_engine(boom, impact_value, base_value)

        boom.last_interaction_at = datetime.now(timezone.utc)
        boom.last_social_update = datetime.now(timezone.utc)
        boom.interaction_count = (boom.interaction_count or 0) + 1

        self._update_volatility(boom)
        event_triggered = self._check_social_events(boom)

        new_social_value = Decimal(str(boom.applied_micro_value or 0))
        new_total_value = Decimal(str(boom.total_value or 0))
        delta = new_social_value - old_social_value
        delta_percent = ((delta / old_social_value) * Decimal('100')) if old_social_value != 0 else Decimal('0')

        history_id = None
        if create_history:
            history_id = self._create_price_history(boom, action, user_id, delta, metadata)

        result = {
            "boom_id": boom.id,
            "action": action,
            "old_social_value": old_social_value,
            "new_social_value": new_social_value,
            "old_total_value": old_total_value,
            "new_total_value": new_total_value,
            "delta": delta,
            "delta_percent": delta_percent,
            "total_value": new_total_value,
            "base_value": base_value,
            "interaction_count": boom.interaction_count or 0,
            "buy_count": boom.buy_count or 0,
            "sell_count": boom.sell_count or 0,
            "share_count": boom.share_count or 0,
            "volatility": Decimal(str(boom.volatility or 0)),
            "social_event": boom.social_event,
            "social_event_message": boom.social_event_message,
            "history_id": history_id,
            "timestamp": datetime.now(timezone.utc),
            "metadata": metadata or {},
            "impact_value": impact_value,
            "palier_level": boom.palier_level or 0,
            "palier_threshold": self._get_palier_threshold(boom),
            "social_accumulator": Decimal(str(boom.social_accumulator or 0)),
            "applied_micro_value": new_social_value,
            "treasury_pool": Decimal(str(boom.treasury_pool or 0)),
            "redistribution_pool": Decimal(str(boom.redistribution_pool or 0)),
            "market_capitalization": Decimal(str(boom.market_capitalization or 0)),
            "capitalization_units": Decimal(str(boom.capitalization_units or 0)),
            "engine": engine_result,
            "decay_loss": decay_loss
        }

        return result, event_triggered

    def _serialize_action_result(self, result: Dict) -> Dict:
        """Convertir les Decimals en floats pour les réponses externes."""
        return {
            "boom_id": result["boom_id"],
            "action": result["action"],
            "old_social_value": float(result["old_social_value"]),
            "new_social_value": float(result["new_social_value"]),
            "old_total_value": float(result["old_total_value"]),
            "new_total_value": float(result["new_total_value"]),
            "delta": float(result["delta"]),
            "delta_percent": float(result["delta_percent"]),
            "total_value": float(result["total_value"]),
            "base_value": float(result["base_value"]),
            "interaction_count": result["interaction_count"],
            "buy_count": result["buy_count"],
            "sell_count": result["sell_count"],
            "share_count": result["share_count"],
            "volatility": float(result["volatility"]),
            "social_event": result["social_event"],
            "social_event_message": result["social_event_message"],
            "history_id": result["history_id"],
            "timestamp": result["timestamp"].isoformat(),
            "metadata": result["metadata"],
            "impact_value": float(result["impact_value"]),
            "palier_level": result["palier_level"],
            "palier_threshold": float(result["palier_threshold"]),
            "social_accumulator": float(result["social_accumulator"]),
            "applied_micro_value": float(result["applied_micro_value"]),
            "treasury_pool": float(result["treasury_pool"]),
            "redistribution_pool": float(result["redistribution_pool"]),
            "market_capitalization": float(result["market_capitalization"]),
            "capitalization_units": float(result["capitalization_units"]),
            "engine": result["engine"],
            "decay_loss": float(result["decay_loss"])
        }

    def serialize_action_result(self, result: Dict) -> Dict:
        """Exposer la sérialisation des résultats d'action aux services externes."""
        return self._serialize_action_result(result)

    def _calculate_action_impact_value(self, boom, action: str, metadata: Dict, base_value: Decimal) -> Decimal:
        """Traduire une action (achat, partage, etc.) en contribution FCFA."""
        override_amount = metadata.get('override_social_impact')
        if override_amount is not None:
            try:
                impact_override = Decimal(str(override_amount))
                logger.debug(f"📊 Impact override détecté pour action '{action}': {impact_override}")
                return impact_override
            except Exception:
                logger.warning(f"⚠️ Impossible de convertir override_social_impact en Decimal: {override_amount}")
        rule = ACTION_IMPACT_RULES.get(action, DEFAULT_IMPACT_RULE)
        reference_amount = self._resolve_reference_amount(boom, metadata, rule.get('source', 'base'), base_value)
        weight = rule.get('weight', DEFAULT_IMPACT_RULE['weight'])
        weight_override = metadata.get('weight_override')
        if weight_override is not None:
            try:
                weight = Decimal(str(weight_override))
            except Exception:
                logger.warning(f"⚠️ weight_override invalide ({weight_override}), on garde {weight}")
        boost_multiplier = metadata.get('boost_multiplier')
        if boost_multiplier is not None:
            try:
                boost_multiplier = Decimal(str(boost_multiplier))
                if boost_multiplier <= 0:
                    boost_multiplier = Decimal('1')
            except Exception:
                boost_multiplier = Decimal('1')
        else:
            boost_multiplier = Decimal('1')
        impact_value = reference_amount * weight * boost_multiplier
        impact_value = impact_value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        logger.debug(f"📊 Impact '{action}' → ref={reference_amount}, poids={weight}, boost={boost_multiplier}, impact={impact_value}")
        return impact_value

    def _resolve_reference_amount(self, boom, metadata: Dict, source: str, base_value: Decimal) -> Decimal:
        """Déterminer la base financière à utiliser pour une action donnée."""
        if source == 'transaction':
            amount_hint = metadata.get('transaction_amount') or metadata.get('amount')
            if amount_hint is not None:
                try:
                    amount_decimal = Decimal(str(amount_hint))
                    return max(Decimal('0'), amount_decimal)
                except Exception:
                    logger.warning(f"⚠️ transaction_amount invalide: {amount_hint}")
            return max(Decimal('0'), base_value)
        if source == 'fixed':
            fixed = metadata.get('fixed_amount', 0)
            try:
                return max(Decimal('0'), Decimal(str(fixed)))
            except Exception:
                return Decimal('0')
        return max(Decimal('0'), base_value)

    def _apply_micro_engine(self, boom, impact_value: Decimal, base_value: Decimal) -> Dict:
        """Ajouter l'impact à l'accumulateur puis gérer les paliers."""
        threshold = self._get_palier_threshold(boom)
        accumulator = Decimal(str(boom.social_accumulator or 0)) + impact_value
        palier_level = int(boom.palier_level or 0)
        applied_micro = Decimal(str(boom.applied_micro_value or 0))
        micro_unit = self._compute_micro_unit_value(threshold)
        treasury_increment = self._calculate_treasury_contribution(impact_value)
        unlocks = 0

        if threshold > 0 and micro_unit > 0:
            while accumulator >= threshold:
                accumulator -= threshold
                palier_level += 1
                applied_micro += micro_unit
                unlocks += 1
            while accumulator <= -threshold and palier_level > 0:
                accumulator += threshold
                palier_level -= 1
                applied_micro = max(Decimal('0'), applied_micro - micro_unit)
                unlocks -= 1

        palier_level = max(0, palier_level)
        applied_micro = max(MIN_SOCIAL_VALUE, applied_micro)

        accumulator = accumulator.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        applied_micro = applied_micro.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)

        boom.social_accumulator = accumulator
        boom.palier_level = palier_level
        boom.applied_micro_value = applied_micro

        current_social = Decimal(str(boom.current_social_value or 0)) + impact_value
        if current_social < Decimal('0'):
            current_social = Decimal('0')
        boom.current_social_value = current_social.quantize(VALUE_PRECISION, rounding=ROUND_HALF_UP)
        boom.social_value = boom.current_social_value

        total_contributions = Decimal(palier_level) * threshold + accumulator
        boom.capitalization_units = max(Decimal('0'), total_contributions).quantize(SOCIAL_PRECISION, rounding=ROUND_HALF_UP)
        boom.market_capitalization = (base_value + applied_micro).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)

        if treasury_increment > 0:
            current_treasury = Decimal(str(boom.treasury_pool or 0))
            boom.treasury_pool = (current_treasury + treasury_increment).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            current_pool = Decimal(str(boom.redistribution_pool or 0))
            boom.redistribution_pool = (current_pool + treasury_increment).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        boom.sync_social_totals()

        return {
            "impact_value": float(impact_value),
            "palier_unlocks": unlocks,
            "micro_delta": float(micro_unit * unlocks if micro_unit and unlocks else Decimal('0')),
            "accumulator": float(accumulator),
            "treasury_increment": float(treasury_increment),
            "palier_level": palier_level,
            "micro_unit_value": float(micro_unit)
        }

    def _compute_micro_unit_value(self, palier_threshold: Decimal) -> Decimal:
        if palier_threshold <= 0:
            return Decimal('0')
        micro_value = (palier_threshold * MICRO_IMPACT_RATE).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return max(Decimal('0.01'), micro_value)

    def _get_palier_threshold(self, boom) -> Decimal:
        raw_threshold = boom.palier_threshold if boom.palier_threshold else DEFAULT_PALIER_THRESHOLD
        try:
            threshold = Decimal(str(raw_threshold))
        except Exception:
            threshold = DEFAULT_PALIER_THRESHOLD
        if threshold <= 0:
            threshold = DEFAULT_PALIER_THRESHOLD
        return threshold

    def _calculate_treasury_contribution(self, impact_value: Decimal) -> Decimal:
        if impact_value <= 0:
            return Decimal('0')
        contribution = (impact_value * TREASURY_RATE).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return contribution
    
    def _update_counters(self, boom, action: str):
        """Mettre à jour les compteurs d'actions."""
        logger.debug(f"📊 Mise à jour compteurs BOOM #{boom.id} pour action '{action}'")
        
        # Initialiser les compteurs si nécessaire
        if not hasattr(boom, 'buy_count'):
            boom.buy_count = 0
        if not hasattr(boom, 'sell_count'):
            boom.sell_count = 0
        if not hasattr(boom, 'share_count'):
            boom.share_count = 0
        if not hasattr(boom, 'gift_count'):
            boom.gift_count = 0
        if not hasattr(boom, 'like_count'):
            boom.like_count = 0
        if not hasattr(boom, 'comment_count'):
            boom.comment_count = 0
        if not hasattr(boom, 'buy_count_24h'):
            boom.buy_count_24h = 0
        if not hasattr(boom, 'share_count_24h'):
            boom.share_count_24h = 0
        if not hasattr(boom, 'sell_count_24h'):
            boom.sell_count_24h = 0
        
        # Mettre à jour les compteurs
        if action == 'buy':
            boom.buy_count = (boom.buy_count or 0) + 1
            boom.buy_count_24h = (boom.buy_count_24h or 0) + 1
            logger.debug(f"📊 Compteur achat incrémenté: {boom.buy_count}")
        elif action == 'sell':
            boom.sell_count = (boom.sell_count or 0) + 1
            boom.sell_count_24h = (boom.sell_count_24h or 0) + 1
        elif action == 'share':
            boom.share_count = (boom.share_count or 0) + 1
            boom.share_count_24h = (boom.share_count_24h or 0) + 1
        elif action == 'gift':
            boom.gift_count = (boom.gift_count or 0) + 1
            boom.share_count = (boom.share_count or 0) + 1
            boom.share_count_24h = (boom.share_count_24h or 0) + 1
        elif action == 'like':
            boom.like_count = (boom.like_count or 0) + 1
        elif action == 'comment':
            boom.comment_count = (boom.comment_count or 0) + 1

    
    def _apply_decay(self, boom) -> Decimal:
        """Appliquer la décroissance si le BOOM est resté inactif."""
        if not boom.last_interaction_at:
            return Decimal('0')

        inactivity_days = (datetime.now(timezone.utc) - boom.last_interaction_at).days
        if inactivity_days <= INACTIVITY_THRESHOLD_DAYS:
            return Decimal('0')

        decay_days = Decimal(str(inactivity_days - INACTIVITY_THRESHOLD_DAYS))
        decay_ratio = min(decay_days * DECAY_RATIO_PER_DAY, MAX_DECAY_RATIO)
        retention = max(Decimal('0'), Decimal('1') - decay_ratio)

        base_value = Decimal(str(boom.base_price)) if boom.base_price else Decimal('0')
        applied_micro = Decimal(str(boom.applied_micro_value or 0))
        lost_value = (applied_micro * decay_ratio).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
        boom.applied_micro_value = max(Decimal('0'), (applied_micro - lost_value))

        current_social = Decimal(str(boom.current_social_value or 0))
        current_social = max(Decimal('0'), current_social - lost_value)
        boom.current_social_value = current_social.quantize(VALUE_PRECISION, rounding=ROUND_HALF_UP)
        boom.social_value = boom.current_social_value

        accumulator = Decimal(str(boom.social_accumulator or 0))
        boom.social_accumulator = (accumulator * retention).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

        micro_unit = self._compute_micro_unit_value(self._get_palier_threshold(boom))
        palier_level = 0
        if micro_unit > 0:
            palier_level = int((boom.applied_micro_value / micro_unit).to_integral_value(rounding=ROUND_HALF_UP))
        boom.palier_level = palier_level

        threshold = self._get_palier_threshold(boom)
        total_contributions = Decimal(palier_level) * threshold + boom.social_accumulator
        boom.capitalization_units = max(Decimal('0'), total_contributions).quantize(SOCIAL_PRECISION, rounding=ROUND_HALF_UP)
        boom.market_capitalization = (base_value + boom.applied_micro_value).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)

        boom.sync_social_totals()

        logger.debug(f"📉 Décroissance BOOM #{boom.id}: -{decay_ratio * 100}% (inactif {inactivity_days}j)")
        return lost_value
    
    def _update_volatility(self, boom):
        """Calculer et mettre à jour la volatilité."""
        logger.debug(f"📊 Calcul volatilité BOOM #{boom.id}")
        
        # Pour l'instant, calcul simplifié
        # Dans une version complète, on utiliserait l'historique des prix
        
        if not hasattr(boom, 'volatility'):
            boom.volatility = Decimal('0.5')
            return
        
        # Augmenter la volatilité avec plus d'interactions
        # CORRECTION: Tous les calculs en Decimal
        interaction_count = Decimal(str(boom.interaction_count or 0))
        interaction_factor = min(interaction_count, Decimal('100')) / Decimal('100')
        base_volatility = Decimal('0.01')
        
        # Plus d'interactions = plus de volatilité (jusqu'à 0.05)
        additional_volatility = interaction_factor * Decimal('0.04')
        boom.volatility = base_volatility + additional_volatility
        boom.volatility = min(boom.volatility, Decimal('0.05'))
        
        logger.debug(f"📊 Volatilité BOOM #{boom.id}: {boom.volatility}")
    
    def _check_social_events(self, boom) -> Optional[str]:
        """Vérifier et mettre à jour les événements sociaux."""
        logger.debug(f"🎯 Vérification événements sociaux BOOM #{boom.id}")
        
        now = datetime.now(timezone.utc)
        event_triggered = None
        
        # Vérifier l'expiration des événements existants
        if boom.social_event and boom.social_event_expires_at and boom.social_event_expires_at < now:
            logger.debug(f"🎯 Événement {boom.social_event} expiré pour BOOM #{boom.id}")
            boom.social_event = None
            boom.social_event_message = None
            boom.social_event_expires_at = None
        
        # Vérifier les conditions pour nouveaux événements
        # 1. Viral: > 10 partages en 24h
        if boom.share_count_24h and boom.share_count_24h >= 10 and boom.social_event != 'viral':
            boom.social_event = 'viral'
            boom.social_event_message = '🔥 BOOM VIRAL - Forte activité sociale'
            boom.social_event_expires_at = now + timedelta(hours=24)
            event_triggered = 'viral'
            logger.info(f"🎯 Événement viral déclenché pour BOOM #{boom.id}")
        
        # 2. Trending: > 5 achats en 24h
        elif boom.buy_count_24h and boom.buy_count_24h >= 5 and boom.social_event != 'trending':
            boom.social_event = 'trending'
            boom.social_event_message = '📈 BOOM TRENDING - Achat massif'
            boom.social_event_expires_at = now + timedelta(hours=12)
            event_triggered = 'trending'
            logger.info(f"🎯 Événement trending déclenché pour BOOM #{boom.id}")
        
        # 3. New: Créé il y a moins de 7 jours et déjà 1 achat
        elif boom.created_at and (now - boom.created_at).days < 7 and boom.buy_count and boom.buy_count > 0:
            if not boom.social_event or boom.social_event not in ['viral', 'trending']:
                boom.social_event = 'new'
                boom.social_event_message = '🆕 NOUVEAU BOOM - Premiers acquéreurs'
                boom.social_event_expires_at = boom.created_at + timedelta(days=7)
                event_triggered = 'new'
                logger.debug(f"🎯 Événement new déclenché pour BOOM #{boom.id}")
        
        # 4. Milestone: Valeur sociale > 10
        social_value = Decimal(str(boom.social_value)) if boom.social_value else Decimal('0')
        if social_value >= Decimal('10.0') and boom.social_event != 'milestone':
            boom.social_event = 'milestone'
            boom.social_event_message = f'🎯 MILESTONE - Valeur sociale: {social_value}'
            boom.social_event_expires_at = now + timedelta(days=1)
            event_triggered = 'milestone'
            logger.info(f"🎯 Événement milestone déclenché pour BOOM #{boom.id}")
        
        return event_triggered
    
    def _create_price_history(self, boom, action: str, user_id: Optional[int], delta: Decimal, metadata: Dict = None) -> Optional[int]:
        """Créer un historique des prix."""
        try:
            from app.models.bom_models import BomPriceHistory
            
            history = BomPriceHistory(
                bom_id=boom.id,
                action=action,
                user_id=user_id,
                base_value=boom.base_price or Decimal('0'),
                social_value=boom.social_value or Decimal('0'),
                total_value=boom.total_value or Decimal('0'),
                volatility=boom.volatility or Decimal('0'),
                delta=delta,
                metadata=metadata or {}
            )
            self.db.add(history)
            self.db.flush()  # Pour obtenir l'ID
            
            logger.debug(f"📝 Historique créé pour BOOM #{boom.id}, action: {action}")
            
            return history.id
        except Exception as e:
            logger.error(f"❌ Erreur création historique BOOM #{boom.id}: {e}")
            return None
    
    # ==================== MÉTHODES PRIVÉES ORIGINALES (simplifiées pour compatibilité) ====================
    
    def _calculate_popularity_score(self, boom_id: int) -> Decimal:
        """Score basé sur la popularité récente"""
        logger.debug(f"🧮 Calcul popularité BOOM #{boom_id}")
        # Implémentation simplifiée
        return Decimal('1.0')
    
    def _calculate_engagement_score(self, boom_id: int) -> Decimal:
        """Score basé sur l'engagement (acceptation des cadeaux)"""
        logger.debug(f"🧮 Calcul engagement BOOM #{boom_id}")
        # Implémentation simplifiée
        return Decimal('1.0')
    
    def _calculate_distribution_score(self, boom_id: int) -> Decimal:
        """Score basé sur la distribution (détenteurs uniques)"""
        logger.debug(f"🧮 Calcul distribution BOOM #{boom_id}")
        # Implémentation simplifiée
        return Decimal('1.0')
    
    def _calculate_stability_score(self, boom_id: int) -> Decimal:
        """Score basé sur la stabilité (âge et régularité)"""
        logger.debug(f"🧮 Calcul stabilité BOOM #{boom_id}")
        # Implémentation simplifiée
        return Decimal('1.0')
    
    def _calculate_virality_score(self, boom_id: int) -> Decimal:
        """Score basé sur la viralité actuelle"""
        logger.debug(f"🧮 Calcul viralité BOOM #{boom_id}")
        # Implémentation simplifiée
        return Decimal('1.0')
    
    # ==================== MÉTHODES PUBLIQUES ====================
    
    def get_social_value_history(self, bom_id: int, limit: int = 30) -> list:
        """Obtenir l'historique des valeurs sociales."""
        logger.debug(f"📜 Récupération historique BOOM #{bom_id} (limite: {limit})")
        
        try:
            from app.models.bom_models import BomPriceHistory
            
            history = self.db.query(BomPriceHistory).filter(
                BomPriceHistory.bom_id == bom_id
            ).order_by(BomPriceHistory.created_at.desc()).limit(limit).all()
            
            logger.debug(f"📜 {len(history)} entrées d'historique récupérées")
            
            return [
                {
                    "timestamp": h.created_at.isoformat() if h.created_at else None,
                    "social_value": float(h.social_value) if h.social_value else 0.0,
                    "total_value": float(h.total_value) if h.total_value else 0.0,
                    "base_value": float(h.base_value) if h.base_value else 0.0,
                    "action": h.action,
                    "user_id": h.user_id,
                    "delta": float(h.delta) if h.delta else 0.0,
                    "metadata": h.metadata if h.metadata else {}
                }
                for h in history
            ]
        except Exception as e:
            logger.error(f"❌ Erreur récupération historique BOOM #{bom_id}: {e}")
            return []
    
    def batch_update_social_values(self, boom_ids: List[int]) -> Dict:
        """
        Mettre à jour les valeurs sociales d'une liste de BOOMS.
        Utile pour les mises à jour par lot.
        """
        logger.info(f"📊 Mise à jour par lot de {len(boom_ids)} BOOMS")
        
        results = {
            "total": len(boom_ids),
            "updated": 0,
            "failed": 0,
            "details": []
        }
        
        for boom_id in boom_ids:
            try:
                # Appliquer la décroissance pour chaque BOOM
                result = self._apply_batch_decay(boom_id)
                if result:
                    results["updated"] += 1
                    results["details"].append(result)
                else:
                    results["details"].append({
                        "boom_id": boom_id,
                        "status": "no_update_needed",
                        "message": "Aucune décroissance nécessaire"
                    })
            except Exception as e:
                logger.error(f"❌ Erreur batch update BOOM #{boom_id}: {e}")
                results["failed"] += 1
                results["details"].append({
                    "boom_id": boom_id,
                    "status": "error",
                    "error": str(e)
                })
        
        try:
            self.db.commit()
            logger.info(f"📊 Batch update terminé: {results['updated']} mis à jour, {results['failed']} échecs")
        except Exception as e:
            logger.error(f"❌ Erreur commit batch update: {e}")
            self.db.rollback()
            results["commit_error"] = str(e)
        
        return results
    
    def _apply_batch_decay(self, bom_id: int) -> Optional[Dict]:
        """Appliquer la décroissance en batch."""
        from app.models.bom_models import BomAsset
        
        bom = self.db.query(BomAsset).filter(BomAsset.id == bom_id).first()
        if not bom or not bom.last_interaction_at:
            return None
        
        inactivity_days = (datetime.now(timezone.utc) - bom.last_interaction_at).days
        if inactivity_days <= INACTIVITY_THRESHOLD_DAYS:
            return None
        
        old_value = Decimal(str(bom.applied_micro_value or bom.social_value or 0))
        decay_loss = self._apply_decay(bom)
        if decay_loss <= 0:
            return None
        new_value = Decimal(str(bom.applied_micro_value or 0))
        bom.sync_social_totals()
        decay_applied = float(decay_loss)
        
        logger.debug(f"📉 Décroissance batch BOOM #{bom_id}: {decay_applied} (jours inactif: {inactivity_days})")
        
        return {
            "boom_id": bom_id,
            "old_social_value": float(old_value),
            "new_social_value": float(new_value),
            "decay_amount": decay_applied,
            "inactivity_days": inactivity_days
        }
    
    def reset_social_value(self, bom_id: int, new_value: Optional[Decimal] = None) -> Dict:
        """Réinitialiser la valeur sociale (admin only)."""
        from app.models.bom_models import BomAsset
        
        logger.warning(f"⚠️ Réinitialisation valeur sociale BOOM #{bom_id}")
        
        bom = self.db.query(BomAsset).filter(BomAsset.id == bom_id).first()
        if not bom:
            raise ValueError(f"BOOM #{bom_id} non trouvé")
        
        old_value = Decimal(str(bom.applied_micro_value or bom.social_value or 0))

        if new_value is not None:
            try:
                applied = max(Decimal('0'), Decimal(str(new_value)))
            except Exception:
                applied = Decimal('0')
            reset_type = "custom_value"
        else:
            applied = Decimal('0')
            reset_type = "zero"

        base_value = Decimal(str(bom.base_price)) if bom.base_price else Decimal('0')
        micro_unit = self._compute_micro_unit_value(self._get_palier_threshold(bom))
        palier_level = 0
        if micro_unit > 0:
            palier_level = int((applied / micro_unit).to_integral_value(rounding=ROUND_HALF_UP))

        bom.applied_micro_value = applied
        bom.social_value = applied
        bom.palier_level = palier_level
        bom.social_accumulator = Decimal('0')
        threshold = self._get_palier_threshold(bom)
        bom.capitalization_units = (Decimal(palier_level) * threshold).quantize(SOCIAL_PRECISION, rounding=ROUND_HALF_UP)
        bom.market_capitalization = (base_value + applied).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
        
        # Réinitialiser les compteurs optionnels
        bom.interaction_count = 0
        bom.social_event = None
        bom.social_event_message = None
        bom.social_event_expires_at = None
        
        # Mettre à jour la valeur totale
        bom.sync_social_totals()
        
        self.db.commit()
        
        logger.warning(f"⚠️ Valeur sociale BOOM #{bom_id} réinitialisée: {old_value} → {bom.social_value}")
        
        return {
            "boom_id": bom_id,
            "old_social_value": float(old_value),
            "new_social_value": float(bom.social_value),
            "reset_type": reset_type,
            "reset_at": datetime.now(timezone.utc).isoformat()
        }
"""
MODÈLES BOOMS - VERSION SYNCHRONISÉE AVEC LA BASE DE DONNÉES
Corrigé pour correspondre exactement à la structure de la DB
Avec ajout des colonnes manquantes pour market_service.py
"""

from sqlalchemy import Column, Integer, String, DateTime, Numeric, Boolean, Text, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.database import Base
import uuid
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

SOCIAL_PRECISION = Decimal('0.000000000000001')
VALUE_PRECISION = Decimal('0.01')


class BomAsset(Base):
    __tablename__ = "bom_assets"
    
    # === IDENTIFICATION ===
    id = Column(Integer, primary_key=True, index=True)
    token_id = Column(String(100), unique=True, index=True, nullable=False, default=lambda: str(uuid.uuid4()))
    
    # === INFORMATIONS DE BASE ===
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    artist = Column(String(100), nullable=True)
    category = Column(String(100), nullable=True)
    tags = Column(JSONB, default=[])
    image_url = Column(String(500), nullable=True)
    
    # === MÉDIAS ===
    animation_url = Column(String(500), nullable=True)
    audio_url = Column(String(500), nullable=True)
    preview_image = Column(String(500), nullable=True)
    thumbnail_url = Column(String(500), nullable=True)
    duration = Column(Integer, nullable=True)
    
    # === VALEURS FINANCIÈRES ===
    value = Column(Numeric(12, 2), nullable=False, default=0.00)
    purchase_price = Column(Numeric(12, 2), nullable=False, default=0.00)
    base_price = Column(Numeric(12, 2), nullable=False, default=0.00)
    current_price = Column(Numeric(12, 2), nullable=False, default=0.00)
    
    # === VALEURS SOCIALES (COLONNES CRITIQUES AJOUTÉES) ===
    social_value = Column(Numeric(30, 18), default=Decimal('0.0'))  # haute précision micro-incréments
    current_social_value = Column(Numeric(12, 2), nullable=False, default=0.00)
    total_value = Column(Numeric(12, 2), default=0.00)  # base + social
    market_capitalization = Column(Numeric(20, 4), default=Decimal('0.0'))  # capitalisation cumulée
    capitalization_units = Column(Numeric(30, 18), default=Decimal('0.0'))  # unités micro-impacts
    redistribution_pool = Column(Numeric(20, 4), default=Decimal('0.0'))  # frais destinés au pool communautaire
    social_accumulator = Column(Numeric(20, 4), default=Decimal('0.0'))  # valeur sociale en attente
    palier_threshold = Column(Numeric(20, 4), default=Decimal('1000000.0'))
    palier_level = Column(Integer, default=0)
    applied_micro_value = Column(Numeric(20, 4), default=Decimal('0.0'))
    treasury_pool = Column(Numeric(20, 4), default=Decimal('0.0'))
    
    # === STATISTIQUES SOCIALES ===
    buy_count = Column(Integer, default=0)
    sell_count = Column(Integer, default=0)
    share_count = Column(Integer, default=0)  # Total des partages
    share_count_24h = Column(Integer, default=0)  # Partages 24h
    interaction_count = Column(Integer, default=0)
    last_interaction_at = Column(DateTime(timezone=True), nullable=True)
    
    # === AJOUT DES COLONNES MANQUANTES POUR MARKET_SERVICE ===
    total_buys = Column(Integer, default=0)  # Ajouté pour market_service
    total_sells = Column(Integer, default=0)  # Ajouté pour market_service
    total_volume_24h = Column(Numeric(12, 2), default=0.00)  # Ajouté pour market_service
    trade_count = Column(Integer, default=0)  # Ajouté pour market_service (existe déjà, confirmation)
    buy_count_24h = Column(Integer, default=0)  # Ajouté pour market_service
    sell_count_24h = Column(Integer, default=0)
    
    # === MÉTRIQUES SOCIALES ===
    social_score = Column(Numeric(5, 3), default=1.000)
    unique_holders_count = Column(Integer, default=1)
    gift_acceptance_rate = Column(Numeric(5, 3), default=1.000)
    total_shares = Column(Integer, default=0)
    total_gifts_sent = Column(Integer, default=0)
    total_gifts_accepted = Column(Integer, default=0)
    daily_interaction_score = Column(Numeric(5, 3), default=1.000)
    
    # === ÉVÉNEMENTS SOCIAUX ===
    social_event = Column(String(100), nullable=True)
    social_event_message = Column(String(500), nullable=True)
    social_event_expires_at = Column(DateTime(timezone=True), nullable=True)
    active_event = Column(String(100), nullable=True)
    event_message = Column(String(500), nullable=True)
    event_expires_at = Column(DateTime(timezone=True), nullable=True)
    
    # === HISTORIQUE ===
    social_value_history = Column(JSONB, default=[])
    interaction_history = Column(JSONB, default=[])
    price_history = Column(JSONB, default=[])
    
    # === PROPRIÉTÉ ===
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    collection_id = Column(Integer, ForeignKey("nft_collections.id"), nullable=True)
    
    # === ÉDITION ET RARETÉ ===
    edition_type = Column(String(50), default="common")
    total_editions = Column(Integer, nullable=True)
    available_editions = Column(Integer, nullable=True)
    max_editions = Column(Integer, nullable=True)
    current_edition = Column(Integer, default=1)
    
    # === PERFORMANCE MARCHÉ ===
    price_change_24h = Column(Numeric(7, 3), default=0.000)
    price_change_7d = Column(Numeric(7, 3), default=0.000)
    volatility_score = Column(Numeric(5, 3), default=0.010)
    buy_spread = Column(Numeric(5, 3), nullable=True)
    sell_spread = Column(Numeric(5, 3), nullable=True)
    buy_volume_24h = Column(Integer, default=0)
    sell_volume_24h = Column(Integer, default=0)
    liquidity_pool = Column(Numeric(12, 2), nullable=True)
    total_fees_collected = Column(Numeric(12, 2), default=0.00)
    
    # === ÉTAT ===
    stock = Column(Integer, nullable=True, default=0)
    is_active = Column(Boolean, default=True)
    is_minted = Column(Boolean, default=True)
    is_tradable = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    
    # === MÉTADONNÉES NFT ===
    royalty_percentage = Column(Numeric(5, 2), default=10.0)
    minted_at = Column(DateTime(timezone=True), nullable=True)
    nft_metadata = Column(JSONB, default={})
    contract_address = Column(String(100), nullable=True)
    
    # === TIMESTAMPS ===
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    last_social_update = Column(DateTime(timezone=True), nullable=True)
    last_trade_at = Column(DateTime(timezone=True), nullable=True)
    market_listed_at = Column(DateTime(timezone=True), nullable=True)
    featured_until = Column(DateTime(timezone=True), nullable=True)
    
    # === RELATIONS ===
    user_boms = relationship("UserBom", back_populates="bom", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[creator_id], backref="created_boms")
    owner = relationship("User", foreign_keys=[owner_id], backref="owned_boms")
    collection = relationship("NFTCollection", back_populates="boms")
    price_history_records = relationship("BomPriceHistory", back_populates="bom", cascade="all, delete-orphan")
    
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Initialiser valeurs par défaut
        if not hasattr(self, 'base_price') or not self.base_price:
            self.base_price = self.purchase_price or Decimal('1000.00')
        if not hasattr(self, 'current_social_value') or not self.current_social_value:
            self.current_social_value = self.base_price
        if not hasattr(self, 'value') or not self.value:
            self.value = self.current_social_value
        if not hasattr(self, 'total_value') or not self.total_value:
            self.total_value = float(self.base_price or 0) + float(self.social_value or 0)
        
        # Initialiser les nouvelles colonnes si elles ne sont pas fournies
        if not hasattr(self, 'total_buys') or self.total_buys is None:
            self.total_buys = 0
        if not hasattr(self, 'total_sells') or self.total_sells is None:
            self.total_sells = 0
        if not hasattr(self, 'total_volume_24h') or self.total_volume_24h is None:
            self.total_volume_24h = Decimal('0.00')
        if not hasattr(self, 'buy_count_24h') or self.buy_count_24h is None:
            self.buy_count_24h = 0
        if not hasattr(self, 'sell_count_24h') or self.sell_count_24h is None:
            self.sell_count_24h = 0
        if not hasattr(self, 'market_capitalization') or self.market_capitalization is None:
            self.market_capitalization = Decimal('0.0')
        if not hasattr(self, 'capitalization_units') or self.capitalization_units is None:
            self.capitalization_units = Decimal('0.0')
        if not hasattr(self, 'redistribution_pool') or self.redistribution_pool is None:
            self.redistribution_pool = Decimal('0.0')
        if not hasattr(self, 'social_accumulator') or self.social_accumulator is None:
            self.social_accumulator = Decimal('0.0')
        if not hasattr(self, 'palier_threshold') or self.palier_threshold is None:
            self.palier_threshold = Decimal('1000000.0')
        if not hasattr(self, 'palier_level') or self.palier_level is None:
            self.palier_level = 0
        if not hasattr(self, 'applied_micro_value') or self.applied_micro_value is None:
            self.applied_micro_value = Decimal('0.0')
        if not hasattr(self, 'treasury_pool') or self.treasury_pool is None:
            self.treasury_pool = Decimal('0.0')
    
    def __repr__(self):
        return f"<BOOM #{self.id}: {self.title} ({self.current_social_value} FCFA)>"

    def to_dict(self, include_social: bool = True):
        """Convertir en dictionnaire avec données sociales"""
        market_value = float(self.get_display_total_value())
        data = {
            "id": self.id,
            "token_id": self.token_id,
            "title": self.title,
            "artist": self.artist,
            "category": self.category,
            "tags": self.tags or [],
            "media": {
                "animation_url": self.animation_url,
                "preview_image": self.preview_image or self.thumbnail_url,
                "image_url": self.image_url,
                "has_audio": bool(self.audio_url)
            },
            "prices": {
                "base": float(self.base_price or 0),
                "purchase": float(self.purchase_price or 0),
                "current_social": float(self.current_social_value or 0),
                "value": market_value,
                "current_price": float(self.current_price or 0),
                "royalty_percentage": float(self.royalty_percentage or 0)
            },
            "edition": {
                "type": self.edition_type,
                "current": self.current_edition,
                "max": self.max_editions,
                "available": self.available_editions,
                "total": self.total_editions
            },
            "status": {
                "is_active": self.is_active,
                "is_minted": self.is_minted,
                "is_tradable": self.is_tradable,
                "is_featured": self.is_featured,
                "stock": self.stock or 0
            },
            "timestamps": {
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "last_interaction": self.last_interaction_at.isoformat() if self.last_interaction_at else None,
                "last_social_update": self.last_social_update.isoformat() if self.last_social_update else None
            }
        }
        
        if include_social:
            data["social_metrics"] = {
                "social_value": float(self.social_value or 0),
                "total_value": market_value,
                "social_score": float(self.social_score or 1.0),
                "share_count_24h": self.share_count_24h or 0,
                "unique_holders": self.unique_holders_count or 1,
                "acceptance_rate": float(self.gift_acceptance_rate or 1.0),
                "total_shares": self.total_shares or 0,
                "daily_interaction_score": float(self.daily_interaction_score or 1.0),
                "buy_count": self.buy_count or 0,
                "sell_count": self.sell_count or 0,
                "share_count": self.share_count or 0,
                "interaction_count": self.interaction_count or 0,
                "total_buys": self.total_buys or 0,  # AJOUTÉ
                "total_sells": self.total_sells or 0,  # AJOUTÉ
                "buy_count_24h": self.buy_count_24h or 0,  # AJOUTÉ
                "sell_count_24h": self.sell_count_24h or 0,
                "trade_count": self.trade_count or 0,  # AJOUTÉ
                "market_capitalization": float(self.market_capitalization or 0),
                "capitalization_units": float(self.capitalization_units or 0),
                "redistribution_pool": float(self.redistribution_pool or 0),
                "social_accumulator": float(self.social_accumulator or 0),
                "palier_threshold": float(self.palier_threshold or 0),
                "palier_level": self.palier_level or 0,
                "applied_micro_value": float(self.applied_micro_value or 0),
                "treasury_pool": float(self.treasury_pool or 0)
            }
            
            data["performance"] = {
                "change_24h": float(self.price_change_24h or 0),
                "change_7d": float(self.price_change_7d or 0),
                "volatility": float((self.volatility_score or 0) * 100),
                "social_event": self.social_event,
                "event_message": self.social_event_message,
                "event_expires": self.social_event_expires_at.isoformat() if self.social_event_expires_at else None,
                "volume_24h": float(self.total_volume_24h or 0),  # CORRIGÉ
                "trade_count": self.trade_count or 0
            }
        
        return data
    
    def update_social_metrics(self, db_session):
        """Mettre à jour les métriques sociales (appelé après interactions)"""
        from datetime import datetime, timezone, timedelta
        
        # 1. Compter partages 24h
        day_ago = datetime.now(timezone.utc) - timedelta(days=1)
        
        from app.models.gift_models import GiftTransaction
        from app.models.bom_models import UserBom
        
        shares_24h = db_session.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id.in_(
                db_session.query(UserBom.id).filter(UserBom.bom_id == self.id)
            ),
            GiftTransaction.sent_at >= day_ago,
            GiftTransaction.status == 'ACCEPTED'
        ).count()
        
        self.share_count_24h = shares_24h
        
        # 2. Compter détenteurs uniques
        unique_holders = db_session.query(UserBom.user_id).filter(
            UserBom.bom_id == self.id,
            UserBom.is_sold.is_(False),
            UserBom.deleted_at.is_(None),
            UserBom.is_transferable == True
        ).distinct().count()
        
        self.unique_holders_count = max(1, unique_holders)
        
        # 3. Calculer taux d'acceptation
        total_gifts = db_session.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id.in_(
                db_session.query(UserBom.id).filter(UserBom.bom_id == self.id)
            )
        ).count()
        
        accepted_gifts = db_session.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id.in_(
                db_session.query(UserBom.id).filter(UserBom.bom_id == self.id)
            ),
            GiftTransaction.status == 'ACCEPTED'
        ).count()
        
        if total_gifts > 0:
            self.gift_acceptance_rate = accepted_gifts / total_gifts
        else:
            self.gift_acceptance_rate = 1.0
        
        # 4. Mettre à jour totaux
        self.total_shares = db_session.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id.in_(
                db_session.query(UserBom.id).filter(UserBom.bom_id == self.id)
            )
        ).count()
        
        self.total_gifts_sent = total_gifts
        self.total_gifts_accepted = accepted_gifts
        
        # 5. Calculer score interaction quotidien
        self.daily_interaction_score = self._calculate_daily_interaction_score()
        
        # 6. Vérifier événements sociaux
        self._check_social_events()
        
        # 7. Mettre à jour la valeur totale
        self._update_total_value()
        
        # Mettre à jour timestamp
        self.last_social_update = datetime.now(timezone.utc)
    
    def _calculate_daily_interaction_score(self) -> float:
        """Calculer score d'interaction quotidien"""
        base_score = 1.0
        
        # Bonus pour partages récents
        if self.share_count_24h > 0:
            share_bonus = min(self.share_count_24h * 0.05, 0.3)  # Max +30%
            base_score += share_bonus
        
        # Bonus pour acceptation élevée
        if self.gift_acceptance_rate > 0.8:
            acceptance_bonus = (self.gift_acceptance_rate - 0.8) * 0.5  # Max +10%
            base_score += acceptance_bonus
        
        # Bonus pour nombreux détenteurs
        if self.unique_holders_count > 5:
            holder_bonus = min((self.unique_holders_count - 5) * 0.02, 0.2)  # Max +20%
            base_score += holder_bonus
        
        return min(max(base_score, 0.7), 1.5)  # Limiter 0.7-1.5
    
    def _check_social_events(self):
        """Vérifier et mettre à jour les événements sociaux"""
        from datetime import datetime, timezone, timedelta
        
        # Réinitialiser si expiré
        if self.social_event_expires_at and self.social_event_expires_at < datetime.now(timezone.utc):
            self.social_event = None
            self.social_event_message = None
            self.social_event_expires_at = None
        
        # Vérifier viralité (10+ partages 24h)
        if self.share_count_24h >= 10 and self.social_event != 'viral':
            self.social_event = 'viral'
            self.social_event_message = '🔥 BOOM VIRAL! Très partagé aujourd\'hui'
            self.social_event_expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        
        # Vérifier trending (5-9 partages 24h)
        elif 5 <= self.share_count_24h < 10 and self.social_event != 'trending':
            self.social_event = 'trending'
            self.social_event_message = '📈 BOOM TRENDING! En forte croissance'
            self.social_event_expires_at = datetime.now(timezone.utc) + timedelta(hours=12)
        
        # Nouveau (<7 jours)
        elif self.created_at and (datetime.now(timezone.utc) - self.created_at).days < 7:
            if not self.social_event or self.social_event not in ['viral', 'trending']:
                self.social_event = 'new'
                self.social_event_message = '🆕 NOUVEAU BOOM! Récemment ajouté'
                self.social_event_expires_at = self.created_at + timedelta(days=7)
    
    def sync_social_totals(self):
        """Synchroniser les totaux réels après modification de la valeur sociale"""
        base_source = self.base_price or self.purchase_price or Decimal('0')
        base_value = Decimal(str(base_source))

        social_component = Decimal(str(self.current_social_value or 0))
        micro_component = Decimal(str(self.applied_micro_value or 0))

        total_value = (base_value + social_component + micro_component).quantize(VALUE_PRECISION, ROUND_HALF_UP)

        self.social_value = social_component.quantize(SOCIAL_PRECISION, ROUND_HALF_UP)
        self.applied_micro_value = micro_component.quantize(SOCIAL_PRECISION, ROUND_HALF_UP)
        self.total_value = total_value
        self.current_price = total_value
        self.value = total_value
        return total_value

    def _update_total_value(self):
        """Mettre à jour la valeur totale (base + social)"""
        self.sync_social_totals()

    def get_display_total_value(self) -> Decimal:
        """Retourner base + valeur sociale actuelle + micro-impact."""
        base_source = self.base_price if self.base_price is not None else (self.purchase_price or Decimal('0'))
        base_value = Decimal(str(base_source))
        social_component = Decimal(str(self.current_social_value or 0))
        micro_component = Decimal(str(self.applied_micro_value or 0))
        return (base_value + social_component + micro_component).quantize(VALUE_PRECISION, ROUND_HALF_UP)

    def increment_total_buys(self, quantity: int = 1):
        """Incrémenter le total des achats"""
        self.total_buys = (self.total_buys or 0) + quantity
        self.buy_count_24h = (self.buy_count_24h or 0) + quantity
    
    def increment_total_sells(self, quantity: int = 1):
        """Incrémenter le total des ventes"""
        self.total_sells = (self.total_sells or 0) + quantity
        self.sell_count_24h = (self.sell_count_24h or 0) + quantity
    
    def add_to_total_volume_24h(self, amount: float):
        """Ajouter au volume 24h"""
        self.total_volume_24h = (self.total_volume_24h or Decimal('0.00')) + Decimal(str(amount))
    
    def increment_trade_count(self):
        """Incrémenter le compteur de trades"""
        self.trade_count = (self.trade_count or 0) + 1


class UserBom(Base):
    __tablename__ = "user_boms"
    
    # === IDENTIFICATION ===
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
    bom_id = Column(Integer, ForeignKey("bom_assets.id"), index=True, nullable=False)
    
    # === TRANSFERT ===
    transfer_id = Column(String(100), unique=True, index=True, nullable=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    transfer_message = Column(Text, nullable=True)
    message = Column(Text, nullable=True)  # Ancien nom, gardé pour compatibilité
    
    # === FINANCES ===
    purchase_price = Column(Numeric(12, 2), nullable=True)
    current_value = Column(Numeric(12, 2), nullable=True)
    profit_loss = Column(Numeric(12, 2), default=0.00)
    fees_paid = Column(Numeric(12, 2), default=0.00)
    listing_price = Column(Numeric(12, 2), nullable=True)  # Ancien nom, gardé
    
    # === STATISTIQUES ===
    hold_days = Column(Integer, default=0)
    times_shared = Column(Integer, default=0)
    times_received_as_gift = Column(Integer, default=0)
    total_trades = Column(Integer, default=0)
    
    # === ÉTAT ===
    is_transferable = Column(Boolean, default=True)
    is_listed_for_trade = Column(Boolean, default=False)
    is_favorite = Column(Boolean, default=False)
    is_tradable = Column(Boolean, default=True)
    is_sold = Column(Boolean, default=False, nullable=False)
    
    # === TIMESTAMPS ===
    acquired_at = Column(DateTime(timezone=True), server_default=func.now())
    last_viewed_at = Column(DateTime(timezone=True), nullable=True)
    transferred_at = Column(DateTime(timezone=True), nullable=True)
    last_updated_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    # === RELATIONS ===
    bom = relationship("BomAsset", back_populates="user_boms")
    
    # === PROPRIÉTÉ DE COMPATIBILITÉ - CRITIQUE ===
    @property
    def bom_asset(self):
        """Alias pour compatibilité avec le code existant qui utilise bom_asset"""
        return self.bom
    
    @bom_asset.setter
    def bom_asset(self, value):
        """Setter pour compatibilité"""
        self.bom = value
    
    def __repr__(self):
        return f"<UserBom #{self.id}: User:{self.user_id} -> BOOM:{self.bom_id}>"
    
    def calculate_profit_loss(self, current_value: float = None):
        """Calculer le gain/pert actuel"""
        if not self.purchase_price:
            self.profit_loss = 0.00
            return 0.00
        
        if current_value is None:
            # Utiliser self.bom (qui sera aussi accessible via self.bom_asset grâce à la propriété)
            if self.bom:
                # Utiliser la valeur totale exposée (base + social + micro)
                current_value = float(self.bom.get_display_total_value())
            elif self.current_value:
                current_value = float(self.current_value)
            else:
                current_value = float(self.purchase_price)
        
        self.profit_loss = Decimal(str(current_value)) - Decimal(str(self.purchase_price or 0))
        return float(self.profit_loss)
    
    def update_current_value(self):
        """Mettre à jour la valeur actuelle basée sur le BOOM"""
        if self.bom:
            self.current_value = Decimal(str(self.bom.get_display_total_value()))
            self.calculate_profit_loss()
            return self.current_value
        return None
    
    def to_dict(self):
        """Convertir en dictionnaire"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "bom_id": self.bom_id,
            "transfer_id": self.transfer_id,
            "purchase_price": float(self.purchase_price or 0),
            "current_value": float(self.current_value or 0),
            "profit_loss": float(self.profit_loss or 0),
            "fees_paid": float(self.fees_paid or 0),
            "hold_days": self.hold_days or 0,
            "times_shared": self.times_shared or 0,
            "times_received_as_gift": self.times_received_as_gift or 0,
            "is_transferable": self.is_transferable,
            "is_listed_for_trade": self.is_listed_for_trade,
            "is_favorite": self.is_favorite,
            "is_sold": self.is_sold,
            "acquired_at": self.acquired_at.isoformat() if self.acquired_at else None,
            "last_viewed_at": self.last_viewed_at.isoformat() if self.last_viewed_at else None,
            "transferred_at": self.transferred_at.isoformat() if self.transferred_at else None,
            "deleted_at": self.deleted_at.isoformat() if self.deleted_at else None,
            "listing_price": float(self.listing_price or 0) if self.listing_price else None
        }


class NFTCollection(Base):
    __tablename__ = "nft_collections"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    creator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    banner_image = Column(String(500), nullable=True)
    thumbnail_image = Column(String(500), nullable=True)
    is_verified = Column(Boolean, default=False)
    
    # === STATISTIQUES ===
    total_items = Column(Integer, default=0)
    floor_price = Column(Numeric(12, 2), nullable=True)
    total_volume = Column(Numeric(12, 2), default=0.00)
    total_social_value = Column(Numeric(12, 2), default=0.00)
    average_social_score = Column(Numeric(5, 3), default=1.000)
    
    # === MÉTADONNÉES ===
    collection_metadata = Column(JSONB, default={
        "category": "art",
        "social_links": {},
        "royalty_percentage": 5.0,
        "tags": []
    })
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # === RELATIONS ===
    creator = relationship("User", backref="created_collections")
    boms = relationship("BomAsset", back_populates="collection")
    
    def __repr__(self):
        return f"<NFTCollection #{self.id}: {self.name}>"
    
    def to_dict(self):
        """Convertir en dictionnaire"""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "creator_id": self.creator_id,
            "is_verified": self.is_verified,
            "total_items": self.total_items or 0,
            "floor_price": float(self.floor_price or 0),
            "total_volume": float(self.total_volume or 0),
            "total_social_value": float(self.total_social_value or 0),
            "average_social_score": float(self.average_social_score or 1.0),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "banner_image": self.banner_image,
            "thumbnail_image": self.thumbnail_image
        }


class BomPriceHistory(Base):
    __tablename__ = "bom_price_history"
   
    id = Column(Integer, primary_key=True, index=True)
    bom_id = Column(Integer, ForeignKey("bom_assets.id"), nullable=False)
    action = Column(String(50), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
   
    base_value = Column(Numeric(12, 2), default=0.00)
    social_value = Column(Numeric(12, 6), default=0.000000)
    total_value = Column(Numeric(12, 2), default=0.00)
    volatility = Column(Numeric(5, 3), default=0.010)
    delta = Column(Numeric(12, 6), default=0.000000)
   
    nft_metadata = Column(JSONB, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())
   
    # RELATION CORRIGÉE : back_populates + nom unique
    bom = relationship("BomAsset", back_populates="price_history_records")
    user = relationship("User", backref="price_history_actions")
    
    def __repr__(self):
        return f"<BomPriceHistory #{self.id}: BOOM:{self.bom_id} {self.action} Δ{self.delta}>"
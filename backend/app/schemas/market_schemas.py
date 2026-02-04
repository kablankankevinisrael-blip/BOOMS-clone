"""
SCHÉMAS PYDANTIC POUR LE MARCHÉ FINANCIER BOOMS
"""
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime
from decimal import Decimal

class MarketBuyRequest(BaseModel):
    """Requête d'achat sur le marché"""
    boom_id: int = Field(..., description="ID du Boom à acheter")
    quantity: int = Field(1, ge=1, le=100, description="Quantité à acheter")
    
    @validator('quantity')
    def validate_quantity(cls, v):
        if v <= 0:
            raise ValueError('La quantité doit être positive')
        return v

class MarketSellRequest(BaseModel):
    """Requête de vente sur le marché"""
    user_bom_id: int = Field(..., description="ID de la possession UserBom à vendre")

class MarketResponse(BaseModel):
    """Réponse générique du marché"""
    success: bool
    message: str
    timestamp: datetime = Field(default_factory=datetime.now)

class MarketTradeResponse(BaseModel):
    """Réponse détaillée pour un trade"""
    success: bool = True
    message: str
    boom_id: int
    quantity: int
    total_amount: float
    fees: float
    net_amount: float
    new_balance: float
    new_social_value: float
    timestamp: datetime = Field(default_factory=datetime.now)
    
    # Correction : rendre ces champs optionnels
    addiction: Optional[Dict[str, Any]] = None
    market_impact: Optional[Dict[str, Any]] = None
    
    # Garder les champs existants optionnels pour compatibilité
    boom: Optional[Dict[str, Any]] = None
    financial: Optional[Dict[str, float]] = None
    market_capitalization: Optional[float] = None
    capitalization_units: Optional[float] = None
    redistribution_pool: Optional[float] = None
    effective_capitalization: Optional[float] = None
    
    class Config:
        from_attributes = True

class MarketOverviewResponse(BaseModel):
    """Aperçu complet du marché"""
    total_market_cap: float
    total_volume_24h: float
    active_nfts: int
    total_fees_collected: float
    top_gainers: List[Dict[str, Any]]
    top_losers: List[Dict[str, Any]]
    hot_nfts: List[Dict[str, Any]]
    active_events: List[Dict[str, Any]]

class BoomMarketData(BaseModel):
    """Données marché pour un Boom spécifique"""
    boom_id: int
    title: str
    artist: str
    current_price: float
    social_value: float
    total_value: float
    total_holders: int
    total_shares: int
    total_volume_24h: float
    last_sale_price: Optional[float] = None
    created_at: datetime
    
    # Correction : rendre ces champs optionnels
    prices: Optional[Dict[str, Any]] = None
    market_stats: Optional[Dict[str, Any]] = None
    change: Optional[Dict[str, Any]] = None
    event: Optional[Dict[str, Any]] = None
    
    # Garder les champs optionnels pour compatibilité
    price_history: Optional[List[Dict[str, Any]]] = None
    collection: Optional[str] = None
    market_capitalization: Optional[float] = None
    capitalization_units: Optional[float] = None
    redistribution_pool: Optional[float] = None
    effective_capitalization: Optional[float] = None
    
    class Config:
        from_attributes = True

class PriceQuote(BaseModel):
    """Devis de prix pour achat/vente"""
    boom_id: int
    boom_title: str
    quantity: int
    prices: Dict[str, float]
    fees_breakdown: Dict[str, Any]
    market_impact: str

class TrendingBoom(BaseModel):
    """Boom tendance"""
    id: int
    title: str
    artist: str
    current_price: float
    price_change_24h: float
    volume_24h: float
    trade_count: int
    trend_score: float
    event: Optional[str]
    preview_image: str

class ActiveEvent(BaseModel):
    """Événement actif sur le marché"""
    boom_id: int
    boom_title: str
    event_type: str
    event_message: str
    time_remaining_minutes: int
    current_price: float
    preview_image: str
    effect_description: str

class UserTradingStats(BaseModel):
    """Statistiques de trading utilisateur"""
    user_id: int
    total_trades: int
    total_volume: float
    total_fees_paid: float
    total_profit_loss: float
    average_hold_time_days: float
    current_streak: int
    favorite_boom_id: Optional[int]
    trading_rank: Optional[int]
    
    class Config:
        from_attributes = True

class MarketAlert(BaseModel):
    """Alerte marché"""
    type: str  # "price_alert", "event_alert", "volume_alert"
    boom_id: int
    message: str
    priority: str = "medium"  # low, medium, high, critical
    created_at: datetime = Field(default_factory=datetime.now)
    expires_at: Optional[datetime]
    
    @validator('priority')
    def validate_priority(cls, v):
        valid_priorities = ["low", "medium", "high", "critical"]
        if v not in valid_priorities:
            raise ValueError(f'Priority must be one of: {valid_priorities}')
        return v
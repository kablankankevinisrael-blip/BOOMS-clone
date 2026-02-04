from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict, Any, List

class PurchaseRequest(BaseModel):
    bom_id: int
    quantity: int = 1

class PurchaseResponse(BaseModel):
    success: bool
    message: str
    transaction_id: int
    transaction_time: float
    timestamp: str
    boom: Dict[str, Any]
    financial: Dict[str, Any]
    social_impact: Dict[str, Any]
    user_boms: List[Dict[str, Any]]
    websocket: Dict[str, Any]
    performance: Dict[str, Any]
    security: Dict[str, Any]
    
    # Champs optionnels pour compatibilité
    id: Optional[int] = None
    user_id: Optional[int] = None
    bom_id: Optional[int] = None
    amount: Optional[float] = None
    quantity: Optional[int] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# ✅ NOUVEAU MODÈLE POUR LES DONNÉES DU BOOM
class BoomData(BaseModel):
    id: int
    token_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    artist: Optional[str] = None
    category: Optional[str] = None
    animation_url: Optional[str] = None
    preview_image: Optional[str] = None
    edition_type: Optional[str] = None
    current_edition: Optional[int] = None
    max_editions: Optional[int] = None
    collection_name: Optional[str] = None

class FinancialData(BaseModel):
    purchase_price: float = 0.0
    fees_paid: float = 0.0
    entry_price: float = 0.0
    current_social_value: float = 0.0
    profit_loss: float = 0.0
    profit_loss_percent: float = 0.0
    estimated_value: float = 0.0


class SocialMetrics(BaseModel):
    social_value: float = 0.0
    base_value: float = 0.0
    total_value: float = 0.0
    buy_count: int = 0
    sell_count: int = 0
    share_count: int = 0
    interaction_count: int = 0
    social_score: float = 0.0
    share_count_24h: int = 0
    unique_holders: int = 0
    acceptance_rate: float = 0.0
    social_event: Optional[str] = None
    daily_interaction_score: float = 0.0


class InventoryItem(BaseModel):
    id: int
    user_id: int
    bom_id: int
    quantity: int
    is_transferable: bool
    is_favorite: Optional[bool] = False
    hold_days: Optional[int] = 0
    times_shared: Optional[int] = 0
    acquired_at: Optional[datetime] = None
    boom_data: Dict[str, Any]
    financial: FinancialData
    social_metrics: SocialMetrics
    
    class Config:
        from_attributes = True

# ✅ OPTION 2 : Si vous voulez garder compatibilité avec l'ancien code
class InventoryItemCompat(BaseModel):
    id: int
    user_id: int
    bom_id: int
    quantity: int
    is_transferable: bool
    is_favorite: Optional[bool] = False
    hold_days: Optional[int] = 0
    times_shared: Optional[int] = 0
    acquired_at: Optional[datetime] = None
    boom_data: Dict[str, Any]
    financial: FinancialData
    social_metrics: SocialMetrics
    
    # Propriété pour compatibilité avec l'ancien code
    @property
    def bom_asset(self) -> Dict[str, Any]:
        """Alias pour compatibilité avec le code existant"""
        return self.boom_data
    
    @bom_asset.setter
    def bom_asset(self, value: Dict[str, Any]):
        """Setter pour compatibilité"""
        self.boom_data = value
    
    class Config:
        from_attributes = True
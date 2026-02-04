from pydantic import BaseModel, field_validator, ValidationInfo
from typing import Optional, Dict, Any, List
from datetime import datetime

class NFTCreate(BaseModel):
    # === INFORMATIONS DE BASE ===
    title: str
    description: Optional[str] = None
    artist: str
    category: str
    
    # === ANIMATION NFT (GIF/MP4) ===
    animation_url: str  # REQUIS: URL GIF animé ou MP4 court
    audio_url: Optional[str] = None  # Audio optionnel
    preview_image: str  # REQUIS: Image statique pour preview
    
    # === VALEURS SOCIAL TRADING ===
    base_price: float  # Prix de base
    purchase_price: float  # Prix d'achat utilisateur
    royalty_percentage: Optional[float] = 10.0
    
    # === NFT METADATA ===
    collection_id: Optional[int] = None
    edition_type: str = "common"  # common, rare, epic, legendary
    max_editions: Optional[int] = None  # None = édition unique
    
    # === TAGS ET ATTRIBUTES ===
    tags: List[str] = []
    attributes: List[Dict[str, Any]] = []  # Attributs NFT
    
    # === VALIDATEURS ===
    @field_validator('animation_url', 'preview_image')
    @classmethod
    def validate_required_urls(cls, v: str, info: ValidationInfo) -> str:
        """Valider que les URLs requises sont présentes"""
        if not v:
            raise ValueError(f"{info.field_name} est requis pour un NFT")
        
        if not v.startswith(('http://', 'https://')):
            raise ValueError(f"{info.field_name} doit être une URL valide")
        
        return v
    
    @field_validator('audio_url')
    @classmethod
    def validate_audio_url(cls, v: Optional[str]) -> Optional[str]:
        """Valider l'URL audio"""
        if not v:
            return None
        
        if not v.startswith(('http://', 'https://')):
            raise ValueError("audio_url doit être une URL valide")
        
        return v
    
    @field_validator('edition_type')
    @classmethod
    def validate_edition_type(cls, v: str) -> str:
        """Valider le type d'édition"""
        valid_types = ['common', 'rare', 'epic', 'legendary']
        if v not in valid_types:
            raise ValueError(f"edition_type doit être l'un des: {', '.join(valid_types)}")
        return v
    
    @field_validator('royalty_percentage')
    @classmethod
    def validate_royalty(cls, v: Optional[float]) -> Optional[float]:
        """Valider le pourcentage de royalties"""
        if v is not None:
            if v < 0 or v > 50:
                raise ValueError("royalty_percentage doit être entre 0 et 50")
        return v
    
    @field_validator('attributes')
    @classmethod
    def validate_attributes(cls, v: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Valider les attributs NFT"""
        for attr in v:
            if not isinstance(attr, dict):
                raise ValueError("Chaque attribut doit être un dictionnaire")
            if 'trait_type' not in attr or 'value' not in attr:
                raise ValueError("Les attributs doivent avoir 'trait_type' et 'value'")
        return v
    
    def to_nft_metadata(self, creator_id: int) -> Dict[str, Any]:
        """Générer les métadonnées NFT standardisées"""
        return {
            "name": self.title,
            "description": self.description or f"NFT créé par {self.artist}",
            "image": self.preview_image,
            "animation_url": self.animation_url,
            "external_url": "",
            "attributes": self.attributes,
            "properties": {
                "creator": self.artist,
                "category": self.category,
                "edition_type": self.edition_type,
                "has_audio": bool(self.audio_url),
                "royalty_percentage": self.royalty_percentage,
                "creator_id": creator_id
            }
        }


class NFTResponse(BaseModel):
    # === IDENTIFICATION ===
    id: int
    token_id: str
    
    # === MÉTADONNÉES ===
    title: str
    description: Optional[str]
    artist: str
    category: str
    tags: List[str]
    
    # === MÉDIAS ===
    animation_url: str
    audio_url: Optional[str]
    preview_image: str
    duration: Optional[int]
    
    # === VALEURS SOCIAL TRADING ===
    base_price: float
    purchase_price: float
    current_social_value: float  # ✅ Remplace 'value' pour Social Trading
    total_value: Optional[float] = None
    market_capitalization: Optional[float] = 0.0
    capitalization_units: Optional[float] = 0.0
    redistribution_pool: Optional[float] = 0.0
    royalty_percentage: float
    
    # === MÉTRIQUES SOCIALES ===
    social_score: Optional[float] = 1.0
    share_count_24h: Optional[int] = 0
    unique_holders_count: Optional[int] = 1
    gift_acceptance_rate: Optional[float] = 1.0
    
    # === PROPRIÉTÉ ===
    owner_id: Optional[int]
    creator_id: int
    collection_id: Optional[int]
    
    # === ÉDITION ===
    edition_type: str
    max_editions: Optional[int]
    current_edition: int
    available_editions: Optional[int]
    
    # === ÉTAT ===
    is_active: bool
    is_minted: Optional[bool] = True
    is_tradable: bool
    
    # === PERFORMANCE SOCIALE ===
    social_event: Optional[str] = None
    social_event_message: Optional[str] = None
    price_change_24h: Optional[float] = 0.0
    price_change_7d: Optional[float] = 0.0
    
    # === TIMESTAMPS ===
    created_at: datetime
    last_social_update: Optional[datetime] = None
    last_trade_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class UserNFTResponse(BaseModel):
    id: int
    user_id: int
    nft: NFTResponse
    transfer_id: Optional[str]
    sender_id: Optional[int]
    receiver_id: Optional[int]
    transfer_message: Optional[str]
    purchase_price: Optional[float]
    current_estimated_value: Optional[float]
    profit_loss: Optional[float]
    is_transferable: bool
    is_listed: bool
    times_shared: Optional[int] = 0
    acquired_at: datetime
    transferred_at: Optional[datetime]
    
    class Config:
        from_attributes = True


class CollectionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    banner_image: Optional[str] = None
    thumbnail_image: Optional[str] = None
    category: str = "art"
    
    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        if len(v) < 2 or len(v) > 100:
            raise ValueError("Le nom de la collection doit contenir entre 2 et 100 caractères")
        return v


class CollectionResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    creator_id: int
    banner_image: Optional[str]
    thumbnail_image: Optional[str]
    is_verified: bool
    total_items: int
    total_social_value: float  # ✅ Compatible Social Trading
    average_social_score: float
    collection_metadata: Dict[str, Any]
    created_at: datetime
    
    class Config:
        from_attributes = True
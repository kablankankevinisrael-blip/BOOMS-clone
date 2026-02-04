from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, cast, String
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app.schemas.bom_schemas import NFTResponse, CollectionResponse
from app.models.bom_models import BomAsset, NFTCollection
from app.models.user_models import User
from app.services.auth import get_current_user_from_token

router = APIRouter(prefix="/nfts", tags=["nfts"])

@router.get("/", response_model=List[NFTResponse])
def get_available_nfts(
    db: Session = Depends(get_db),
    category: Optional[str] = Query(None, description="Filtrer par catégorie NFT"),
    artist: Optional[str] = Query(None, description="Filtrer par artiste"),
    collection: Optional[str] = Query(None, description="Filtrer par collection"),
    edition_type: Optional[str] = Query(None, description="Filtrer par rareté (common, rare, epic, legendary)"),
    owner: Optional[int] = Query(None, description="Filtrer par propriétaire"),
    min_value: Optional[float] = Query(None, description="Valeur sociale minimale"),
    max_value: Optional[float] = Query(None, description="Valeur sociale maximale"),
    has_audio: Optional[bool] = Query(None, description="NFT avec audio"),
    search: Optional[str] = Query(None, min_length=1, description="Recherche par titre, artiste, description, tags ou token"),
    limit: int = Query(50, ge=1, le=100, description="Limite de résultats"),
    offset: int = Query(0, ge=0, description="Offset pour pagination")
):
    """
    Récupérer tous les NFTs disponibles
    ✅ Compatible Social Trading : Filtrage par valeur sociale
    """
    # Construction de la requête NFT
    query = db.query(BomAsset).filter(
        BomAsset.is_active == True,
        BomAsset.is_minted == True
    )
    joined_collection = False
    
    # === FILTRES NFT ===
    if category:
        query = query.filter(BomAsset.category.ilike(f"%{category}%"))
    
    if artist:
        query = query.filter(BomAsset.artist.ilike(f"%{artist}%"))
    
    if collection:
        if not joined_collection:
            query = query.outerjoin(NFTCollection)
            joined_collection = True
        query = query.filter(NFTCollection.name.ilike(f"%{collection}%"))
    
    if edition_type:
        query = query.filter(BomAsset.edition_type == edition_type)
    
    if owner:
        query = query.filter(BomAsset.owner_id == owner)
    
    if min_value is not None:
        query = query.filter(BomAsset.current_social_value >= min_value)  # ✅ Utiliser current_social_value
    
    if max_value is not None:
        query = query.filter(BomAsset.current_social_value <= max_value)  # ✅ Utiliser current_social_value
    
    if has_audio is not None:
        if has_audio:
            query = query.filter(BomAsset.audio_url.isnot(None))
        else:
            query = query.filter(BomAsset.audio_url.is_(None))

    if search:
        if not joined_collection:
            query = query.outerjoin(NFTCollection)
            joined_collection = True
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                BomAsset.title.ilike(search_term),
                BomAsset.artist.ilike(search_term),
                BomAsset.description.ilike(search_term),
                BomAsset.category.ilike(search_term),
                BomAsset.token_id.ilike(search_term),
                cast(BomAsset.tags, String).ilike(search_term),
                NFTCollection.name.ilike(search_term)
            )
        )
    
    # Pagination
    query = query.order_by(BomAsset.created_at.desc())
    query = query.offset(offset).limit(limit)
    
    nfts = query.all()
    
    # Validation des URLs d'animation
    for nft in nfts:
        if not nft.animation_url:
            # Fallback vers l'image de preview
            nft.animation_url = nft.preview_image
    
    return nfts

@router.get("/{token_id}", response_model=NFTResponse)
def get_nft_details(
    token_id: str,
    db: Session = Depends(get_db)
):
    """
    Récupérer les détails d'un NFT spécifique
    ✅ Recherche par token_id NFT
    """
    nft = db.query(BomAsset).filter(
        BomAsset.token_id == token_id,
        BomAsset.is_active == True
    ).first()
    
    if not nft:
        # Fallback: chercher par ID si token_id est numérique
        try:
            nft_id = int(token_id)
            nft = db.query(BomAsset).filter(
                BomAsset.id == nft_id,
                BomAsset.is_active == True
            ).first()
        except ValueError:
            nft = None
    
    if not nft:
        raise HTTPException(status_code=404, detail="NFT non trouvé")
    
    return nft

@router.get("/collections/", response_model=List[CollectionResponse])
def get_nft_collections(
    db: Session = Depends(get_db),
    verified: Optional[bool] = Query(None, description="Filtrer collections vérifiées")
):
    """
    Récupérer toutes les collections NFT
    """
    query = db.query(NFTCollection)
    
    if verified is not None:
        query = query.filter(NFTCollection.is_verified == verified)
    
    collections = query.order_by(NFTCollection.total_items.desc()).all()
    return collections

@router.get("/collections/{collection_id}", response_model=CollectionResponse)
def get_collection_details(
    collection_id: int,
    db: Session = Depends(get_db)
):
    """
    Récupérer les détails d'une collection spécifique
    """
    collection = db.query(NFTCollection).filter(NFTCollection.id == collection_id).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection non trouvée")
    
    return collection

@router.get("/collections/{collection_id}/nfts", response_model=List[NFTResponse])
def get_collection_nfts(
    collection_id: int,
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=100)
):
    """
    Récupérer les NFTs d'une collection spécifique
    """
    collection = db.query(NFTCollection).filter(NFTCollection.id == collection_id).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection non trouvée")
    
    nfts = db.query(BomAsset).filter(
        BomAsset.collection_id == collection_id,
        BomAsset.is_active == True
    ).order_by(BomAsset.created_at.desc()).limit(limit).all()
    
    return nfts

@router.get("/artist/{artist_name}", response_model=List[NFTResponse])
def get_artist_nfts(
    artist_name: str,
    db: Session = Depends(get_db)
):
    """
    Récupérer tous les NFTs d'un artiste spécifique
    """
    nfts = db.query(BomAsset).filter(
        BomAsset.artist.ilike(f"%{artist_name}%"),
        BomAsset.is_active == True
    ).order_by(BomAsset.created_at.desc()).all()
    
    return nfts

@router.get("/categories/list")
def get_available_categories(db: Session = Depends(get_db)):
    """
    Récupérer la liste des catégories NFT disponibles
    """
    categories = db.query(BomAsset.category).filter(
        BomAsset.is_active == True,
        BomAsset.category.isnot(None)
    ).distinct().all()
    
    return {"categories": [cat[0] for cat in categories if cat[0]]}

@router.get("/artists/list")
def get_available_artists(db: Session = Depends(get_db)):
    """
    Récupérer la liste des artistes NFT disponibles
    """
    artists = db.query(BomAsset.artist).filter(
        BomAsset.is_active == True,
        BomAsset.artist.isnot(None)
    ).distinct().all()
    
    return {"artists": [artist[0] for artist in artists if artist[0]]}

@router.get("/collections/list")
def get_available_collections(db: Session = Depends(get_db)):
    """
    Récupérer la liste des collections disponibles
    """
    collections = db.query(NFTCollection.name).filter(
        NFTCollection.is_verified == True
    ).distinct().all()
    
    return {"collections": [col[0] for col in collections if col[0]]}

@router.get("/owned/{user_id}", response_model=List[NFTResponse])
def get_user_owned_nfts(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_token)
):
    """
    Récupérer les NFTs possédés par un utilisateur
    (Authentification requise)
    """
    # Vérifier que l'utilisateur demande ses propres NFTs ou est admin
    if current_user.id != user_id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Accès non autorisé")
    
    nfts = db.query(BomAsset).filter(
        BomAsset.owner_id == user_id,
        BomAsset.is_active == True
    ).order_by(BomAsset.created_at.desc()).all()
    
    return nfts

@router.get("/created/{user_id}", response_model=List[NFTResponse])
def get_user_created_nfts(
    user_id: int,
    db: Session = Depends(get_db)
):
    """
    Récupérer les NFTs créés par un utilisateur
    """
    nfts = db.query(BomAsset).filter(
        BomAsset.creator_id == user_id,
        BomAsset.is_active == True
    ).order_by(BomAsset.created_at.desc()).all()
    
    return nfts

@router.get("/search/", response_model=List[NFTResponse])
def search_nfts(
    q: str = Query(..., min_length=1, description="Terme de recherche"),
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=50)
):
    """
    Rechercher des NFTs par titre, artiste, description, tags, catégorie, collection ou token
    """
    search_term = f"%{q}%"

    query = db.query(BomAsset).outerjoin(NFTCollection)

    search_filter = or_(
        BomAsset.title.ilike(search_term),
        BomAsset.artist.ilike(search_term),
        BomAsset.description.ilike(search_term),
        BomAsset.category.ilike(search_term),
        BomAsset.token_id.ilike(search_term),
        cast(BomAsset.tags, String).ilike(search_term),
        NFTCollection.name.ilike(search_term)
    )

    nfts = query.filter(
        BomAsset.is_active == True,
        search_filter
    ).order_by(BomAsset.created_at.desc()).limit(limit).all()
    
    return nfts
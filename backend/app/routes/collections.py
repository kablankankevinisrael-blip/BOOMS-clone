# backend/app/routes/collections.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.bom_models import BomAsset  # ✅ IMPORT CORRECT
from typing import List

collections_router = APIRouter()

@collections_router.get("/list", response_model=List[str])
async def get_collections_list(
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=100)
):
    """
    Retourne la liste des noms de collections uniques
    """
    try:
        print("📚 Récupération des collections...")
        
        # Récupérer toutes les collections distinctes
        collections = db.query(BomAsset.collection_name)\
            .filter(BomAsset.collection_name.isnot(None))\
            .filter(BomAsset.collection_name != "")\
            .distinct()\
            .limit(limit)\
            .all()
        
        # Extraire les noms
        collection_names = [col[0] for col in collections if col[0]]
        
        print(f"✅ {len(collection_names)} collections trouvées: {collection_names[:5]}...")
        
        return collection_names
        
    except Exception as e:
        print(f"❌ Erreur collections/list: {str(e)}")
        # Retourner une liste vide au lieu de faire planter l'API
        return []
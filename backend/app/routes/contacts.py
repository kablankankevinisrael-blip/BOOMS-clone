from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user_models import User
from app.schemas.contact_schemas import ContactCreate, ContactResponse, UserSearchResponse
from app.services.contact_service import add_contact, get_user_contacts, search_users, remove_contact
from app.services.auth import get_current_user_from_token as get_current_user

router = APIRouter(prefix="/contacts", tags=["contacts"])

@router.post("", response_model=ContactResponse, status_code=status.HTTP_201_CREATED)
def add_contact_endpoint(
    contact_data: ContactCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Ajouter un utilisateur à la liste de contacts"""
    try:
        contact = add_contact(db, current_user.id, contact_data.dict())
        return contact
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erreur interne du serveur")

@router.get("", response_model=list[ContactResponse])
def get_contacts_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Récupérer la liste des contacts - VERSION RÉELLE"""
    try:
        print(f"🔍 [CONTACTS] Récupération contacts - User: {current_user.id}")
        
        # ✅ CORRECTION: Utiliser le service réel
        contacts = get_user_contacts(db, current_user.id)
        
        print(f"✅ [CONTACTS] {len(contacts)} contacts réels retournés")
        return contacts
        
    except Exception as e:
        print(f"❌ [CONTACTS] ERREUR: {str(e)}")
        # Fallback sur données démo
        test_data = [
            {
                "id": 1,
                "contact_user_id": 2,
                "nickname": "Jean Dupont",
                "is_favorite": False,
                "created_at": "2024-01-15T10:30:00",
                "contact_phone": "+33123456789",
                "contact_name": "Jean Dupont"
            }
        ]
        return test_data

@router.get("/search", response_model=list[UserSearchResponse])
def search_users_endpoint(
    search_term: str = Query(..., min_length=3, description="Terme de recherche (téléphone ou nom)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Rechercher des utilisateurs par téléphone ou nom"""
    try:
        users = search_users(db, search_term, current_user.id)
        return users
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erreur interne du serveur")

@router.delete("/{contact_id}")
def remove_contact_endpoint(
    contact_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Supprimer un contact"""
    try:
        success = remove_contact(db, current_user.id, contact_id)
        if success:
            return {"message": "Contact supprimé avec succès"}
        else:
            raise HTTPException(status_code=404, detail="Contact non trouvé")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Erreur interne du serveur")
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta

from app.database import get_db
from app.schemas.user_schemas import UserCreate, UserResponse
from app.services.user_service import UserService
from app.schemas.auth_schemas import Token, UserLogin
from app.services.auth import create_access_token, verify_token, get_current_user_from_token  # ⬅️ CORRECT
from app.config import settings
from app.models.user_models import User

router = APIRouter(prefix="/auth", tags=["authentication"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")

@router.post("/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    try:
        user = UserService.create_user(db, user_data)
        return user
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.post("/login", response_model=Token)
async def login(user_data: UserLogin, db: Session = Depends(get_db)):
    """
    Authentification utilisateur avec phone/password
    Retourne un token JWT
    """
    # ✅ AJOUTER: Debug des données reçues
    print(f"🔐 [BACKEND] Données login reçues: {user_data}")
    print(f"🔐 [BACKEND] Phone: {user_data.phone}, Password length: {len(user_data.password)}")
    
    user = db.query(User).filter(User.phone == user_data.phone).first()
    
    # Vérifier si l'utilisateur existe et le mot de passe
    if not user or not user.check_password(user_data.password):
        print(f"❌ [BACKEND] Échec authentification pour: {user_data.phone}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Numéro de téléphone ou mot de passe incorrect",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    print(f"✅ [BACKEND] Authentification réussie pour: {user.phone} (ID: {user.id})")
    
    # ✅ CORRECTION: Inclure user_id ET sub dans le payload
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.phone, 
            "user_id": user.id  # ⬅️ AJOUT pour compatibilité
        }, 
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "phone": user.phone,
        "full_name": user.full_name
    }

@router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(), 
    db: Session = Depends(get_db)
):
    """
    Endpoint compatible OAuth2 pour la documentation Swagger
    """
    user = db.query(User).filter(User.phone == form_data.username).first()
    
    if not user or not user.check_password(form_data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Numéro de téléphone ou mot de passe incorrect",
        )
    
    # ✅ CORRECTION: Même payload que /login
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.phone,
            "user_id": user.id  # ⬅️ AJOUT
        }, 
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer", 
        "user_id": user.id,
        "phone": user.phone,
        "full_name": user.full_name
    }

# ✅ CORRECTION: SUPPRIMER COMPLÈTEMENT cette fonction pour éviter la double définition
# async def get_current_user(current_user: User = Depends(get_current_user_from_token)):
#     """
#     Dépendance simplifiée qui utilise la fonction unifiée
#     """
#     return current_user

@router.get("/me")
async def read_users_me(current_user: User = Depends(get_current_user_from_token)):  # ✅ UTILISER DIRECTEMENT
    """
    Récupérer les informations de l'utilisateur connecté
    """
    return {
        "id": current_user.id,
        "phone": current_user.phone,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "kyc_status": current_user.kyc_status,
        "is_admin": current_user.is_admin,  # ⬅️ AJOUTÉ ICI - juste cette ligne
        "is_active": current_user.is_active  # Optionnel mais utile
    }
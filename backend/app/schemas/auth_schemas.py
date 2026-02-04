from pydantic import BaseModel, EmailStr, validator
from typing import Optional

class UserLogin(BaseModel):
    phone: str
    password: str

class UserRegister(BaseModel):
    phone: str
    password: str
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    
    @validator('phone')
    def validate_phone(cls, v):
        if not v.strip():
            raise ValueError('Le numéro de téléphone est requis')
        return v.strip()
    
    @validator('password')
    def validate_password(cls, v):
        if len(v) < 6:
            raise ValueError('Le mot de passe doit contenir au moins 6 caractères')
        return v

# ⬅️ AJOUTER UserCreate (alias de UserRegister pour compatibilité)
class UserCreate(UserRegister):
    """Alias de UserRegister pour la compatibilité avec le code existant"""
    pass

class UserResponse(BaseModel):
    id: int
    phone: str
    email: Optional[str]
    full_name: Optional[str]
    kyc_status: str
    is_active: bool
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user_id: int
    phone: str
    full_name: Optional[str]
# backend/app/services/auth.py
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.config import settings
from fastapi import Depends, HTTPException, status
from fastapi.encoders import jsonable_encoder
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user_models import User, UserStatus
from app.services.user_service import UserService

# Configuration du hachage des mots de passe
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def verify_token(token: str):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None

# ✅ CORRECTION: Renommer cette fonction pour éviter les conflits
security = HTTPBearer()

def get_current_user_from_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    """Récupère l'utilisateur actuel à partir du token JWT - VERSION AVEC DEBUG COMPLET"""
    token = credentials.credentials
    
    # 🔍 DEBUG: Token reçu
    print(f"🔍 [AUTH SERVICE] Token reçu (20 premiers): {token[:20]}...")
    
    payload = verify_token(token)
    
    if payload is None:
        print(f"❌ [AUTH SERVICE] Token invalide ou expiré")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 🔍 DEBUG CRITIQUE: Token payload
    print(f"🔍 [AUTH SERVICE] Token payload décodé: {payload}")
    print(f"🔍 [AUTH SERVICE] Token user_id: {payload.get('user_id')}")
    print(f"🔍 [AUTH SERVICE] Token sub (phone): {payload.get('sub')}")
    
    user_id = payload.get("user_id")
    phone = payload.get("sub")
    
    if not user_id and not phone:
        print(f"❌ [AUTH SERVICE] Token sans user_id ni phone")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide (manque user_id ou phone)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = None
    
    # 🔍 PRIORITÉ 1: Chercher par user_id
    if user_id:
        print(f"🔍 [AUTH SERVICE] Recherche user par ID: {user_id}")
        
        # Méthode 1: Query standard
        user = db.query(User).filter(User.id == user_id).first()
        
        if user:
            print(f"✅ [AUTH SERVICE] User trouvé par ID: id={user.id}, phone={user.phone}, name={user.full_name}")
        else:
            print(f"❌ [AUTH SERVICE] AUCUN user trouvé pour ID={user_id}")
            
            # 🔍 DEBUG: Vérifier ce que la DB contient vraiment
            print(f"🔍 [AUTH SERVICE] Vérification DB pour ID={user_id}:")
            
            # Méthode 2: Query brute pour debug
            try:
                result = db.execute(f"SELECT id, phone, full_name FROM users WHERE id = {user_id}").fetchone()
                if result:
                    print(f"⚠️ [AUTH SERVICE] SQL direct: id={result[0]}, phone={result[1]}, name={result[2]}")
                else:
                    print(f"⚠️ [AUTH SERVICE] SQL direct: AUCUN résultat")
            except Exception as e:
                print(f"⚠️ [AUTH SERVICE] Erreur SQL direct: {e}")
    
    # 🔍 PRIORITÉ 2: Chercher par phone si user_id échoue
    if not user and phone:
        print(f"🔍 [AUTH SERVICE] Recherche user par phone (fallback): {phone}")
        user = db.query(User).filter(User.phone == phone).first()
        
        if user:
            print(f"✅ [AUTH SERVICE] User trouvé par phone: id={user.id}, phone={user.phone}, name={user.full_name}")
            
            # 🔍 VÉRIFICATION: Le user_id dans le token correspond-il à celui de la DB?
            if user_id and user.id != user_id:
                print(f"🚨 [AUTH SERVICE] INCOHÉRENCE GRAVE: Token user_id={user_id}, DB user_id={user.id}")
    
    # 🔍 DEBUG: Vérifier TOUS les users dans la DB si toujours pas trouvé
    if not user:
        print(f"⚠️ [AUTH SERVICE] User introuvable. Liste COMPLÈTE des users dans DB:")
        try:
            all_users = db.query(User.id, User.phone, User.full_name).order_by(User.id).all()
            for u in all_users:
                print(f"   - id={u.id}, phone={u.phone}, name={u.full_name}")
                
                # Vérifier si un user a le bon phone
                if phone and u.phone == phone:
                    print(f"   ⚠️ MATCH PHONE! Mais user_id différent? DB={u.id}, Token={user_id}")
                    
        except Exception as e:
            print(f"❌ [AUTH SERVICE] Erreur liste users: {e}")
    
    if user is None:
        print(f"❌ [AUTH SERVICE] Utilisateur non trouvé après toutes les tentatives")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utilisateur non trouvé",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 🔍 VÉRIFICATION FINALE DE COHÉRENCE
    print(f"🔍 [AUTH SERVICE] Vérification cohérence finale:")
    print(f"   - DB User: id={user.id}, phone={user.phone}")
    print(f"   - Token: user_id={user_id}, phone={phone}")
    
    if user_id and user.id != user_id:
        print(f"🚨 [AUTH SERVICE] CRITICAL: DB user.id={user.id} != token user_id={user_id}")
        
        # Force refresh de l'objet depuis la DB
        db.refresh(user)
        print(f"🔍 [AUTH SERVICE] Après refresh: id={user.id}, phone={user.phone}")
        
        if user.id != user_id:
            print(f"🚨 [AUTH SERVICE] INCOHÉRENCE PERSISTANTE!")
    
    if phone and user.phone != phone:
        print(f"⚠️ [AUTH SERVICE] Phone mismatch: DB={user.phone} != token={phone}")
    
    print(f"✅ [AUTH SERVICE] User final validé: id={user.id}, phone={user.phone}, name={user.full_name}")
    
    if not user.is_active:
        print(f"❌ [AUTH SERVICE] User inactif: id={user.id}")

        status_snapshot = UserService.get_status_snapshot(db, user)
        status_value = status_snapshot.get("code")
        if isinstance(status_value, UserStatus):
            status_value = status_value.value

        status_labels = {
            "inactive": "Compte désactivé",
            "active": "Compte actif",
            "review": "Compte en révision",
            "limited": "Compte limité",
            "suspended": "Compte suspendu",
            "banned": "Compte désactivé",
        }

        is_blocking = bool(status_snapshot.get("is_blocking"))
        if not is_blocking and not user.is_active:
            status_value = "inactive"
            is_blocking = True

        account_status = {
            "is_blocking": is_blocking,
            "status": status_value or "inactive",
            "status_label": status_labels.get(status_value or "", "Compte désactivé"),
            "status_reason": status_snapshot.get("reason"),
            "status_message": status_snapshot.get("message"),
            "suspended_until": user.suspended_until or status_snapshot.get("expires_at"),
            "banned_at": user.banned_at,
            "last_status_changed_at": status_snapshot.get("last_changed_at") or user.last_status_changed_at,
            "status_metadata": status_snapshot.get("metadata") or {},
        }

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=jsonable_encoder({
                "code": "account_inactive",
                "message": "Compte désactivé",
                "account_status": account_status,
            }),
        )
    
    return user


# ✅ VERSION SIMPLIFIÉE POUR DÉPENDANCES (optionnel)
def get_current_user_safe(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    """
    Version safe avec fallback - moins de logs
    """
    return get_current_user_from_token(credentials, db)
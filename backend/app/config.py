from functools import cached_property
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Dict, List, Optional
import secrets
from datetime import timedelta
import os
from pathlib import Path

# Charger explicitement le fichier .env
from dotenv import load_dotenv
env_file_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_file_path)

class Settings(BaseSettings):
    # === APPLICATION ===
    APP_NAME: str = "Booms"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    
    # === BASE DE DONNÉES ===
    # 🔐 Toujours lire depuis .env en production!
    # Format: postgresql://user:password@host:port/database
    DATABASE_URL: str = os.getenv('DATABASE_URL', 'postgresql://postgres:autopilot123@localhost:5433/booms_db')
    
    # === SÉCURITÉ JWT ===
    # ⚠️ En production, DOIT être défini dans .env avec une clé forte !
    # Ne JAMAIS utiliser la clé de développement en production
    SECRET_KEY: Optional[str] = None
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    
    # === PAIEMENTS - STRIPE ===
    # Obtenir sur https://dashboard.stripe.com
    # 🔐 Ces clés NE DOIVENT JAMAIS être en dur ! Utiliser .env !
    STRIPE_PUBLISHABLE_KEY: Optional[str] = None
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None

    # === PAIEMENTS - WAVE ===
    WAVE_API_KEY: Optional[str] = None
    WAVE_MERCHANT_KEY: Optional[str] = None
    WAVE_WEBHOOK_SECRET: Optional[str] = None
    WAVE_BASE_URL: str = "https://api.wave.com/v1"
    WAVE_BUSINESS_ACCOUNT: Optional[str] = None

    # === PAIEMENTS - ORANGE MONEY ===
    ORANGE_API_KEY: Optional[str] = None
    ORANGE_API_SECRET: Optional[str] = None
    ORANGE_WEBHOOK_SECRET: Optional[str] = None
    ORANGE_ENVIRONMENT: str = "sandbox"
    ORANGE_BASE_URL: str = "https://api.sandbox.orange.com"
    ORANGE_BUSINESS_PHONE: Optional[str] = None

    # === PAIEMENTS - MTN MoMo ===
    MTN_MOMO_API_KEY: Optional[str] = None
    MTN_MOMO_API_SECRET: Optional[str] = None
    MTN_MOMO_SUBSCRIPTION_KEY: Optional[str] = None
    MTN_MOMO_WEBHOOK_SECRET: Optional[str] = None
    MTN_MOMO_ENVIRONMENT: str = "sandbox"
    # 🔐 Callback URL: lire du .env si possible (peut changer en production)
    MTN_MOMO_CALLBACK_URL: str = os.getenv('MTN_MOMO_CALLBACK_URL', 'http://localhost:8000/webhook/momo')
    MTN_MOMO_CURRENCY: str = "XAF"

    # === VAS COMMISSIONS ===
    YOUR_DEPOSIT_COMMISSION: float = 0.02    # 2% sur dépôts
    YOUR_WITHDRAWAL_COMMISSION: float = 0.03 # 3% sur retraits
    
    # === LIMITES DE TRANSACTIONS ===
    MAX_DEPOSIT_AMOUNT_DAILY: float = 1000000  # 1M FCFA
    MAX_DEPOSIT_AMOUNT_TRANSACTION: float = 500000  # 500K FCFA
    
    # === CORS - À personnaliser selon l'environnement ===
    CORS_ORIGINS: Optional[List[str]] = None
        
    # === API ===
    API_V1_PREFIX: str = "/api/v1"
    # 🔐 Lire du .env en production
    BASE_URL: str = os.getenv('BASE_URL', 'http://localhost:8000')
    
    # === LOGGING ===
    LOG_LEVEL: str = "INFO"
    LOG_DIR: str = "logs"
    
    def __init__(self, **data):
        super().__init__(**data)
        self._validate_secrets()
        self._init_cors_origins()
    
    def _validate_secrets(self):
        """Valider que les secrets requis sont présents."""
        missing_secrets = []
        
        # En production, ces secrets sont OBLIGATOIRES
        if self.ENVIRONMENT == "production":
            required = [
                "SECRET_KEY", "DATABASE_URL",
                "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY",
            ]
            for secret in required:
                if not getattr(self, secret):
                    missing_secrets.append(secret)
        
        if missing_secrets:
            raise ValueError(
                f"🚨 SECRETS MANQUANTS en {self.ENVIRONMENT}: {', '.join(missing_secrets)}\n"
                f"   Veuillez les définir dans le fichier .env"
            )
    
    def _init_cors_origins(self):
        """Initialiser les origines CORS selon l'environnement."""
        if self.CORS_ORIGINS is None:
            if self.ENVIRONMENT == "production":
                # En production, spécifier explicitement les domaines
                self.CORS_ORIGINS = [self.BASE_URL]
            else:
                # En développement, autoriser localhost et certains domaines locaux
                self.CORS_ORIGINS = [
                    "http://localhost:3000",
                    "http://127.0.0.1:3000",
                    "http://localhost:8081",
                    "http://127.0.0.1:8081",
                ]
    
    # === PROPRIÉTÉ CALCULÉE POUR JWT ===
    @property
    def JWT_CONFIG(self):
        return {
            "secret_key": self.SECRET_KEY,
            "algorithm": self.ALGORITHM,
            "access_token_expire_minutes": self.ACCESS_TOKEN_EXPIRE_MINUTES
        }

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    @cached_property
    def PAYMENT_PROVIDER_KEYS(self) -> Dict[str, Dict[str, Optional[str]]]:
        """Retourne les clés API groupées par provider pour un accès centralisé."""
        return {
            "wave": {
                "WAVE_API_KEY": self.WAVE_API_KEY,
                "WAVE_MERCHANT_KEY": self.WAVE_MERCHANT_KEY,
                "WAVE_BUSINESS_ACCOUNT": self.WAVE_BUSINESS_ACCOUNT,
                "WAVE_WEBHOOK_SECRET": self.WAVE_WEBHOOK_SECRET,
            },
            "orange_money": {
                "ORANGE_API_KEY": self.ORANGE_API_KEY,
                "ORANGE_API_SECRET": self.ORANGE_API_SECRET,
                "ORANGE_BUSINESS_PHONE": self.ORANGE_BUSINESS_PHONE,
                "ORANGE_WEBHOOK_SECRET": self.ORANGE_WEBHOOK_SECRET,
            },
            "mtn_momo": {
                "MTN_MOMO_API_KEY": self.MTN_MOMO_API_KEY,
                "MTN_MOMO_API_SECRET": self.MTN_MOMO_API_SECRET,
                "MTN_MOMO_SUBSCRIPTION_KEY": self.MTN_MOMO_SUBSCRIPTION_KEY,
                "MTN_MOMO_WEBHOOK_SECRET": self.MTN_MOMO_WEBHOOK_SECRET,
            },
            "stripe": {
                "STRIPE_PUBLISHABLE_KEY": self.STRIPE_PUBLISHABLE_KEY,
                "STRIPE_SECRET_KEY": self.STRIPE_SECRET_KEY,
                "STRIPE_WEBHOOK_SECRET": self.STRIPE_WEBHOOK_SECRET,
            },
        }

# Instance globale - Validée à l'import
try:
    settings = Settings()
except ValueError as e:
    print(f"❌ ERREUR DE CONFIGURATION: {e}")
    raise
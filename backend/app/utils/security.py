"""
🔐 Utilitaires de sécurité pour BOOMS
Masquage des secrets dans les logs et messages
"""

import re
from typing import Any, Dict

def mask_secret(value: str, visible_chars: int = 4) -> str:
    """
    Masquer un secret en affichant seulement les premiers et derniers caractères.
    
    Args:
        value: Le secret à masquer
        visible_chars: Nombre de caractères visibles à chaque bout
    
    Returns:
        Le secret masqué (ex: "sk_test****abcd1234")
    """
    if not value or len(value) <= visible_chars * 2:
        return "***" * 4
    
    return f"{value[:visible_chars]}{'*' * (len(value) - visible_chars * 2)}{value[-visible_chars:]}"

def safe_str(value: Any) -> str:
    """
    Convertir une valeur en string de manière sécurisée (masquer les secrets).
    """
    if value is None:
        return "None"
    
    value_str = str(value)
    
    # Patterns à masquer
    patterns = {
        r'sk_[a-z0-9_]+': lambda m: mask_secret(m.group(0)),  # Stripe secret keys
        r'pk_[a-z0-9_]+': lambda m: f"pk_****{m.group(0)[-8:]}",  # Stripe public keys
        r'password["\']?\s*[:=]\s*["\']?([^"\']+)': lambda m: 'password=***',  # Passwords
        r'api[_-]?key["\']?\s*[:=]\s*["\']?([^"\']+)': lambda m: 'api_key=***',  # API keys
        r'token["\']?\s*[:=]\s*["\']?([^"\']+)': lambda m: 'token=***',  # Tokens
    }
    
    for pattern, replacement in patterns.items():
        value_str = re.sub(pattern, replacement, value_str, flags=re.IGNORECASE)
    
    return value_str

def sanitize_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Masquer les secrets dans un dictionnaire.
    
    Args:
        data: Dictionnaire à nettoyer
    
    Returns:
        Dictionnaire avec secrets masqués
    """
    sensitive_keys = [
        'password', 'secret', 'token', 'api_key', 'apikey',
        'private_key', 'access_token', 'refresh_token',
        'webhook_secret', 'stripe_secret_key', 'stripe_publishable_key'
    ]
    
    sanitized = {}
    for key, value in data.items():
        if any(sensitive in key.lower() for sensitive in sensitive_keys):
            if isinstance(value, str):
                sanitized[key] = mask_secret(value)
            else:
                sanitized[key] = "***"
        else:
            sanitized[key] = value
    
    return sanitized

def log_api_call(method: str, url: str, status: int, response_time_ms: float = None):
    """
    Logger un appel API de manière sécurisée.
    
    Args:
        method: GET, POST, etc.
        url: URL (sera nettoyée de secrets)
        status: Code de status HTTP
        response_time_ms: Temps de réponse en millisecondes
    """
    # Masquer les secrets dans l'URL
    clean_url = safe_str(url)
    
    if response_time_ms:
        return f"📡 API [{method}] {clean_url} → {status} ({response_time_ms}ms)"
    else:
        return f"📡 API [{method}] {clean_url} → {status}"

def validate_is_not_secret(value: str, name: str) -> bool:
    """
    Vérifier qu'une valeur ne semble pas être un secret.
    Utile pour détecter si des secrets ont été accidentellement logués.
    
    Args:
        value: La valeur à vérifier
        name: Le nom de la variable (pour le message d'erreur)
    
    Returns:
        True si c'est OK, False si cela ressemble à un secret
    """
    secret_patterns = [
        r'^sk_',  # Stripe secret key
        r'^pk_',  # Stripe public key
        r'^whsec_',  # Stripe webhook secret
        r'^rk_',  # Autres clés
        r'^[A-Za-z0-9_\-]{20,}$',  # Chaîne longue aléatoire
    ]
    
    for pattern in secret_patterns:
        if re.match(pattern, str(value)):
            print(f"⚠️  ATTENTION: {name} ressemble à un secret exposé!")
            return False
    
    return True

# Exemple d'utilisation dans les logs
class SafeLogger:
    """Logger sécurisé qui masque les secrets automatiquement."""
    
    @staticmethod
    def info(message: str, **kwargs):
        """Logger un message de niveau INFO."""
        safe_message = safe_str(message)
        safe_kwargs = {k: safe_str(v) for k, v in kwargs.items()}
        print(f"ℹ️  {safe_message}", safe_kwargs if safe_kwargs else "")
    
    @staticmethod
    def warning(message: str, **kwargs):
        """Logger un warning."""
        safe_message = safe_str(message)
        print(f"⚠️  {safe_message}")
    
    @staticmethod
    def error(message: str, **kwargs):
        """Logger une erreur."""
        safe_message = safe_str(message)
        print(f"❌ {safe_message}")
    
    @staticmethod
    def debug(message: str, **kwargs):
        """Logger un message de débogage."""
        safe_message = safe_str(message)
        print(f"🐛 {safe_message}")

# Utilisation dans les fichiers
# Au lieu de: print(f"API Key: {settings.STRIPE_SECRET_KEY}")
# Utiliser: print(f"API Key: {mask_secret(settings.STRIPE_SECRET_KEY)}")
# Ou: SafeLogger.info(f"API Key configured")

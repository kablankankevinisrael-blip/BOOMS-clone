"""
Middleware de sécurité pour protéger les endpoints sensibles
"""
from fastapi import Request
from fastapi.responses import JSONResponse
import time
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)

class RateLimiter:
    """Rate limiter simple basé sur IP"""
    
    def __init__(self, requests_per_minute: int = 60):
        self.requests_per_minute = requests_per_minute
        self.requests = defaultdict(list)
    
    def is_allowed(self, client_ip: str) -> bool:
        """Vérifier si l'IP peut faire une requête"""
        current_time = time.time()
        
        # Nettoyer les vieilles requêtes
        self.requests[client_ip] = [
            req_time for req_time in self.requests[client_ip]
            if current_time - req_time < 60
        ]
        
        # Vérifier la limite
        if len(self.requests[client_ip]) >= self.requests_per_minute:
            return False
        
        # Ajouter la nouvelle requête
        self.requests[client_ip].append(current_time)
        return True

# Instance globale
rate_limiter = RateLimiter(requests_per_minute=60)  # 60 requêtes/minute

async def security_middleware(request: Request, call_next):
    """Middleware de sécurité"""
    
    # Liste des endpoints sensibles
    sensitive_endpoints = [
        "/api/v1/payments/deposit/initiate",
        "/api/v1/payments/withdrawal/initiate",
        "/api/v1/admin/",
        "/api/v1/wallet/"
    ]
    
    path = request.url.path
    
    # Vérifier si c'est un endpoint sensible
    is_sensitive = any(path.startswith(endpoint) for endpoint in sensitive_endpoints)
    
    if is_sensitive:
        # Rate limiting
        client_ip = request.client.host if request.client else "unknown"
        
        if not rate_limiter.is_allowed(client_ip):
            logger.warning(f"⚠️ Rate limit dépassé pour IP: {client_ip}, Path: {path}")
            return JSONResponse(
                status_code=429,
                content={"detail": "Trop de requêtes. Veuillez réessayer dans 1 minute."}
            )
    
    # Headers de sécurité
    response = await call_next(request)
    
    # Ajouter des headers de sécurité
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    
    # Cache control pour les endpoints sensibles
    if is_sensitive:
        response.headers["Cache-Control"] = "no-store, max-age=0"
    
    return response
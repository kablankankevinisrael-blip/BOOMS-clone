#!/usr/bin/env python
"""
🔐 Script de validation de configuration pour BOOMS
Vérifie que tous les secrets requis sont correctement configurés
"""

import os
import sys
from pathlib import Path

def check_env_file():
    """Vérifier que .env existe"""
    env_path = Path(".env")
    if not env_path.exists():
        print("❌ ERREUR: Fichier .env non trouvé!")
        print("   Copiez .env.example en .env et remplissez les valeurs")
        return False
    
    print("✅ Fichier .env trouvé")
    return True

def check_secrets():
    """Vérifier que tous les secrets critiques sont définis"""
    from app.config import settings
    
    # Secrets critiques qui NE DOIVENT JAMAIS être vides
    critical_secrets = {
        "SECRET_KEY": "Clé secrète JWT",
        "DATABASE_URL": "URL de base de données",
    }
    
    # Secrets optionnels selon l'environnement
    optional_by_env = {
        "development": [],
        "production": [
            "STRIPE_SECRET_KEY",
            "STRIPE_PUBLISHABLE_KEY",
            "STRIPE_WEBHOOK_SECRET",
        ]
    }
    
    missing = []
    
    # Vérifier les secrets critiques
    for secret, description in critical_secrets.items():
        value = getattr(settings, secret, None)
        if not value:
            missing.append(f"⚠️  {secret}: {description}")
    
    # Vérifier les secrets optionnels selon l'environnement
    env_secrets = optional_by_env.get(settings.ENVIRONMENT, [])
    for secret in env_secrets:
        value = getattr(settings, secret, None)
        if not value:
            missing.append(f"⚠️  {secret}: Requis en production")
    
    if missing:
        print("❌ SECRETS MANQUANTS:")
        for msg in missing:
            print(f"   {msg}")
        return False
    
    print("✅ Tous les secrets critiques sont définis")
    return True

def check_security_issues():
    """Vérifier les problèmes de sécurité courants"""
    from app.config import settings
    
    issues = []
    
    # DEBUG ne doit JAMAIS être True en production
    if settings.ENVIRONMENT == "production" and settings.DEBUG:
        issues.append("❌ DEBUG=True en PRODUCTION !")
    
    # SECRET_KEY ne doit pas être la clé par défaut
    if "booms-dev-key" in str(settings.SECRET_KEY or ""):
        issues.append("⚠️  SECRET_KEY utilise la clé de développement")
    
    # DATABASE_URL ne doit pas exposer les credentials en clair
    # (mais c'est nécessaire, donc juste un avertissement)
    
    if settings.CORS_ORIGINS and len(settings.CORS_ORIGINS) > 5:
        issues.append("⚠️  CORS_ORIGINS contient beaucoup de domaines (potentiellement non sécurisé)")
    
    if issues:
        print("\n⚠️  AVERTISSEMENTS DE SÉCURITÉ:")
        for issue in issues:
            print(f"   {issue}")
        return False
    
    print("✅ Pas d'avertissements de sécurité majeurs")
    return True

def main():
    """Exécuter tous les vérifications"""
    print("=" * 70)
    print("🔐 VÉRIFICATION DE CONFIGURATION BOOMS")
    print("=" * 70)
    print()
    
    all_ok = True
    
    # Vérifier .env
    if not check_env_file():
        all_ok = False
    print()
    
    # Vérifier les secrets
    try:
        if not check_secrets():
            all_ok = False
    except Exception as e:
        print(f"❌ Erreur lors de la vérification des secrets: {e}")
        all_ok = False
    print()
    
    # Vérifier les problèmes de sécurité
    try:
        if not check_security_issues():
            print("   👉 Adressez ces avertissements avant la production")
    except Exception as e:
        print(f"⚠️  Erreur lors de la vérification de sécurité: {e}")
    print()
    
    # Résumé final
    print("=" * 70)
    if all_ok:
        print("✅ CONFIGURATION VALIDE - Prêt pour le démarrage")
        return 0
    else:
        print("❌ CONFIGURATION INVALIDE - Veuillez corriger les erreurs")
        print("\n   Consultez .env.example pour voir toutes les variables requises")
        return 1

if __name__ == "__main__":
    sys.exit(main())

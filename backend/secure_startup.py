#!/usr/bin/env python3
"""
🔐 Script de Démarrage Sécurisé pour BOOMS
Exécute les vérifications de sécurité avant de démarrer l'application
À utiliser dans le script de lancement (booms-launcher.bat)
"""

import os
import sys
import subprocess
from pathlib import Path

def print_header(text):
    print(f"\n{'=' * 60}")
    print(f"🔐 {text}")
    print(f"{'=' * 60}\n")

def print_success(text):
    print(f"✅ {text}")

def print_error(text):
    print(f"❌ {text}")

def print_warning(text):
    print(f"⚠️  {text}")

def check_env_file():
    """Vérifier que .env existe"""
    backend_path = Path(__file__).parent / "backend"
    env_file = backend_path / ".env"
    
    if not env_file.exists():
        print_error(f".env not found at {env_file}")
        print_warning("Creating .env from .env.example...")
        
        env_example = backend_path / ".env.example"
        if env_example.exists():
            import shutil
            shutil.copy(env_example, env_file)
            print_success(f".env created at {env_file}")
            print_warning("⚠️  Please fill .env with your real credentials!")
            return False
        else:
            print_error(".env.example not found either!")
            return False
    
    print_success(".env file exists")
    return True

def run_validate_config():
    """Exécuter le script de validation"""
    backend_path = Path(__file__).parent / "backend"
    validate_script = backend_path / "validate_config.py"
    
    if not validate_script.exists():
        print_error(f"validate_config.py not found at {validate_script}")
        return False
    
    try:
        result = subprocess.run(
            [sys.executable, str(validate_script)],
            cwd=backend_path,
            capture_output=True,
            text=True
        )
        
        # Afficher la sortie
        if result.stdout:
            print(result.stdout)
        
        if result.returncode != 0:
            if result.stderr:
                print_error("Configuration validation failed:")
                print(result.stderr)
            return False
        
        print_success("Configuration validation passed")
        return True
    
    except Exception as e:
        print_error(f"Error running validate_config.py: {e}")
        return False

def run_check_secrets():
    """Exécuter le scanner de secrets"""
    backend_path = Path(__file__).parent / "backend"
    check_script = backend_path / "check_secrets.py"
    
    if not check_script.exists():
        print_warning(f"check_secrets.py not found at {check_script}")
        return True  # Non-bloquant
    
    try:
        result = subprocess.run(
            [sys.executable, str(check_script)],
            cwd=backend_path.parent,
            capture_output=True,
            text=True
        )
        
        # Afficher la sortie
        if result.stdout:
            print(result.stdout)
        
        if result.returncode != 0:
            print_error("Secret scanner found violations!")
            if result.stderr:
                print(result.stderr)
            return False
        
        print_success("Secret scan passed")
        return True
    
    except Exception as e:
        print_warning(f"Warning running check_secrets.py: {e}")
        return True  # Non-bloquant

def check_security_settings():
    """Vérifier les paramètres de sécurité"""
    backend_path = Path(__file__).parent / "backend"
    env_file = backend_path / ".env"
    
    if not env_file.exists():
        return True
    
    with open(env_file, 'r') as f:
        env_content = f.read()
    
    issues = []
    
    # Vérifier ENVIRONMENT
    if "ENVIRONMENT=development" in env_content and "ENVIRONMENT=production" not in env_content:
        print_warning("Running in DEVELOPMENT mode - OK for local testing")
    elif "ENVIRONMENT=production" not in env_content:
        print_warning("ENVIRONMENT not set - defaulting to development")
    
    # Vérifier DEBUG
    if "DEBUG=True" in env_content:
        print_warning("⚠️  DEBUG=True in .env - disable for production!")
        issues.append("DEBUG=True")
    
    # Vérifier les secrets demo
    demo_values = ["YOUR_KEY", "CHANGE_ME", "DEMO_", "test_", "example_"]
    for value in demo_values:
        if value in env_content:
            print_warning(f"⚠️  Demo/placeholder value found: {value}")
    
    # Vérifier les secrets requis
    required = [
        "SECRET_KEY",
        "DATABASE_URL",
        "STRIPE_PUBLISHABLE_KEY",
        "STRIPE_SECRET_KEY",
    ]
    
    missing = []
    for key in required:
        if f"{key}=" not in env_content or f"{key}=\n" in env_content:
            missing.append(key)
    
    if missing:
        print_warning(f"Missing values: {', '.join(missing)}")
        return False
    
    print_success("Security settings verified")
    return True

def main():
    """Fonction principale"""
    print_header("BOOMS Security Startup Check")
    
    print("Starting security verification...\n")
    
    # Vérifier .env
    if not check_env_file():
        print_error("\n❌ STARTUP BLOCKED: .env configuration required")
        return False
    
    # Valider la configuration
    if not check_security_settings():
        print_error("\n❌ STARTUP BLOCKED: Security settings validation failed")
        return False
    
    # Exécuter validate_config.py
    if not run_validate_config():
        print_error("\n❌ STARTUP BLOCKED: Configuration validation failed")
        return False
    
    # Scanner les secrets (non-bloquant par défaut)
    check_secrets_passed = run_check_secrets()
    if not check_secrets_passed:
        print_error("\n⚠️  WARNING: Secret scan found issues")
        response = input("\n⚠️  Continue anyway? (yes/no): ").lower()
        if response != "yes":
            return False
    
    print_header("✅ All Security Checks Passed!")
    print("✅ You can now start the application\n")
    
    return True

if __name__ == "__main__":
    print("\n" + "=" * 60)
    success = main()
    print("=" * 60 + "\n")
    
    sys.exit(0 if success else 1)

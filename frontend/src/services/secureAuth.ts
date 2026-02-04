// frontend/src/services/secureAuth.ts
// Service d'authentification SÉCURISÉ avec httpOnly cookies

/**
 * ARCHITECTURE SÉCURISÉE RECOMMANDÉE:
 * 
 * Frontend (React/Next)
 * ├─ Pas de tokens en localStorage ❌
 * ├─ Pas de tokens en sessionStorage ❌
 * └─ Tokens dans httpOnly cookies ✅ (Backend envoie)
 * 
 * Backend (FastAPI)
 * ├─ Génère token JWT
 * ├─ Envoie Set-Cookie: auth_token=...
 * │  └─ HttpOnly=true (JavaScript ne peut pas accéder)
 * │  └─ Secure=true (HTTPS uniquement)
 * │  └─ SameSite=Strict (Protection CSRF)
 * └─ Vérifie le cookie automatiquement
 * 
 * Frontend requêtes
 * ├─ Le cookie est automatiquement inclus
 * ├─ Pas besoin de Authorization header manuel
 * └─ XSS ne peut pas accéder au token ✅
 */

// AVANT (INSÉCURISÉ)
// ==================
/*
// ❌ Ancien code à REMPLACER:

async function loginOld(phone: string, password: string) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password })
  });
  
  const data = await response.json();
  
  // MAUVAIS: Stocker en localStorage
  localStorage.setItem('admin_token', data.access_token);
  
  // MAUVAIS: Utiliser en manual headers
  fetch('/api/data', {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
    }
  });
}
*/

// APRÈS (SÉCURISÉ)
// ================

export const secureAuthService = {
  /**
   * Connexion (le backend envoie le cookie httpOnly)
   */
  async login(phone: string, password: string): Promise<{success: boolean}> {
    try {
      // Validation côté client
      if (!phone || phone.length < 9) {
        throw new Error('Phone invalide');
      }
      if (!password || password.length < 8) {
        throw new Error('Password insuffisant');
      }

      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/auth/login`,
        {
          method: 'POST',
          credentials: 'include', // ✅ IMPORTANT: Inclure les cookies
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest', // CSRF protection
          },
          body: JSON.stringify({ phone, password })
        }
      );

      if (response.status === 401) {
        throw new Error('Phone ou password incorrect');
      }

      if (!response.ok) {
        throw new Error('Erreur de connexion');
      }

      // ✅ Le backend a envoyé Set-Cookie automatiquement
      // ✅ Le navigateur le stocke automatiquement
      // ✅ JavaScript ne peut PAS y accéder (HttpOnly)

      return { success: true };

    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  },

  /**
   * Vérifier si authentifié (pas besoin de checker le token)
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/auth/me`,
        {
          method: 'GET',
          credentials: 'include', // ✅ Inclure les cookies
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
          }
        }
      );

      return response.status === 200;

    } catch (error) {
      return false;
    }
  },

  /**
   * Déconnexion (backend supprime le cookie)
   */
  async logout(): Promise<void> {
    try {
      await fetch(
        `${process.env.REACT_APP_API_URL}/auth/logout`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
          }
        }
      );

      // ✅ Backend a envoyé Set-Cookie: auth_token=; Max-Age=0
      // ✅ Cookie est automatiquement supprimé par le navigateur

    } catch (error) {
      console.error('Logout failed:', error);
    }
  },

  /**
   * Appel API sécurisé (le cookie est automatique!)
   */
  async fetchSecure(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(
      `${process.env.REACT_APP_API_URL}${endpoint}`,
      {
        ...options,
        credentials: 'include', // ✅ TOUJOURS inclure les cookies
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...options.headers
        }
      }
    );

    if (response.status === 401) {
      // Token expiré ou invalide
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    return response;
  }
};

// ==============================================
// CONFIGURATION BACKEND REQUISE
// ==============================================
/*
# FastAPI backend - settings nécessaires:

from fastapi.responses import JSONResponse
from fastapi import Cookie

# Configuration CORS pour HTTPS
app.add_middleware(
    CORSMiddleware,
    allow_origins=['https://booms.com'],
    allow_credentials=True,  # ✅ IMPORTANT pour les cookies
    allow_methods=['GET', 'POST', 'PUT', 'DELETE'],
    allow_headers=['*'],
)

@app.post('/auth/login')
async def login(phone: str, password: str):
    # Validation et authentification...
    
    # Créer le token JWT
    token = create_jwt_token(user_id)
    
    # Envoyer avec httpOnly cookie
    response = JSONResponse({'success': True})
    response.set_cookie(
        key='auth_token',
        value=token,
        httponly=True,      # ✅ JavaScript ne peut pas accéder
        secure=True,        # ✅ HTTPS uniquement
        samesite='strict',  # ✅ CSRF protection
        max_age=3600,       # ✅ 1 heure d'expiration
        domain='booms.com'  # ✅ Domaine spécifique
    )
    return response

@app.post('/auth/logout')
async def logout():
    # Supprimer le cookie
    response = JSONResponse({'success': True})
    response.delete_cookie('auth_token')
    return response

# Middleware pour valider le cookie
@app.middleware('http')
async def verify_cookie(request, call_next):
    token = request.cookies.get('auth_token')
    if token:
        request.state.user = verify_jwt_token(token)
    response = await call_next(request)
    return response
*/

// ==============================================
// UTILISATION DANS LES COMPOSANTS
// ==============================================
/*
import { secureAuthService } from '@/services/secureAuth';

export function LoginForm() {
  const handleLogin = async (phone: string, password: string) => {
    try {
      await secureAuthService.login(phone, password);
      // ✅ Le cookie httpOnly est automatiquement stocké
      // ✅ Pas besoin de le manipuler
      navigate('/dashboard');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return <form onSubmit={() => handleLogin(phone, password)}>...</form>;
}

export function ProtectedComponent() {
  useEffect(() => {
    secureAuthService.fetchSecure('/api/data')
      .then(r => r.json())
      .then(data => {
        // Les cookies sont automatiquement inclus! ✅
      });
  }, []);
}
*/

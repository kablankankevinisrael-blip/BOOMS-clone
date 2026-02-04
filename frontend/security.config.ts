// 🔐 Configuration Sécurisée pour Frontend BOOMS
// Utiliser les variables d'environnement, JAMAIS des secrets en dur

// ❌ MAUVAIS - Ne JAMAIS faire ça
// const API_KEY = "pk_test_...");  // NE JAMAIS exposer!
// const SECRET = "secret123";

// ✅ BON - Utiliser les variables d'env
// Lecture depuis .env.local ou .env.example
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.REACT_APP_API_URL || "http://localhost:8000/api/v1";
const STRIPE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.REACT_APP_STRIPE_PUBLIC_KEY;

// ✅ BON - Les clés publiques peuvent être exposées (Stripe publishable key)
// Mais les clés secrètes NE DOIVENT JAMAIS être en frontend

export const API_CONFIG = {
    BASE_URL: API_BASE_URL,
    TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
};

export const AUTH_CONFIG = {
    TOKEN_KEY: "auth_token",
    USER_KEY: "current_user",
    
    // ⚠️ ALERTE SÉCURITÉ: localStorage n'est PAS sécurisé pour tokens JWT!
    // Vulnerable to XSS attacks
    // À remplacer par: httpOnly cookies + secure session (backend-side)
    setToken: (token: string) => {
        if (!token || token.length < 50) {
            console.error("Invalid token format");
            return false;
        }
        
        // Vérification basique: token ne doit pas être une clé secrète
        if (token.startsWith("sk_") || token.startsWith("whsec_")) {
            console.error("SECURITY: Attempting to store secret key!");
            return false;
        }
        
        // ⚠️ Stockage en localStorage uniquement en DÉVELOPPEMENT
        // EN PRODUCTION: Implémenter httpOnly cookies côté backend
        try {
            localStorage.setItem(AUTH_CONFIG.TOKEN_KEY, token);
            return true;
        } catch (error) {
            console.error("Failed to store token", error);
            return false;
        }
    },
    
    removeToken: () => {
        localStorage.removeItem(AUTH_CONFIG.TOKEN_KEY);
    },
    
    getToken: () => {
        return localStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
    },
};

export const STRIPE_CONFIG = {
    // ✅ La clé publique (publishable key) est sans danger d'être exposée
    PUBLIC_KEY: STRIPE_KEY || "pk_test_",
};

// ✅ BON - Fonctions sécurisées pour les appels API
export async function secureApiCall(
    endpoint: string,
    options: RequestInit = {}
) {
    const token = localStorage.getItem(AUTH_CONFIG.TOKEN_KEY);
    
    const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...options.headers,
    };
    
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    
    try {
        const response = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, {
            ...options,
            headers,
        });
        
        if (response.status === 401) {
            // Token expiré ou invalide
            AUTH_CONFIG.removeToken();
            // ⚠️ En React Native/Expo: ne pas utiliser window.location.href
            // À gérer via navigation stack (React Navigation)
            console.warn("Authentication failed. User should be redirected to login.");
            // Navigation doit être gérée au niveau du composant
            // via navigation.navigate('Login')
        }
        
        return response;
    } catch (error) {
        console.error("API call failed:", error);
        // ❌ Ne JAMAIS exposer les détails d'erreur au backend
        throw new Error("Une erreur s'est produite. Contactez le support.");
    }
}

// ✅ BON - Gestion sécurisée des données sensibles
export function redactSensitiveData(data: any): any {
    const sensitive = [
        "password",
        "secret",
        "token",
        "api_key",
        "card_number",
        "cvv"
    ];
    
    if (typeof data === "object") {
        return Object.keys(data).reduce((acc, key) => {
            if (sensitive.some(s => key.toLowerCase().includes(s))) {
                acc[key] = "***";
            } else {
                acc[key] = data[key];
            }
            return acc;
        }, {} as any);
    }
    
    return data;
}

// Vérifier qu'aucun secret n'a été accidentellement loggé
export function detectExposedSecrets(message: string): boolean {
    const secretPatterns = [
        /sk_[a-zA-Z0-9_]{20,}/,  // Stripe secret key (sk_test_... ou sk_live_...)
        /whsec_[a-zA-Z0-9_]{20,}/,  // Webhook secret
        /Bearer\s+[a-zA-Z0-9_\-\.]{100,}/,  // JWT tokens (généralement > 100 chars)
        /database_password[\s=:]+[^\s]+/i,  // Database credentials
        /api_key[\s=:]+[^\s]+/i,  // API keys
        /Authorization[\s:]+Bearer/i,  // Auth headers
    ];
    
    for (const pattern of secretPatterns) {
        if (pattern.test(String(message))) {
            console.error("🚨 SECURITY: Potential secret detected in logs!");
            return true;
        }
    }
    
    return false;
}

// Exemple d'utilisation dans les composants
/*
// ❌ MAUVAIS
console.log("Token:", userToken);
console.log("Full API Response:", response);

// ✅ BON
console.log("Login successful");
console.log("API Response:", redactSensitiveData(response));
*/

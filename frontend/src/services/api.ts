// frontend/src/services/api.ts - VERSION CORRIGÉE AVEC FORCE UPDATE
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decodeBase64Url } from '../utils/base64';
// Configuration - Lecture depuis .env.local via EXPO_PUBLIC_API_BASE_URL
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';
console.log('🔗 Configuration API:', API_BASE_URL);

// Créer l'instance axios
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// ✅ Événements globaux
const createEventEmitter = () => {
  const listeners: Array<() => void> = [];

  return {
    emit: () => listeners.forEach(listener => listener()),
    subscribe: (listener: () => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index > -1) listeners.splice(index, 1);
      };
    }
  };
};

const createPayloadEmitter = <T,>() => {
  const listeners: Array<(payload: T) => void> = [];

  return {
    emit: (payload: T) => listeners.forEach(listener => listener(payload)),
    subscribe: (listener: (payload: T) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index > -1) listeners.splice(index, 1);
      };
    }
  };
};

export const authEventEmitter = createEventEmitter();
export const accountStatusEmitter = createPayloadEmitter<Record<string, unknown>>();

// ✅ Token en mémoire
let cachedToken: string | null = null;

// ✅ NOUVEAU: Fonctions pour gérer le cache MANUELLEMENT
export const forceUpdateCachedToken = (token: string): void => {
  cachedToken = token;
  console.log('🔐 [API] Token cache FORCÉMENT mis à jour');
};

export const clearCachedToken = (): void => {
  cachedToken = null;
  console.log('🔐 [API] Token cache VIDÉ');
};

export const getCurrentCachedToken = (): string | null => {
  return cachedToken;
};

// Fonction pour mettre à jour le token en cache
export const updateCachedToken = async (): Promise<void> => {
  try {
    cachedToken = await AsyncStorage.getItem('booms_token');
    console.log('🔐 Token en cache mis à jour:', cachedToken ? 'OUI' : 'NON');
  } catch (error) {
    console.error('❌ Erreur mise à jour token cache:', error);
    cachedToken = null;
  }
};

// Fonction pour décoder un token JWT
const decodeJWT = (token: string | null): any => {
  if (!token) return null;
  try {
    const base64Url = token.split('.')[1];
    const binaryPayload = decodeBase64Url(base64Url);
    const jsonPayload = decodeURIComponent(
      binaryPayload
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('❌ Erreur décodage JWT:', error);
    return null;
  }
};

// ✅ CORRECTION: Vérifier token SANS appeler /auth/me
const refreshUserInfo = async (): Promise<boolean> => {
  try {
    console.log('🔄 [API] Vérification token seulement (SANS /auth/me)...');
    
    // Lire DIRECTEMENT depuis AsyncStorage pour être sûr
    const freshToken = await AsyncStorage.getItem('booms_token');
    
    if (!freshToken) {
      console.log('❌ [API] Pas de token dans AsyncStorage');
      cachedToken = null;
      return false;
    }
    
    // Mettre à jour le cache avec le token frais
    cachedToken = freshToken;
    
    // Décoder le token pour vérifier sa validité
    const payload = decodeJWT(freshToken);
    if (!payload || !payload.user_id) {
      console.log('❌ [API] Token invalide');
      cachedToken = null;
      return false;
    }
    
    console.log(`✅ [API] Token valide pour user ${payload.user_id}`);
    return true;
    
  } catch (error) {
    console.error('❌ [API] Erreur vérification token:', error);
    cachedToken = null;
    return false;
  }
};

// ✅ INTERCEPTEUR DE REQUÊTES CORRIGÉ - TOKEN FRAIS POUR /auth/me
api.interceptors.request.use(
  async (config) => {
    try {
      // Ignorer les requêtes d'authentification
      if (config.url?.includes('/auth/login') || config.url?.includes('/auth/register')) {
        return config;
      }
      
      // ✅ CRITIQUE: POUR /auth/me - LIRE DIRECTEMENT AsyncStorage
      if (config.url?.includes('/auth/me')) {
        console.log('⚠️ [API] /auth/me - Lecture DIRECTE depuis AsyncStorage');
        const freshToken = await AsyncStorage.getItem('booms_token');
        
        if (freshToken && config.headers) {
          config.headers.Authorization = `Bearer ${freshToken}`;
          // Mettre à jour le cache aussi
          cachedToken = freshToken;
          console.log(`✅ [API] Token FRESH pour /auth/me: ${freshToken.substring(0, 20)}...`);
          return config;
        } else {
          console.log('❌ [API] /auth/me - Pas de token dans AsyncStorage');
        }
      }
      
      // Pour les autres requêtes, vérifier le cache
      if (!cachedToken) {
        await updateCachedToken();
      }
      
      if (cachedToken && config.headers) {
        config.headers.Authorization = `Bearer ${cachedToken}`;
        console.log(`✅ [API] Token ajouté à: ${config.method?.toUpperCase()} ${config.url}`);
      } else {
        console.log(`🔓 [API] Requête sans token: ${config.method?.toUpperCase()} ${config.url}`);
      }
      
      return config;
    } catch (error) {
      console.error('❌ [API] Erreur intercepteur requête:', error);
      return config;
    }
  }
);

// ✅ INTERCEPTEUR DE RÉPONSES - CORRIGÉ
api.interceptors.response.use(
  (response) => {
    console.log(`✅ [API] Réponse ${response.status}: ${response.config.url}`);
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    const errorDetail = error.response?.data?.detail;
    const inactivePayload =
      error.response?.status === 403 &&
      errorDetail &&
      errorDetail.code === 'account_inactive'
        ? errorDetail
        : null;

    if (inactivePayload) {
      console.warn('⛔ [API] Compte inactif - arrêt des retries');
      if (inactivePayload.account_status) {
        accountStatusEmitter.emit(inactivePayload.account_status);
      }
      return Promise.reject(error);
    }
    
    console.error(`❌ [API] Erreur ${error.config?.method?.toUpperCase()} ${error.config?.url}:`, {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });
    
    // Gestion erreur 401
    if (error.response?.status === 401 && !originalRequest._retry) {
      console.log('🔐 [API] Token expiré ou invalide - vérification...');
      
      originalRequest._retry = true;
      
      try {
        // Vérifier token
        const tokenValid = await refreshUserInfo();
        
        if (!tokenValid) {
          // Token invalide, déconnecter
          console.log('🚨 [API] Token invalide - déconnexion automatique');
          
          cachedToken = null;
          await AsyncStorage.multiRemove(['booms_token', 'booms_user']);
          authEventEmitter.emit();
          
          return Promise.reject(error);
        } else {
          // Token valide, réessayer
          console.log('🔄 [API] Token valide - réessai de la requête');
          
          // Lire token frais
          const freshToken = await AsyncStorage.getItem('booms_token');
          cachedToken = freshToken;
          
          if (originalRequest.headers && cachedToken) {
            originalRequest.headers.Authorization = `Bearer ${cachedToken}`;
          }
          
          return api(originalRequest);
        }
      } catch (refreshError) {
        console.error('❌ [API] Erreur lors du rafraîchissement:', refreshError);
        
        cachedToken = null;
        await AsyncStorage.multiRemove(['booms_token', 'booms_user']);
        authEventEmitter.emit();
        
        return Promise.reject(error);
      }
    }
    
    // Erreur réseau
    if (!error.response) {
      console.error('🌐 [API] Erreur réseau - vérifiez la connexion internet');
      throw new Error('Erreur réseau. Vérifiez votre connexion internet.');
    }
    
    return Promise.reject(error);
  }
);

// Fonctions utilitaires pour l'authentification
export const authAPI = {
  register: (userData: any) => api.post('/auth/register', userData),
  login: (credentials: { phone: string; password: string }) => 
    api.post('/auth/login', credentials),
  getCurrentUser: () => api.get('/auth/me'),
};

// API pour les Boms
export const bomsAPI = {
  getBoms: () => api.get('/boms'),
  getBomDetails: (id: number) => api.get(`/boms/${id}`),
};

// ✅ Gestion du token RENFORCÉE
export const tokenService = {
  setToken: async (token: string): Promise<void> => {
    try {
      // 1. Stocker dans AsyncStorage
      await AsyncStorage.setItem('booms_token', token);
      
      // 2. FORCER la mise à jour du cache IMMÉDIATEMENT
      cachedToken = token;
      forceUpdateCachedToken(token);
      
      // 3. Vérifier que c'est bien stocké
      const verifyToken = await AsyncStorage.getItem('booms_token');
      if (verifyToken === token) {
        console.log('✅ [TOKEN] Stocké et vérifié avec succès');
      } else {
        console.error('❌ [TOKEN] Incohérence après stockage!');
      }
      
      console.log('🔑 Token stocké avec succès');
    } catch (error) {
      console.error('❌ Erreur stockage token:', error);
      throw error;
    }
  },
  
  removeToken: async (): Promise<void> => {
    try {
      await AsyncStorage.removeItem('booms_token');
      cachedToken = null;
      clearCachedToken();
      console.log('🔑 Token supprimé');
    } catch (error) {
      console.error('❌ Erreur suppression token:', error);
      throw error;
    }
  },
  
  getToken: async (): Promise<string | null> => {
    try {
      // Toujours lire depuis AsyncStorage pour être sûr
      const token = await AsyncStorage.getItem('booms_token');
      cachedToken = token;
      return token;
    } catch (error) {
      console.error('❌ Erreur récupération token:', error);
      return null;
    }
  },
  
  // ✅ NOUVEAU: Forcer la synchronisation
  syncToken: async (): Promise<void> => {
    try {
      const token = await AsyncStorage.getItem('booms_token');
      cachedToken = token;
      console.log('🔄 [TOKEN] Synchronisé:', token ? 'OUI' : 'NON');
    } catch (error) {
      console.error('❌ Erreur synchronisation token:', error);
    }
  }
};

export default api;
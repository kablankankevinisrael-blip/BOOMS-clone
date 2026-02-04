// frontend/src/contexts/AuthContext.tsx
import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import AuthService, { User } from '../services/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStatusEmitter, authEventEmitter, authAPI, tokenService } from '../services/api';
import { boomsWebSocket } from '../services/websocket';
import { performCompleteLogout } from '../utils/authCleanup';
import { decodeBase64Url } from '../utils/base64';
import supportService, { AccountStatusSnapshot } from '../services/support';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  accountStatus: AccountStatusSnapshot | null;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  refreshAuth: () => Promise<void>;
  refreshUserInfo: () => Promise<boolean>;
  refreshAccountStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accountStatus, setAccountStatus] = useState<AccountStatusSnapshot | null>(null);
  const isAccountBlocked =
    accountStatus?.status === 'banned' ||
    accountStatus?.status === 'suspended' ||
    accountStatus?.status === 'inactive' ||
    accountStatus?.status === 'deleted';

  const refreshAccountStatus = async (): Promise<void> => {
    if (!token) {
      setAccountStatus(null);
      return;
    }
    try {
      const snapshot = await supportService.getAccountStatus();
      setAccountStatus(snapshot);
    } catch (error) {
      const inactivePayload = extractInactivePayload(error);
      if (inactivePayload) {
        setAccountStatus(inactivePayload);
        await tokenService.removeToken();
        setToken(null);
        return;
      }
      console.warn('⚠️ [AUTH] Impossible de récupérer le statut du compte');
    }
  };

  // ✅ FONCTION POUR DÉCODER LES TOKENS JWT
  const decodeJWT = (token: string | null): any => {
    if (!token) return null;
    
    try {
      // JWT format: header.payload.signature
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.error('❌ [AUTH] Format JWT invalide');
        return null;
      }
      
      const base64Url = parts[1];
      
      // Convertir base64url en base64 standard
      const binaryPayload = decodeBase64Url(base64Url);
      const decoded = decodeURIComponent(
        binaryPayload
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      
      return JSON.parse(decoded);
    } catch (error) {
      console.error('❌ [AUTH] Erreur décodage JWT:', error);
      return null;
    }
  };

  const refreshUserInfo = async (): Promise<boolean> => {
    try {
      if (!token) {
        console.log('❌ [AUTH] Pas de token pour rafraîchir les infos');
        return false;
      }
      
      console.log('🔄 [AUTH] Rafraîchissement des infos utilisateur...');
      const response = await authAPI.getCurrentUser();
      
      if (response.data) {
        const newUserId = response.data.id;
        const currentUserId = user?.id;
        
        // ✅ VÉRIFICATION CRITIQUE DE COHÉRENCE
        if (currentUserId && newUserId && currentUserId !== newUserId) {
          console.error(`🚨 [AUTH] INCOHÉRENCE DÉTECTÉE: current=${currentUserId}, /auth/me=${newUserId}`);
          
          // Vérifier le token pour identifier la source du problème
          const currentToken = await tokenService.getToken();
          if (currentToken) {
            const payload = decodeJWT(currentToken);
            const tokenUserId = payload?.user_id || payload?.sub;
            console.log(`🔍 [AUTH] Token payload: user_id=${tokenUserId}`);
            
            // Si le token dit user_id=X mais /auth/me dit user_id=Y → Problème backend
            if (tokenUserId && tokenUserId !== newUserId) {
              console.error(`🚨 [AUTH] INCOHÉRENCE BACKEND: Token=${tokenUserId}, /auth/me=${newUserId}`);
              // NE PAS écraser avec de mauvaises données
              return false;
            }
          }
          
          // Si le token correspond au nouveau user_id, c'est peut-être une mise à jour légitime
          console.warn(`⚠️ [AUTH] User ID changé de ${currentUserId} à ${newUserId}`);
        }
        
        setUser(response.data);
        await AsyncStorage.setItem('booms_user', JSON.stringify(response.data));
        refreshAccountStatus().catch(() => undefined);
        
        console.log('✅ [AUTH] Infos utilisateur rafraîchies avec succès:', response.data.id);
        return true;
      }
      return false;
    } catch (error) {
      const inactivePayload = extractInactivePayload(error);
      if (inactivePayload) {
        setAccountStatus(inactivePayload);
        await tokenService.removeToken();
        setToken(null);
        return false;
      }
      console.error('❌ [AUTH] Erreur lors du rafraîchissement:', error);
      return false;
    }
  };

  const refreshAuth = async () => {
    try {
      console.log('🔄 [AUTH] Rafraîchissement auth...');
      const authToken = await AuthService.getToken();
      const userData = await AuthService.getCurrentUser();
      
      console.log('🔐 [AUTH] Token récupéré:', authToken ? 'OUI' : 'NON');
      console.log('👤 [AUTH] Utilisateur récupéré:', userData ? `OUI (${userData.id})` : 'NON');
      
      setToken(authToken);
      setUser(userData);

      if (authToken) {
        refreshAccountStatus().catch(() => undefined);
      } else {
        setAccountStatus(null);
      }
      
      // 🚨 SYNC WebSocket si user existe
      if (userData && authToken) {
        console.log('🔌 [AUTH] Sync WebSocket pour user:', userData.id);
        setTimeout(() => {
          boomsWebSocket.connectWithAuth(userData.id, authToken);
        }, 500);
      }
      
      return { token: authToken, user: userData };
    } catch (error) {
      console.error('❌ [AUTH] Erreur rafraîchissement auth:', error);
      setToken(null);
      setUser(null);
      return { token: null, user: null };
    }
  };

  useEffect(() => {
    if (!token) return;
    
    const refreshInterval = setInterval(async () => {
      console.log('⏰ [AUTH] Rafraîchissement périodique des infos utilisateur');
      await refreshUserInfo();
    }, 5 * 60 * 1000);
    
    return () => clearInterval(refreshInterval);
  }, [token]);

  useEffect(() => {
    const unsubscribe = authEventEmitter.subscribe(() => {
      console.log('👋 [AUTH] Événement de déconnexion reçu depuis l\'API');
      handleAutoLogout();
    });
    
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = accountStatusEmitter.subscribe((payload) => {
      if (!payload) return;
      setAccountStatus(payload as AccountStatusSnapshot);
    });

    return unsubscribe;
  }, []);

  const handleAutoLogout = async () => {
    try {
      console.log('🔐 [AUTH] Déconnexion automatique initiée');
      boomsWebSocket.disconnect();
      await AuthService.logout();
      setUser(null);
      setToken(null);
      setAccountStatus(null);
      console.log('👋 [AUTH] Déconnexion automatique réussie');
    } catch (error) {
      console.error('❌ [AUTH] Erreur déconnexion automatique:', error);
      setUser(null);
      setToken(null);
      setAccountStatus(null);
    }
  };

  const checkAuthStatus = async () => {
    setIsLoading(true);
    try {
      console.log('🔐 [AUTH] Vérification du statut d\'authentification...');
      const { token: authToken, user: userData } = await refreshAuth();
      
      if (authToken && userData) {
        console.log('🔄 [AUTH] Authentification valide, rafraîchissement initial...');
        await refreshUserInfo();
        await refreshAccountStatus();
      }
    } catch (error) {
      console.error('🔐 [AUTH] Erreur vérification auth:', error);
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  // AJOUT: Écouter les événements de mismatch user_id
  useEffect(() => {
    // Écouter les événements de mismatch user_id
    const unsubscribeMismatch = boomsWebSocket.onMessage((message: any) => {
      if (message.type === 'user_id_mismatch') {
        const { client_user_id, server_user_id } = message;
        
        console.warn(`⚠️ [AUTH] User mismatch détecté: client=${client_user_id}, serveur=${server_user_id}`);
        
        // Si le mismatch est significatif (différent de 1), vérifier l'authentification
        if (Math.abs((user?.id || 0) - server_user_id) > 1) {
          console.log('🔍 [AUTH] Vérification de l\'authentification...');
          setTimeout(() => {
            refreshAuth();
          }, 1000);
        }
      }
    });
    
    return unsubscribeMismatch;
  }, [user?.id]);

  const login = async (phone: string, password: string) => {
    setIsLoading(true);
    try {
      console.log('🔐 [AUTH] Tentative de connexion avec:', phone);
      
      // 🚨 ÉTAPE 1 : Cleanup COMPLET avant tout
      console.log('🧹 [AUTH] Cleanup pré-connexion...');
      await performCompleteLogout();
      boomsWebSocket.resetForNewUser();
      
      // 🚨 ÉTAPE 2 : Login API
      const authData = await AuthService.login(phone, password);
      console.log('✅ [AUTH] Login API réussi, token:', authData.access_token?.substring(0, 20) + '...');
      
      // Décodez le token pour vérifier le user_id
      const tokenPayload = decodeJWT(authData.access_token);
      const tokenUserId = tokenPayload?.user_id || tokenPayload?.sub;
      console.log(`🔍 [AUTH] Token décodé: user_id=${tokenUserId}`);
      
      // 🚨 ÉTAPE 3 : Récupérer user info (sans activer la session tant que non validée)
      let fullUserData: User | null = null;
      try {
        const userResponse = await authAPI.getCurrentUser();
        fullUserData = userResponse.data;
      } catch (error: any) {
        const inactivePayload = extractInactivePayload(error);
        if (inactivePayload) {
          setAccountStatus(inactivePayload);
          await tokenService.removeToken();
          setToken(null);
          setUser(null);
          try {
            await AsyncStorage.setItem(
              'booms_contact',
              JSON.stringify({ phone: authData.phone, email: '' })
            );
          } catch {
            // silencieux
          }
          console.log('⛔ [AUTH] Compte inactif détecté, écran de blocage activé');
          return;
        }
        throw error;
      }
      
      if (fullUserData) {
        console.log('👤 [AUTH] User data reçu:', fullUserData.id, fullUserData.phone);
        
        // VÉRIFICATION FINALE DE COHÉRENCE
        if (tokenUserId && fullUserData.id !== tokenUserId) {
          console.error(`🚨 [AUTH] INCOHÉRENCE CRITIQUE: Token=${tokenUserId}, /auth/me=${fullUserData.id}`);
          throw new Error('Incohérence de données utilisateur détectée');
        }
        
        setUser(fullUserData);
        await AsyncStorage.setItem('booms_user', JSON.stringify(fullUserData));

        // ✅ Activer la session uniquement après validation /auth/me
        setToken(authData.access_token);
        
        // 🚨 ÉTAPE 5 : Connecter WebSocket APRÈS stockage
        console.log('🔌 [AUTH] Lancement connexion WebSocket...');
        setTimeout(async () => {
          try {
            await boomsWebSocket.connectWithAuth(fullUserData.id, authData.access_token);
            console.log('✅ [AUTH] WebSocket connecté pour user:', fullUserData.id);
          } catch (wsError) {
            console.error('⚠️ [AUTH] WebSocket erreur:', wsError);
          }
        }, 300); // Petit délai

        refreshAccountStatus().catch(() => undefined);
      } else {
        const userData: User = {
          id: authData.user_id || tokenUserId,
          phone: authData.phone,
          full_name: authData.full_name,
          email: '',
          kyc_status: 'pending',
          is_admin: false
        };
        setUser(userData);
        setToken(authData.access_token);
      }
      
      console.log('✅ [AUTH] Connexion COMPLÈTE réussie');
    } catch (error: any) {
      console.error('❌ [AUTH] Erreur de connexion:', error.message);
      
      // 🚨 Cleanup forcé en cas d'erreur
      await performCompleteLogout();
      boomsWebSocket.resetForNewUser();
      setUser(null);
      setToken(null);
      setAccountStatus(null);
      
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      console.log('🔐 [AUTH] Déconnexion complète...');
      
      // 🚨 ÉTAPE 1 : Déconnecter WebSocket
      boomsWebSocket.resetForNewUser();
      
      // 🚨 ÉTAPE 2 : Logout API
      await AuthService.logout();
      
      // 🚨 ÉTAPE 3 : Cleanup local
      setUser(null);
      setToken(null);
      setAccountStatus(null);
      
      // 🚨 ÉTAPE 4 : Cleanup storage
      await AsyncStorage.multiRemove(['booms_token', 'booms_user']);
      
      console.log('👋 [AUTH] Déconnexion COMPLÈTE réussie');
    } catch (error) {
      console.error('❌ [AUTH] Erreur déconnexion:', error);
      setUser(null);
      setToken(null);
      setAccountStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  const value: AuthContextType = {
    user,
    token,
    isLoading,
    accountStatus,
    login,
    logout,
    isAuthenticated: !!user && !!token && !isAccountBlocked,
    refreshAuth,
    refreshUserInfo,
    refreshAccountStatus,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

const extractInactivePayload = (error: any): AccountStatusSnapshot | null => {
  const detail = error?.response?.data?.detail;
  if (detail?.code === 'account_inactive' && detail?.account_status) {
    return detail.account_status as AccountStatusSnapshot;
  }
  return null;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth doit être utilisé dans un AuthProvider');
  }
  return context;
};
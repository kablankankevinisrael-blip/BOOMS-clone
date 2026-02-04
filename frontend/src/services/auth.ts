// frontend/src/services/auth.ts - VERSION AVEC DEBUG COMPLET
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { boomsWebSocket } from './websocket';

export interface User {
  id: number;
  phone: string;
  email: string;
  full_name: string;
  kyc_status: string;
  is_admin?: boolean;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user_id: number;
  phone: string;
  full_name: string;
}

class AuthService {
  private readonly TOKEN_KEY = 'booms_token';
  private readonly USER_KEY = 'booms_user';

  async login(phone: string, password: string): Promise<AuthResponse> {
    try {
      console.log('🔐 [AUTH] Tentative de connexion...', { phone, passwordLength: password.length });
      
      const credentials = {
        phone: phone.trim(),
        password: password
      };
      
      console.log('📤 [AUTH] Données envoyées:', JSON.stringify(credentials, null, 2));
      console.log('🌐 [AUTH] URL complète: /auth/login');
      
      const response = await api.post<AuthResponse>('/auth/login', credentials, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000
      });

      console.log('✅ [AUTH] Réponse reçue:', {
        status: response.status,
        data: response.data,
        hasToken: !!response.data.access_token
      });

      if (response.data.access_token) {
        await this.storeAuthData(response.data);
        console.log('💾 [AUTH] Token stocké avec succès');
      }

      return response.data;
    } catch (error: any) {
      console.error('❌ [AUTH] Erreur détaillée:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        requestData: error.config?.data,
        url: error.config?.url
      });
      
      const errorDetail = error.response?.data?.detail || 
                         error.response?.data?.message || 
                         'Erreur de connexion';
      console.log('🚨 [AUTH] Message erreur:', errorDetail);
      throw new Error(errorDetail);
    }
  }

  async register(userData: {
    phone: string;
    password: string;
    email: string;
    full_name: string;
  }): Promise<any> {
    try {
      console.log('📝 [AUTH] Tentative d\'inscription...', { 
        phone: userData.phone,
        email: userData.email,
        full_name: userData.full_name,
        passwordLength: userData.password.length 
      });
      
      console.log('📤 [AUTH] Données inscription:', JSON.stringify(userData, null, 2));
      
      const response = await api.post('/auth/register', userData, {
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      console.log('✅ [AUTH] Inscription réussie:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ [AUTH] Erreur inscription:', {
        status: error.response?.status,
        data: error.response?.data,
        requestData: error.config?.data
      });
      
      const errorDetail = error.response?.data?.detail || "Erreur d'inscription";
      throw new Error(errorDetail);
    }
  }

  async logout(): Promise<void> {
    try {
      console.log('🔐 [AUTH] Déconnexion complète en cours...');
      
      boomsWebSocket.disconnect();
      
      await AsyncStorage.multiRemove([this.TOKEN_KEY, this.USER_KEY]);
      
      console.log('🔐 [AUTH] Déconnexion - données supprimées');
    } catch (error) {
      console.error('❌ [AUTH] Logout error:', error);
    }
  }

  async getToken(): Promise<string | null> {
    try {
      const token = await AsyncStorage.getItem(this.TOKEN_KEY);
      console.log('🔐 [AUTH] Token récupéré:', { 
        exists: !!token, 
        length: token?.length,
        preview: token ? token.substring(0, 20) + '...' : 'NULL' 
      });
      return token;
    } catch (error) {
      console.error('❌ [AUTH] Get token error:', error);
      return null;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    const isAuth = !!token;
    console.log('🔐 [AUTH] Utilisateur authentifié:', isAuth);
    return isAuth;
  }

  private async storeAuthData(authData: AuthResponse): Promise<void> {
    try {
      await AsyncStorage.setItem(this.TOKEN_KEY, authData.access_token);
      
      const userData: User = {
        id: authData.user_id,
        phone: authData.phone,
        full_name: authData.full_name,
        email: '',
        kyc_status: 'pending'
      };
      
      await AsyncStorage.setItem(this.USER_KEY, JSON.stringify(userData));
      console.log('💾 [AUTH] User data sauvegardé:', userData);
    } catch (error) {
      console.error('❌ [AUTH] Store auth data error:', error);
    }
  }

  async getCurrentUser(): Promise<User | null> {
    try {
      const userData = await AsyncStorage.getItem(this.USER_KEY);
      if (userData) {
        const user = JSON.parse(userData);
        console.log('👤 [AUTH] User récupéré:', user);
        return user;
      }
      console.log('👤 [AUTH] Aucun user trouvé dans le stockage');
      return null;
    } catch (error) {
      console.error('❌ [AUTH] Get current user error:', error);
      return null;
    }
  }
}

export default new AuthService();

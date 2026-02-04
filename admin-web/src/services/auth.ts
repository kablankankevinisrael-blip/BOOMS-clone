// services/auth.ts
import { api } from './api';

export interface AdminUser {
  id: number;
  phone: string;
  full_name: string;
  email: string | null;
  is_admin: boolean;
  is_active?: boolean;
  kyc_status?: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user_id: number;
  phone: string;
  full_name: string;
  is_admin?: boolean;
}

class AuthService {
  async login(phone: string, password: string): Promise<LoginResponse> {
    console.log('🔐 [AUTH] Login avec api:', phone);
    
    try {
      // UTILISER API AU LIEU DE FETCH
      const response = await api.post('/auth/login', { phone, password });
      const data = response.data;
      console.log('✅ Login réussi via api:', data);
      
      if (data.access_token) {
        localStorage.setItem('admin_token', data.access_token);
        console.log('✅ Token stocké');
        
        // Stocker les infos utilisateur
        if (data.user_id) {
          const userInfo = {
            id: data.user_id,
            phone: data.phone,
            full_name: data.full_name,
            email: null,
            is_admin: data.is_admin || false
          };
          localStorage.setItem('admin_user', JSON.stringify(userInfo));
        }
        
        return data;
      }
      
      throw new Error('Token non présent');
    } catch (error: any) {
      console.error('❌ Erreur login:', error.response?.data || error.message);
      throw error;
    }
  }
  
  async loginWithFetch(phone: string, password: string): Promise<LoginResponse> {
    return this.login(phone, password); // Même méthode
  }

  logout(): void {
    console.log('🚪 [AUTH] Déconnexion');
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
  }

  getToken(): string | null {
    return localStorage.getItem('admin_token');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  async getCurrentUser(): Promise<AdminUser> {
    console.log('👤 [AUTH] Récupération utilisateur via api');
    
    try {
      // UTILISER API AU LIEU DE FETCH
      const response = await api.get('/auth/me');
      const userData = response.data;
      console.log('✅ Utilisateur récupéré via api:', userData);
      
      const user: AdminUser = {
        id: userData.id,
        phone: userData.phone,
        full_name: userData.full_name || '',
        email: userData.email || null,
        is_admin: userData.is_admin || false,
        is_active: userData.is_active,
        kyc_status: userData.kyc_status
      };
      
      // Mettre à jour localStorage
      localStorage.setItem('admin_user', JSON.stringify(user));
      
      return user;
    } catch (error: any) {
      console.error('❌ Erreur récupération utilisateur:', error.response?.data || error.message);
      throw error;
    }
  }

  async verifyAdmin(): Promise<boolean> {
    console.log('👑 [AUTH] Vérification admin via api');
    
    try {
      const user = await this.getCurrentUser();
      console.log('👑 Résultat vérification:', user.is_admin);
      return user.is_admin === true;
    } catch (error) {
      console.error('❌ Erreur vérification admin:', error);
      return false;
    }
  }
  
  // Nouvelle méthode pour vérifier rapidement
  async quickVerify(): Promise<{authenticated: boolean, isAdmin: boolean}> {
    if (!this.isAuthenticated()) {
      return { authenticated: false, isAdmin: false };
    }
    
    try {
      const isAdmin = await this.verifyAdmin();
      return { authenticated: true, isAdmin };
    } catch {
      return { authenticated: false, isAdmin: false };
    }
  }
}

const authService = new AuthService();
export default authService;
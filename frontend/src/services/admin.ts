import api from './api';

export interface AdminStats {
  total_users: number;
  total_boms: number;
  active_boms: number;
  total_platform_value: number;
}

export interface UserAdmin {
  id: number;
  full_name: string | null;
  phone: string;
  email: string | null;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

export interface BomCreateData {
  title: string;
  description?: string;
  artist: string;
  category: string;
  value: number;
  cost: number;
  stock?: number;
  media_url: string;
  audio_url?: string;
  thumbnail_url?: string;
  duration?: number;
  edition_type: string;
  total_editions?: number;
  tags: string[];
}

export interface RedistributeFundsData {
  from_user_id?: number | null;
  to_user_id: number;
  amount: number;
  reason?: string;
  description?: string;
}

export const adminService = {
  // ✅ STATISTIQUES PLATEFORME
  async getStats(): Promise<AdminStats> {
    const response = await api.get('/admin/stats');
    return response.data;
  },

  // ✅ LISTER TOUS LES UTILISATEURS
  async getUsers(): Promise<UserAdmin[]> {
    const response = await api.get('/admin/users');
    return response.data;
  },

  // ✅ CRÉER UN NOUVEAU BOM
  async createBom(bomData: BomCreateData): Promise<any> {
    const formData = new FormData();
    
    // Ajouter tous les champs au FormData
    Object.entries(bomData).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (key === 'tags' && Array.isArray(value)) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value.toString());
        }
      }
    });

    const response = await api.post('/admin/boms', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // ✅ METTRE À JOUR UN BOM
  async updateBom(bomId: number, bomData: Partial<BomCreateData>): Promise<any> {
    const response = await api.put(`/admin/boms/${bomId}`, bomData);
    return response.data;
  },

  // ✅ SUPPRIMER/DÉSACTIVER UN BOM
  async deleteBom(bomId: number): Promise<{ message: string }> {
    const response = await api.delete(`/admin/boms/${bomId}`);
    return response.data;
  },

  // ✅ ACTIVER/DÉSACTIVER UN UTILISATEUR
  async toggleUserStatus(userId: number, isActive: boolean): Promise<UserAdmin> {
    const response = await api.patch(`/admin/users/${userId}`, { is_active: isActive });
    return response.data;
  },

  // ✅ PROMOUVOIR/RÉTROGRADER ADMIN
  async toggleUserAdmin(userId: number, isAdmin: boolean): Promise<UserAdmin> {
    const response = await api.patch(`/admin/users/${userId}/admin`, { is_admin: isAdmin });
    return response.data;
  },
  
  // ✅ REDISTRIBUTION DE FONDS (ADMIN)
  async redistributeFunds(data: RedistributeFundsData): Promise<any> {
    const response = await api.post('/admin/redistribute', data);
    return response.data;
  },
};
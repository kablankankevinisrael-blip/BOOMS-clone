import { api } from './api';
import {
  SupportThreadDetail,
  SupportThreadListItem,
  SupportThreadStatus,
  SupportPriority,
  SupportMessage,
  SupportMessagePayload,
  SupportStatusUpdatePayload,
  SuggestedMessage,
  BannedMessage,
  AccountStatus,
} from '../types';

interface ThreadFilters {
  scope?: 'mine' | 'assigned' | 'all';
  status?: SupportThreadStatus;
  priority?: SupportPriority;
}

export const supportService = {
  async getThreads(filters: ThreadFilters = {}): Promise<SupportThreadListItem[]> {
    try {
      const response = await api.get('/support/threads', {
        params: {
          scope: filters.scope || 'all',
          status: filters.status,
          priority: filters.priority,
        },
      });
      return response.data;
    } catch (error) {
      console.error('❌ [supportService] Impossible de charger les tickets', error);
      throw error;
    }
  },

  async getThreadById(threadId: number): Promise<SupportThreadDetail> {
    try {
      const response = await api.get(`/support/threads/${threadId}`);
      return response.data;
    } catch (error) {
      console.error('❌ [supportService] Ticket introuvable', error);
      throw error;
    }
  },

  async sendMessage(threadId: number, payload: SupportMessagePayload): Promise<SupportMessage> {
    try {
      const response = await api.post(`/support/threads/${threadId}/messages`, {
        message: payload.message,
        attachments: payload.attachments || [],
        is_internal: payload.is_internal ?? false,
      });
      return response.data;
    } catch (error) {
      console.error('❌ [supportService] Envoi message échoué', error);
      throw error;
    }
  },

  async updateThreadStatus(
    threadId: number,
    payload: SupportStatusUpdatePayload,
  ): Promise<SupportThreadDetail> {
    try {
      const response = await api.patch(`/support/threads/${threadId}/status`, payload);
      return response.data;
    } catch (error) {
      console.error('❌ [supportService] Mise à jour statut échouée', error);
      throw error;
    }
  },

  async getTemplates(): Promise<SuggestedMessage[]> {
    try {
      const response = await api.get('/support/templates');
      return response.data;
    } catch (error) {
      console.warn('⚠️ [supportService] Impossible de charger les modèles', error);
      return [];
    }
  },

  async getBannedMessages(status?: string): Promise<BannedMessage[]> {
    try {
      const response = await api.get('/support/banned-messages', {
        params: status && status !== 'all' ? { status } : undefined,
      });
      return response.data;
    } catch (error) {
      console.error('❌ [supportService] Chargement messages bannis échoué', error);
      throw error;
    }
  },

  async respondToBannedMessage(messageId: number, responseText: string): Promise<BannedMessage> {
    try {
      const response = await api.post(`/support/banned-messages/${messageId}/response`, {
        response: responseText,
      });
      return response.data;
    } catch (error) {
      console.error('❌ [supportService] Réponse bannie échouée', error);
      throw error;
    }
  },

  // ========== MODERATION ACTIONS ==========
  async deactivateUserFromSupport(
    userId: number,
    reason: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      console.log('⏸️  [SUPPORT-SERVICE] ▶️ Désactivation utilisateur...', { userId, reason });
      const startTime = performance.now();
      const response = await api.patch(`/support/users/${userId}/deactivate`, { reason });
      console.log(
        `⏸️  [SUPPORT-SERVICE] ✅ Utilisateur désactivé (${(performance.now() - startTime).toFixed(2)}ms)`,
      );
      return response.data;
    } catch (error) {
      console.error('❌ [SUPPORT-SERVICE] Désactivation échouée', error);
      throw error;
    }
  },

  async banUserFromSupport(
    userId: number,
    reason: string,
    duration_hours?: number,
  ): Promise<{ success: boolean; message: string; ban_until?: string }> {
    try {
      console.log('🚫 [SUPPORT-SERVICE] ▶️ Bannissement utilisateur...', {
        userId,
        reason,
        duration_hours: duration_hours || 72,
      });
      const startTime = performance.now();
      const response = await api.patch(`/support/users/${userId}/ban`, {
        reason,
        duration_hours: duration_hours || 72,  // 72h par défaut avant auto-suppression
      });
      console.log(
        `🚫 [SUPPORT-SERVICE] ✅ Utilisateur banni (${(performance.now() - startTime).toFixed(2)}ms)`,
      );
      return response.data;
    } catch (error) {
      console.error('❌ [SUPPORT-SERVICE] Bannissement échoué', error);
      throw error;
    }
  },

  async deleteUserFromSupport(userId: number, reason: string): Promise<{ success: boolean; message: string }> {
    try {
      console.log('💀 [SUPPORT-SERVICE] ▶️ Suppression complète utilisateur...', { userId, reason });
      const startTime = performance.now();
      const response = await api.delete(`/support/users/${userId}`, {
        data: { reason },
      });
      console.log(
        `💀 [SUPPORT-SERVICE] ✅ Utilisateur supprimé (${(performance.now() - startTime).toFixed(2)}ms)`,
      );
      return response.data;
    } catch (error) {
      console.error('❌ [SUPPORT-SERVICE] Suppression échouée', error);
      throw error;
    }
  },

  async getAccountStatus(userId: number): Promise<{
    status: AccountStatus;
    is_active: boolean;
    banned_at?: string | null;
    banned_reason?: string | null;
    ban_until?: string | null;
    deactivated_at?: string | null;
    deactivated_reason?: string | null;
  }> {
    try {
      const response = await api.get(`/support/users/${userId}/status`);
      return response.data;
    } catch (error) {
      console.error('❌ [SUPPORT-SERVICE] Impossible de récupérer le statut du compte', error);
      throw error;
    }
  },

  async reactivateUserFromBan(userId: number): Promise<{ success: boolean; message: string }> {
    try {
      console.log('▶️  [SUPPORT-SERVICE] ▶️ Réactivation après bannissement...', { userId });
      const startTime = performance.now();
      const response = await api.patch(`/support/users/${userId}/reactivate`);
      console.log(
        `▶️  [SUPPORT-SERVICE] ✅ Utilisateur réactivé (${(performance.now() - startTime).toFixed(2)}ms)`,
      );
      return response.data;
    } catch (error) {
      console.error('❌ [SUPPORT-SERVICE] Réactivation échouée', error);
      throw error;
    }
  },
};

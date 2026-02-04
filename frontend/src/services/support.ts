import api from './api';

export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SupportStatus = 'open' | 'pending' | 'waiting_user' | 'resolved' | 'closed' | 'escalated';
export type SupportSender = 'user' | 'admin' | 'system';

export interface SupportThread {
  id: number;
  reference: string;
  subject: string;
  category: string;
  priority: SupportPriority;
  status: SupportStatus;
  last_message_preview?: string;
  last_message_at?: string;
  created_at: string;
  unread_admin_count?: number;
  unread_user_count?: number;
  messages?: SupportMessage[];
}

export interface SupportMessage {
  id: number;
  thread_id: number;
  sender_id?: number;
  sender_type: SupportSender;
  body: string;
  is_internal?: boolean;
  attachments?: Array<Record<string, unknown>>;
  created_at: string;
}

export interface CreateThreadPayload {
  subject: string;
  category: string;
  priority?: SupportPriority;
  message: string;
  context_payload?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
}

export interface CreateMessagePayload {
  message: string;
  attachments?: Array<Record<string, unknown>>;
  is_internal?: boolean;
}

export interface AccountStatusSnapshot {
  status: string;
  status_label: string;
  is_blocking?: boolean;
  status_reason?: string;
  status_message?: string;
  suspended_until?: string | null;
  banned_at?: string | null;
  last_status_changed_at?: string | null;
  status_metadata?: Record<string, unknown>;
}

export interface SuggestedTemplate {
  category: string;
  title: string;
  template: string;
}

const FALLBACK_TEMPLATES: SuggestedTemplate[] = [
  {
    category: 'account_suspended',
    title: 'Demande de réactivation',
    template: "Bonjour, mon compte est suspendu depuis [DATE]. Pourriez-vous préciser la raison et les étapes pour le réactiver ? Merci."
  },
  {
    category: 'account_banned',
    title: 'Contestation de bannissement',
    template: "Bonjour, mon compte a été banni. Je souhaiterais comprendre la décision et fournir les informations nécessaires pour réexaminer mon dossier."
  },
  {
    category: 'payment_issue',
    title: 'Problème de paiement',
    template: "Bonjour, un problème est survenu lors d'un paiement (référence [REF]). Merci de m'aider à le résoudre."
  },
  {
    category: 'technical_issue',
    title: 'Incident technique',
    template: "Bonjour, je rencontre le bug suivant sur l'application: [DÉTAILS]. Pouvez-vous m'assister ?"
  },
];

export const supportService = {
  async listThreads(scope: 'mine' | 'assigned' | 'all' = 'mine'): Promise<SupportThread[]> {
    const { data } = await api.get('/support/threads', { params: { scope } });
    return data;
  },

  async getThread(threadId: number): Promise<SupportThread> {
    const { data } = await api.get(`/support/threads/${threadId}`);
    return data;
  },

  async createThread(payload: CreateThreadPayload): Promise<SupportThread> {
    const { data } = await api.post('/support/threads', payload);
    return data;
  },

  async postMessage(threadId: number, payload: CreateMessagePayload): Promise<SupportMessage> {
    const { data } = await api.post(`/support/threads/${threadId}/messages`, payload);
    return data;
  },

  async updateThreadStatus(threadId: number, status: SupportStatus): Promise<SupportThread> {
    const { data } = await api.patch(`/support/threads/${threadId}/status`, { status, notify_user: true });
    return data;
  },

  async getAccountStatus(): Promise<AccountStatusSnapshot> {
    const { data } = await api.get('/users/me/status');
    return data;
  },

  async getSuggestedMessages(): Promise<SuggestedTemplate[]> {
    try {
      const { data } = await api.get('/support/templates');
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch (error) {
      // Silencieux: fallback local
    }
    return FALLBACK_TEMPLATES;
  },

  async submitBannedAppeal(payload: { message: string; channel?: string; user_phone?: string; user_email?: string }) {
    try {
      const { data } = await api.post('/support/banned-messages', payload);
      return data;
    } catch (error) {
      throw error;
    }
  },
};

export default supportService;

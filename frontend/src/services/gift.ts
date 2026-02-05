import api from './api';

export interface GiftRequest {
  receiver_phone: string;
  bom_id: number;
  quantity: number;
  message?: string;
}

export interface GiftResponse {
  id: number;
  sender_id: number;
  receiver_id: number;
  is_new_flow: boolean;
  user_bom_id: number;
  message?: string;
  status: 'sent' | 'accepted' | 'declined' | 'expired';
  sent_at: string;
  accepted_at?: string;
  expires_at?: string;
  sender_name: string;
  receiver_name: string;
  bom_title: string;
  bom_image_url?: string;
}

export interface GiftDetailsResponse {
  id: number;
  sender_id: number;
  sender_name?: string;
  receiver_id: number;
  receiver_name?: string;
  user_bom_id: number;
  boom_title?: string;
  boom_image_url?: string | null;
  message?: string | null;
  fees?: number | null;
  status: string;
  is_new_flow: boolean;
  sent_at?: string | null;
  accepted_at?: string | null;
  expires_at?: string | null;
  paid_at?: string | null;
  delivered_at?: string | null;
  failed_at?: string | null;
  transaction_reference?: string | null;
  financial_details?: GiftFinancialBlock;
  social_metrics?: GiftSocialBlock;
}

export interface GiftActionRequest {
  gift_id: number;
  action: 'accepted' | 'declined';
}

export interface GiftActionResponse {
  message: string;
  gift_id: number;
}

export interface GiftTimeline {
  sent_at?: string | null;
  paid_at?: string | null;
  delivered_at?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  expires_at?: string | null;
}

export interface GiftPeopleBlock {
  sender: { id: number; name: string };
  receiver: { id: number; name: string };
}

export interface GiftFinancialBlock {
  gross_amount?: number | null;
  fee_amount?: number | null;
  net_amount?: number | null;
  estimated_value?: number | null;
  currency: string;
  transaction_reference?: string | null;
  wallet_transaction_ids?: number[];
}

export interface GiftSocialBlock {
  social_value?: number | null;
  current_market_value?: number | null;
  share_count: number;
  interaction_count: number;
  market_capitalization?: number | null;
  effective_capitalization?: number | null;
  capitalization_units?: number | null;
  redistribution_pool?: number | null;
}

export interface GiftInboxEntry {
  id: number;
  status: string;
  status_label: string;
  status_tone: 'info' | 'success' | 'danger' | 'muted';
  is_new_flow: boolean;
  message?: string | null;
  direction: 'incoming' | 'outgoing';
  highlight_pending: boolean;
  quantity: number;
  people: GiftPeopleBlock;
  financial: GiftFinancialBlock;
  social?: GiftSocialBlock | null;
  boom?: {
    id: number;
    title: string;
    preview_image?: string | null;
    collection?: string;
    category?: string;
    animation_url?: string | null;
    rarity?: string | null;
  } | null;
  timeline: GiftTimeline;
  actions: {
    can_accept: boolean;
    can_decline: boolean;
    can_view_details: boolean;
  };
}

export interface GiftInboxSummary {
  pending_count: number;
  received_today: number;
  sent_today: number;
  delivered_count: number;
  new_flow_received: number;
  total_value_received?: number | null;
  total_fees_paid?: number | null;
  last_received_at?: string | null;
  needs_attention: boolean;
}

export interface GiftInboxResponse {
  summary: GiftInboxSummary;
  lists: {
    received: GiftInboxEntry[];
    sent: GiftInboxEntry[];
    pending: GiftInboxEntry[];
  };
}

/**
 * Service de gestion des cadeaux Booms - VERSION RÉELLE
 */
export const giftService = {
  /**
   * Envoyer un Bom comme cadeau à un autre utilisateur
   */
  async sendGift(giftData: GiftRequest): Promise<GiftResponse> {
    try {
      console.log('🎁 [SEND_GIFT] Début - Données:', giftData);
      
      const response = await api.post('/gift/send', giftData);
      
      console.log('✅ [SEND_GIFT] Succès - Réponse:', response.data);
      return response.data;
      
    } catch (error: any) {
      const rawMessage = error.response?.data?.detail || 'Erreur lors de l\'envoi du cadeau';
      let errorMessage = rawMessage;
      if (typeof rawMessage === 'string') {
        const normalized = rawMessage.toLowerCase();
        if (normalized.includes('destinataire') && normalized.includes('actif')) {
          errorMessage =
            'Le destinataire est inactif ou supprimé et ne peut pas recevoir de cadeau pour le moment.\n\n' +
            'Vérifiez que :\n' +
            '• le numéro est correct,\n' +
            '• le compte est bien actif,\n' +
            '• le destinataire n’a pas été supprimé.\n\n' +
            'Si besoin, demandez au destinataire de se reconnecter ou contactez le support.';
        }
      }
      if (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('destinataire')) {
        console.warn('⚠️ [SEND_GIFT] Envoi refusé:', errorMessage);
      } else {
        console.error('❌ [SEND_GIFT] ERREUR:', error);
        console.error('❌ [SEND_GIFT] Message erreur:', errorMessage);
      }
      throw new Error(errorMessage);
    }
  },

  /**
   * Accepter un cadeau reçu
   */
  async acceptGift(giftId: number): Promise<GiftActionResponse> {
    try {
      console.log(`✅ [ACCEPT_GIFT] Début - Gift ID: ${giftId}`);
      
      const requestData = { 
        gift_id: giftId, 
        action: 'accepted' as const
      };
      console.log('✅ [ACCEPT_GIFT] Données envoyées:', requestData);
      
      const response = await api.post('/gift/accept', requestData);
      
      console.log('✅ [ACCEPT_GIFT] Succès - Réponse:', response.data);
      return response.data;
      
    } catch (error: any) {
      console.error('❌ [ACCEPT_GIFT] ERREUR:', error);
      const errorMessage = error.response?.data?.detail || 'Erreur lors de l\'acceptation du cadeau';
      console.error('❌ [ACCEPT_GIFT] Message erreur:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  /**
   * Refuser un cadeau reçu
   */
  async declineGift(giftId: number): Promise<GiftActionResponse> {
    try {
      console.log(`❌ [DECLINE_GIFT] Début - Gift ID: ${giftId}`);
      
      const requestData = { 
        gift_id: giftId, 
        action: 'declined' as const
      };
      console.log('❌ [DECLINE_GIFT] Données envoyées:', requestData);
      
      const response = await api.post('/gift/decline', requestData);
      
      console.log('✅ [DECLINE_GIFT] Succès - Réponse:', response.data);
      return response.data;
      
    } catch (error: any) {
      console.error('❌ [DECLINE_GIFT] ERREUR:', error);
      const errorMessage = error.response?.data?.detail || 'Erreur lors du refus du cadeau';
      console.error('❌ [DECLINE_GIFT] Message erreur:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  /**
   * Vue consolidée "boîte aux cadeaux"
   */
  async getGiftInbox(): Promise<GiftInboxResponse> {
    try {
      console.log('📥 [GIFT_INBOX] Récupération boîte aux cadeaux...');
      const response = await api.get('/gift/inbox');
      console.log('✅ [GIFT_INBOX] Données reçues:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ [GIFT_INBOX] ERREUR:', error);
      const errorMessage = error.response?.data?.detail || 'Erreur lors du chargement des cadeaux';
      throw new Error(errorMessage);
    }
  },

  /**
   * Récupérer l'historique des cadeaux
   */
  async getGiftHistory(giftType: 'sent' | 'received' | 'all' = 'all'): Promise<GiftResponse[]> {
    try {
      console.log(`📨 [GIFT_HISTORY] Début - Type: ${giftType}`);
      
      const response = await api.get(`/gift/history?gift_type=${giftType}`);
      
      console.log(`✅ [GIFT_HISTORY] Succès - ${response.data.length} cadeaux récupérés`);
      console.log('📨 [GIFT_HISTORY] Données:', response.data);
      return response.data;
      
    } catch (error: any) {
      console.error('❌ [GIFT_HISTORY] ERREUR:', error);
      const errorMessage = error.response?.data?.detail || 'Erreur lors de la récupération de l\'historique';
      console.error('❌ [GIFT_HISTORY] Message erreur:', errorMessage);
      
      throw new Error(errorMessage);
    }
  },

  /**
   * Récupérer les cadeaux en attente (reçus non traités)
   */
  async getPendingGifts(): Promise<GiftResponse[]> {
    try {
      console.log('⏳ [PENDING_GIFTS] Début - Récupération cadeaux en attente...');
      
      const gifts = await this.getGiftHistory('received');
      const pendingGifts = gifts.filter(gift => gift.status === 'sent');
      
      console.log(`✅ [PENDING_GIFTS] Succès - ${pendingGifts.length} cadeaux en attente trouvés`);
      return pendingGifts;
      
    } catch (error) {
      console.error('❌ [PENDING_GIFTS] ERREUR:', error);
      return [];
    }
  },

  /**
   * Vérifier si un utilisateur a des cadeaux en attente
   */
  async hasPendingGifts(): Promise<boolean> {
    try {
      console.log('🔍 [HAS_PENDING_GIFTS] Début - Vérification cadeaux en attente...');
      
      const pendingGifts = await this.getPendingGifts();
      const hasPending = pendingGifts.length > 0;
      
      console.log(`✅ [HAS_PENDING_GIFTS] Résultat: ${hasPending}`);
      return hasPending;
      
    } catch (error) {
      console.error('❌ [HAS_PENDING_GIFTS] ERREUR:', error);
      return false;
    }
  },

  async getGiftDetails(giftId: number): Promise<GiftDetailsResponse> {
    const response = await api.get(`/gift/${giftId}/details`);
    return response.data;
  }
};

export default giftService;
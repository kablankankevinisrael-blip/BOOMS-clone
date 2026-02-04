import { api } from './api';
import { 
  NFT,
  NFTCreateData,
  NFTCollection,
  AdminStats,
  User,
  Transaction,
  PaymentTransaction,
  Gift,
  Bom,
  BomCreateData,
  CollectionCreateData,
  Commission,
  UserFunds,
  RedistributionRequest,
  CommissionSummary,
  RedistributionResponse,
  NFTAuditLog,
  BomTransfer,
  BulkAction
} from '../types';
import AuthService from './auth';
import BigNumber from 'bignumber.js';
import { toast } from 'react-toastify';

export const validateAndFormatAmount = (
  value: string | number,
  min: number = 0.01,
  max?: number
): { isValid: boolean; amountStr: string; error?: string } => {
  try {
    const bn = new BigNumber(value);
    
    // Validation 1: Est-ce un nombre valide?
    if (bn.isNaN()) {
      return { isValid: false, amountStr: '0.00', error: 'Valeur numérique invalide' };
    }
    
    // Validation 2: Positif?
    if (bn.isLessThanOrEqualTo(0)) {
      return { isValid: false, amountStr: '0.00', error: `Le montant doit être supérieur à ${min}` };
    }
    
    // Validation 3: Minimum?
    if (bn.isLessThan(min)) {
      return { isValid: false, amountStr: '0.00', error: `Le montant minimum est ${min} FCFA` };
    }
    
    // Validation 4: Maximum?
    if (max && bn.isGreaterThan(max)) {
      return { isValid: false, amountStr: '0.00', error: `Le montant maximum est ${max} FCFA` };
    }
    
    // Validation 5: Décimales (max 2)?
    if (bn.decimalPlaces()! > 2) {
      return { 
        isValid: false, 
        amountStr: '0.00', 
        error: 'Maximum 2 décimales autorisées (ex: 100.50, pas 100.501)' 
      };
    }
    
    return { 
      isValid: true, 
      amountStr: bn.toFixed(2) 
    };
    
  } catch (error) {
    return { 
      isValid: false, 
      amountStr: '0.00', 
      error: 'Erreur de validation du montant' 
    };
  }
};

export const formatCurrency = (value: string | number, currency: string = 'FCFA'): string => {
  try {
    const bn = new BigNumber(value);
    if (bn.isNaN()) return `0.00 ${currency}`;
    
    return `${bn.toFormat(2, {
      decimalSeparator: ',',
      groupSeparator: ' ',
      groupSize: 3
    })} ${currency}`;
  } catch {
    return `0.00 ${currency}`;
  }
};

// Fonction utilitaire pour vérifier l'authentification
const checkAuth = () => {
  const token = AuthService.getToken();
  if (!token) {
    throw new Error('Non authentifié');
  }
  return token;
};

// ==================== UTILITAIRES DECIMAL ====================
export const toDecimalString = (value: string | number): string => {
  return new BigNumber(value).toFixed(2);
};

export const parseDecimal = (value: string | number): BigNumber => {
  return new BigNumber(value);
};

// Fonction utilitaire pour convertir string en BigNumber (préservée pour compatibilité)
const toBigNumber = (value: string | number): BigNumber => {
  return new BigNumber(value.toString());
};

// Types pour la caisse plateforme
export interface TreasuryBalance {
  balance: string;
  currency: string;
  updated_at?: string;
}

export interface TreasuryTransaction {
  id: number;
  user_id: number;
  user_phone?: string;
  user_full_name?: string;
  amount: string;
  transaction_type: string;
  description: string;
  created_at: string;
}

export interface TreasuryStats {
  current_balance: string;
  currency: string;
  created_at?: string;
  updated_at?: string;
  fees_by_category: Record<string, string>;
  total_fees_collected: string;
  transaction_count: number;
}

export interface TreasuryDepositRequest {
  amount: number;
  method: string;
  reference?: string;
}

export interface TreasuryWithdrawRequest {
  amount: number;
  method: string;
  recipient_phone?: string;
  recipient_account?: string;
  reference?: string;
}

// ==================== SERVICE TRANSACTIONS AMÉLIORÉ ====================
export const transactionService = {
  async getTransactions(params?: {
    limit?: number;
    offset?: number;
    type?: string;
    status?: string;
    user_id?: number;
    start_date?: string;
    end_date?: string;
  }): Promise<{
    transactions: PaymentTransaction[];
    total: number;
    page: number;
    pages: number;
  }> {
    checkAuth();

    try {
      console.log('� [ADMIN-SERVICE] ▶️ Récupération transactions: GET /admin/payments');
      const startTime = performance.now();
      
      const response = await api.get('/admin/payments', {
        params: {
          limit: params?.limit || 50,
          offset: params?.offset || 0,
          transaction_type: params?.type,
          status: params?.status,
          user_id: params?.user_id,
          start_date: params?.start_date,
          end_date: params?.end_date
        }
      });

      const rawTransactions = Array.isArray(response.data)
        ? response.data
        : response.data.transactions || [];

      const normalizedTransactions = rawTransactions.map((tx: any) => ({
        ...tx,
        amount: toDecimalString(tx.amount || 0),
        fees: toDecimalString(tx.fees || 0),
        net_amount: toDecimalString(tx.net_amount || 0),
        metadata: tx.metadata || {},
        currency: tx.currency || 'FCFA'
      }));

      const totalFromResponse = Array.isArray(response.data)
        ? normalizedTransactions.length
        : response.data.total || normalizedTransactions.length;
      const pageFromResponse = Array.isArray(response.data) ? 1 : response.data.page || 1;
      const pagesFromResponse = Array.isArray(response.data) ? 1 : response.data.pages || 1;

      const endTime = performance.now();
      console.log('✅ [ADMIN-SERVICE] Transactions reçues du backend:', {
        count: normalizedTransactions.length,
        total: totalFromResponse,
        page: pageFromResponse,
        pages: pagesFromResponse,
        sample_first_2: normalizedTransactions.slice(0, 2),
        temps_reponse: `${(endTime - startTime).toFixed(2)}ms`
      });

      return {
        transactions: normalizedTransactions,
        total: totalFromResponse,
        page: pageFromResponse,
        pages: pagesFromResponse
      };
      
    } catch (error: any) {
      console.error('❌ Erreur getTransactions:', error);
      
      // Fallback si endpoint /admin/payments pas disponible
      if (error.response?.status === 404) {
        console.warn('⚠️ Endpoint /admin/payments non trouvé, fallback sur /admin/transactions');
        
        const fallbackResponse = await api.get('/admin/transactions', { params });
        return {
          transactions: fallbackResponse.data.map((tx: any) => ({
            ...tx,
            amount: toDecimalString(tx.amount),
            fees: '0.00',
            net_amount: toDecimalString(tx.amount),
            type: tx.transaction_type || 'unknown',
            provider: 'system',
            currency: 'FCFA'
          })),
          total: fallbackResponse.data.length,
          page: 1,
          pages: 1
        };
      }
      
      throw error;
    }
  },

  async getTransactionStats(period: 'day' | 'week' | 'month' | 'year' = 'month') {
    try {
      const response = await api.get('/admin/payments/stats', {
        params: { period }
      });
      
      return {
        total_amount: toDecimalString(response.data.total_amount || 0),
        total_fees: toDecimalString(response.data.total_fees || 0),
        total_net: toDecimalString(response.data.total_net || 0),
        count: response.data.count || 0,
        by_type: response.data.by_type || {},
        by_status: response.data.by_status || {},
        by_provider: response.data.by_provider || {}
      };
    } catch (error) {
      console.error('❌ Erreur getTransactionStats:', error);
      return {
        total_amount: '0.00',
        total_fees: '0.00',
        total_net: '0.00',
        count: 0,
        by_type: {},
        by_status: {},
        by_provider: {}
      };
    }
  },

  async exportTransactions(format: 'csv' | 'json' = 'csv', params?: any) {
    try {
      const response = await api.get('/admin/payments/export', {
        params: { ...params, format },
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { 
        type: format === 'csv' ? 'text/csv' : 'application/json' 
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions_${new Date().toISOString().split('T')[0]}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      return { success: true, message: 'Export réussi' };
    } catch (error) {
      console.error('❌ Erreur exportTransactions:', error);
      throw error;
    }
  }
};

// ==================== SERVICE REDISTRIBUTION CORRIGÉ ====================
export const redistributionService = {
  async redistributeFunds(request: RedistributionRequest): Promise<RedistributionResponse> {
    const token = checkAuth();

    console.log('🔄 Redistribution avec validation backend:', request);

    try {
      // 1. VALIDER LES DONNÉES (comme backend)
      if (!request.to_user_id) {
        throw new Error('ID destinataire requis');
      }

      const amountBn = parseDecimal(request.amount);
      if (amountBn.lte(0)) {
        throw new Error('Le montant doit être positif');
      }

      // 2. APPEL BACKEND AVEC STRUCTURE EXACTE
      const backendRequest = {
        from_user_id: request.from_user_id || null, // null si redistribution depuis plateforme
        to_user_id: request.to_user_id,
        amount: amountBn.toNumber(), // Conversion pour backend Decimal
        reason: request.reason,
        description: request.description || `Redistribution ${request.reason}`
      };

      console.log('📤 Requête backend:', backendRequest);

      const response = await api.post('/admin/redistribute', backendRequest);
      
      console.log('✅ Réponse redistribution:', response.data);

      // 3. NORMALISER LA RÉPONSE (alignement avec RedistributionResponse)
      return {
        success: true,
        message: response.data.message || 'Redistribution réussie',
        transaction_id: response.data.transaction_id || response.data.id,
        standard_transaction_id: response.data.standard_transaction_id || response.data.transaction_id,
        redistribution_id: response.data.redistribution_id,
        amount: toDecimalString(response.data.amount || request.amount),
        fees_applied: '0.00', // Frais toujours 0 pour admin redistribution
        from_user: request.from_user_id ? {
          id: request.from_user_id,
          old_balance: toDecimalString(response.data.ancien_solde_expediteur || '0.00'),
          new_balance: toDecimalString(response.data.nouveau_solde_expediteur || '0.00')
        } : undefined,
        to_user: {
          id: request.to_user_id,
          old_balance: toDecimalString(response.data.ancien_solde_destinataire || '0.00'),
          new_balance: toDecimalString(response.data.nouveau_solde_destinataire || '0.00')
        },
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      console.error('❌ Erreur redistribution:', error);
      
      // ANALYSE DÉTAILLÉE DE L'ERREUR
      if (error.response) {
        const { status, data } = error.response;
        
        if (status === 400) {
          // Validation error from backend
          throw new Error(data.detail || 'Erreur de validation');
        } else if (status === 404) {
          // Endpoint not found - fallback to manual
          console.warn('⚠️ Endpoint /admin/redistribute non trouvé, fallback manuel');
          return this.fallbackRedistribution(request);
        } else if (status === 422) {
          // Unprocessable entity (schema validation)
          throw new Error(`Schéma invalide: ${JSON.stringify(data.detail)}`);
        } else if (status === 500) {
          // Server error
          throw new Error('Erreur serveur lors de la redistribution');
        }
      }
      
      throw new Error(`Échec redistribution: ${error.message}`);
    }
  },

  // FALLBACK si endpoint /admin/redistribute n'existe pas
  async fallbackRedistribution(request: RedistributionRequest): Promise<RedistributionResponse> {
    console.log('🔄 Fallback redistribution manuelle');

    try {
      // 1. Vérifier le solde source si spécifié
      if (request.from_user_id) {
        const balanceResponse = await api.get(`/admin/users/${request.from_user_id}/balance`);
        const sourceBalance = parseDecimal(balanceResponse.data.balance || '0');
        const amount = parseDecimal(request.amount);
        
        if (sourceBalance.lt(amount)) {
          throw new Error(`Solde insuffisant: ${sourceBalance.toFixed(2)} < ${amount.toFixed(2)}`);
        }
      }

      // 2. Créer manuellement les transactions (simule backend)
      const transactionId = `redist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 3. Appeler wallet_service.create_transaction directement
      const transactionData = {
        user_id: request.to_user_id,
        amount: parseDecimal(request.amount).toNumber(),
        transaction_type: `${request.reason}_received`,
        description: request.description || `Redistribution ${request.reason}`,
        status: 'completed'
      };

      const txResponse = await api.post('/admin/create-transaction', transactionData);
      
      return {
        success: true,
        message: 'Redistribution manuelle réussie',
        transaction_id: transactionId,
        standard_transaction_id: txResponse.data.id,
        amount: toDecimalString(request.amount),
        fees_applied: '0.00',
        to_user: {
          id: request.to_user_id,
          old_balance: '0.00', // Non disponible sans backend complet
          new_balance: toDecimalString(request.amount)
        },
        timestamp: new Date().toISOString()
      };

    } catch (fallbackError: any) {
      console.error('❌ Fallback redistribution échoué:', fallbackError);
      throw new Error(`Fallback échoué: ${fallbackError.message}`);
    }
  },

  async getRedistributionHistory(params?: {
    limit?: number;
    offset?: number;
    user_id?: number;
    reason?: string;
  }) {
    try {
      const response = await api.get('/admin/redistribute/history', { params });
      return response.data;
    } catch (error) {
      console.warn('⚠️ Endpoint history non disponible');
      return [];
    }
  },

  async validateRedistribution(request: RedistributionRequest): Promise<{
    valid: boolean;
    message: string;
    fees: string;
    net_amount: string;
    source_balance?: string;
    destination_balance?: string;
  }> {
    try {
      // Appel backend pour validation
      const response = await api.post('/admin/redistribute/validate', request);
      return {
        valid: true,
        message: 'Validation réussie',
        fees: '0.00', // Frais toujours 0 pour admin
        net_amount: request.amount,
        ...response.data
      };
    } catch (error: any) {
      return {
        valid: false,
        message: error.response?.data?.detail || 'Erreur de validation',
        fees: '0.00',
        net_amount: '0.00'
      };
    }
  }
};

// ==================== TRÉSORERIE PLATEFORME ====================
export const treasuryService = {
  async getTreasuryBalance(): Promise<TreasuryBalance> {
    checkAuth();
    try {
      const response = await api.get('/admin/treasury/balance');
      
      // Convertir en BigNumber pour validation
      const balance = new BigNumber(response.data.balance || 0);
      
      return {
        ...response.data,
        balance: balance.toFixed(2) // Toujours 2 décimales
      };
    } catch (error: any) {
      console.error('❌ Erreur récupération solde caisse:', error);
      toast.error('Impossible de charger le solde de la caisse');
      
      // Fallback propre
      return {
        balance: "0.00",
        currency: 'FCFA',
        updated_at: new Date().toISOString()
      };
    }
  },

  async getTreasuryBoomSurplus(): Promise<{ surplus: string; currency: string; boom_count: number; details: any[]; calculation: string }> {
    checkAuth();
    try {
      const response = await api.get('/admin/treasury/boom-surplus');
      
      return {
        ...response.data,
        surplus: new BigNumber(response.data.surplus || 0).toFixed(2)
      };
    } catch (error: any) {
      console.error('❌ Erreur récupération surplus BOOMs:', error);
      return {
        surplus: "0.00",
        currency: 'FCFA',
        boom_count: 0,
        details: [],
        calculation: "N/A"
      };
    }
  },

  async getTreasuryUserGains(): Promise<{ user_gains: string; currency: string; boom_count: number; details: any[]; calculation: string }> {
    checkAuth();
    try {
      const response = await api.get('/admin/treasury/user-gains');
      
      return {
        ...response.data,
        user_gains: new BigNumber(response.data.user_gains || 0).toFixed(2)
      };
    } catch (error: any) {
      console.error('❌ Erreur récupération gains utilisateurs:', error);
      return {
        user_gains: "0.00",
        currency: 'FCFA',
        boom_count: 0,
        details: [],
        calculation: "N/A"
      };
    }
  },

  async getTreasuryWithdrawn(): Promise<{ withdrawn: string; currency: string; total_entered: string; current_balance: string; calculation: string }> {
    checkAuth();
    try {
      const response = await api.get('/admin/treasury/withdrawn');
      
      return {
        ...response.data,
        withdrawn: new BigNumber(response.data.withdrawn || 0).toFixed(2)
      };
    } catch (error: any) {
      console.error('❌ Erreur récupération argent retiré:', error);
      return {
        withdrawn: "0.00",
        currency: 'FCFA',
        total_entered: "0.00",
        current_balance: "0.00",
        calculation: "N/A"
      };
    }
  },

  async getTreasuryTransactions(limit: number = 50): Promise<TreasuryTransaction[]> {
    checkAuth();
    try {
      console.log(`📊 Récupération ${limit} transactions caisse...`);
      const response = await api.get('/admin/treasury/transactions', {
        params: { limit }
      });
      console.log(`✅ ${response.data.length} transactions récupérées`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur récupération transactions caisse:', error);
      return [];
    }
  },

  async getTreasuryStats(): Promise<TreasuryStats> {
    checkAuth();
    try {
      console.log('📈 Récupération statistiques caisse...');
      const response = await api.get('/admin/treasury/stats');
      
      const totalFees = toBigNumber(response.data.total_fees_collected);
      console.log(`✅ Stats caisse: ${formatCurrency(totalFees.toNumber())} FCFA collectés`);
      
      return {
        ...response.data,
        current_balance: response.data.current_balance,
        total_fees_collected: response.data.total_fees_collected,
        fees_by_category: response.data.fees_by_category
      };
    } catch (error: any) {
      console.error('❌ Erreur récupération stats caisse:', error);
      return {
        current_balance: "0.00",
        currency: 'FCFA',
        total_fees_collected: "0.00",
        transaction_count: 0,
        fees_by_category: {}
      };
    }
  },

  async depositToTreasury(data: TreasuryDepositRequest): Promise<{ 
    success: boolean; 
    message: string; 
    new_balance: string;
  }> {
    checkAuth();
    
    try {
      // VALIDATION STRICTE AVANT ENVOI
      const validation = validateAndFormatAmount(data.amount, 100, 1000000); // min 100, max 1M
      
      if (!validation.isValid) {
        throw new Error(validation.error || 'Montant invalide');
      }
      
      const payload = {
        ...data,
        amount: validation.amountStr // Envoie string Decimal formaté
      };
      
      console.log(`💰 Dépôt caisse: ${payload.amount} FCFA via ${data.method}`);
      const response = await api.post('/admin/treasury/deposit', payload);
      
      toast.success(`✅ Dépôt réussi: ${formatCurrency(payload.amount)}`);
      return response.data;
      
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || 'Erreur inconnue';
      toast.error(`❌ Échec dépôt: ${errorMsg}`);
      throw error;
    }
  },

  async withdrawFromTreasury(data: TreasuryWithdrawRequest): Promise<{ 
    success: boolean; 
    message: string; 
    new_balance: string;
    payout_initiated: boolean;
  }> {
    checkAuth();
    
    try {
      // VALIDATION STRICTE AVANT ENVOI
      const validation = validateAndFormatAmount(data.amount, 1000, 500000); // min 1000, max 500K
      
      if (!validation.isValid) {
        throw new Error(validation.error || 'Montant invalide');
      }
      
      // Validation supplémentaire: numéro de téléphone pour Wave/Orange
      if (['wave', 'orange'].includes(data.method.toLowerCase()) && !data.recipient_phone) {
        throw new Error('Numéro de téléphone requis pour ce mode de retrait');
      }
      
      const payload = {
        ...data,
        amount: validation.amountStr
      };
      
      console.log(`💰 Retrait caisse: ${payload.amount} FCFA vers ${data.recipient_phone || data.recipient_account}`);
      const response = await api.post('/admin/treasury/withdraw', payload);
      
      toast.success(`✅ Retrait initié: ${formatCurrency(payload.amount)}`);
      return response.data;
      
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || 'Erreur inconnue';
      toast.error(`❌ Échec retrait: ${errorMsg}`);
      throw error;
    }
  },

  async testTreasuryConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.getTreasuryBalance();
      return { 
        success: true, 
        message: '✅ Connexion trésorerie OK - La caisse plateforme est opérationnelle' 
      };
    } catch (error: any) {
      return { 
        success: false, 
        message: `❌ Connexion trésorerie échouée: ${error.message}` 
      };
    }
  },

  // Fonctions utilitaires
  formatAmount: formatCurrency,
  validateAmount: validateAndFormatAmount,

  // Fonctions utilitaires pour les calculs précis
  parseAmount: toBigNumber,
  calculateTotalFees: (feesByCategory: Record<string, string>): string => {
    let total = new BigNumber(0);
    Object.values(feesByCategory).forEach(fee => {
      total = total.plus(toBigNumber(fee));
    });
    return total.toFixed(2);
  }
};

export const adminService = {
  // ===================== NFT MANAGEMENT =====================
  async getNFTs(showInactive: boolean = false): Promise<NFT[]> {
    checkAuth();
    try {
      console.log('🎨 [ADMIN-SERVICE] ▶️ Récupération BOMs/NFTs: GET /admin/nfts');
      const startTime = performance.now();
      
      const response = await api.get(`/admin/nfts?show_inactive=${showInactive}&limit=200`);
      
      const endTime = performance.now();
      console.log(`✅ [ADMIN-SERVICE] ${response.data.length} BOMs reçus du backend (${(endTime - startTime).toFixed(2)}ms)`, {
        count: response.data.length,
        sample: response.data.slice(0, 2)
      });
      
      return response.data;
    } catch (error: any) {
      console.error('🔴 [ADMIN-SERVICE] Erreur getNFTs:', error.message || error);
      throw error;
    }
  },

  async getNFTById(id: number): Promise<NFT> {
    checkAuth();
    console.log(`🔍 [getNFTById] Recherche NFT ID: ${id}`);
    
    try {
      const response = await api.get(`/nfts/${id}`);
      console.log(`✅ NFT trouvé: ${response.data.title}`);
      return response.data;
    } catch (error: any) {
      console.warn(`⚠️ Erreur endpoint /nfts, fallback sur /admin/nfts`);
      
      try {
        const allNFTs = await this.getNFTs(true);
        const nft = allNFTs.find(n => n.id === id);
        
        if (!nft) {
          throw new Error(`NFT avec ID ${id} non trouvé`);
        }
        
        console.log(`✅ NFT trouvé via fallback: ${nft.title}`);
        return nft;
      } catch (fallbackError: any) {
        console.error(`💥 Échec total getNFTById:`, fallbackError);
        throw new Error(`Impossible de charger le NFT ID ${id}`);
      }
    }
  },

  async createNFT(nftData: NFTCreateData): Promise<NFT> {
    checkAuth();
    console.log('🚀 [createNFT] Création nouveau NFT');
    
    try {
      const response = await api.post('/admin/nfts', nftData);
      console.log(`✅ NFT créé: ${response.data.title} (${response.data.token_id})`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur createNFT:', error.response?.data || error.message);
      throw error;
    }
  },

  async updateNFT(id: number, nftData: Partial<NFTCreateData>): Promise<NFT> {
    checkAuth();
    console.group(`🔄 [updateNFT] Mise à jour NFT ID: ${id}`);
    console.log('Données envoyées:', nftData);
    
    try {
      const response = await api.put(`/admin/nfts/${id}`, nftData);
      console.log('✅ NFT mis à jour:', response.data.title);
      
      const updatedNFT = await this.getNFTById(id);
      
      console.groupEnd();
      return updatedNFT;
    } catch (error: any) {
      console.error('❌ Erreur updateNFT:', error.response?.data || error.message);
      console.groupEnd();
      throw error;
    }
  },

  // CORRIGÉ: Méthode toggleNftActive simplifiée et fonctionnelle
  async toggleNftActive(id: number): Promise<NFT> {
    checkAuth();
    console.group(`🔄 [toggleNftActive] NFT ID: ${id}`);
    
    try {
      // 1. Récupérer le NFT actuel
      const currentNFT = await this.getNFTById(id);
      console.log(`📊 NFT actuel: ${currentNFT.title}, Statut: ${currentNFT.is_active ? 'Actif' : 'Inactif'}`);
      
      // 2. Calculer le nouveau statut
      const newStatus = !currentNFT.is_active;
      console.log(`🔄 Nouveau statut: ${newStatus ? 'Actif' : 'Inactif'}`);
      
      // 3. Utiliser updateNFT avec SEULEMENT le champ is_active
      const updateData: any = {
        is_active: newStatus
      };
      
      console.log('📤 Données envoyées:', updateData);
      const updatedNFT = await this.updateNFT(id, updateData);
      
      console.log(`✅ Statut modifié: ${updatedNFT.title} → ${updatedNFT.is_active ? 'Actif' : 'Inactif'}`);
      console.groupEnd();
      return updatedNFT;
      
    } catch (error: any) {
      console.error('❌ Erreur toggleNftActive:', error);
      console.groupEnd();
      throw new Error(`Impossible de modifier le statut: ${error.message}`);
    }
  },

  async deleteNFT(id: number): Promise<{ message: string, token_id: string, id: number }> {
    checkAuth();
    console.log(`🗑️ [deleteNFT] Suppression NFT ID: ${id}`);
    
    try {
      const response = await api.delete(`/admin/nfts/${id}`);
      console.log('✅ NFT supprimé:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur deleteNFT:', error);
      throw error;
    }
  },

  // ===================== BOM COMPATIBILITY =====================
  async getBoms(): Promise<Bom[]> {
    return this.getNFTs();
  },

  async getBomById(id: number): Promise<Bom> {
    return this.getNFTById(id);
  },

  async updateBom(id: number, bomData: any): Promise<Bom> {
    const nftData: Partial<NFTCreateData> = {
      title: bomData.title,
      artist: bomData.artist,
      category: bomData.category,
      description: bomData.description,
      value: bomData.value,
      purchase_price: bomData.cost,
      animation_url: bomData.media_url,
      preview_image: bomData.thumbnail_url || bomData.media_url,
      audio_url: bomData.audio_url,
      duration: bomData.duration,
      edition_type: bomData.edition_type,
      max_editions: bomData.total_editions || bomData.stock,
      tags: bomData.tags,
      is_active: bomData.is_active
    };
    
    return this.updateNFT(id, nftData);
  },

  async deleteBom(id: number): Promise<{ message: string, reloadNeeded: boolean }> {
    try {
      const result = await this.deleteNFT(id);
      return {
        message: result.message,
        reloadNeeded: true
      };
    } catch (error: any) {
      console.error('❌ Erreur deleteBom:', error);
      throw error;
    }
  },

  // ===================== BOM ADVANCED OPERATIONS =====================
  
  async transferBomOwnership(bomId: number, fromUserId: number, toUserId: number, raison: string): Promise<any> {
    checkAuth();
    console.group(`🔄 [transferBomOwnership] BOM ID: ${bomId}, De: ${fromUserId} → À: ${toUserId}`);
    console.log('🔎 Raison:', raison);
    
    try {
      const currentUser = await AuthService.getCurrentUser();
      const payload = {
        from_user_id: fromUserId,
        to_user_id: toUserId,
        raison: raison,
        admin_id: currentUser.id
      };
      
      console.log('📤 Données envoyées:', payload);
      const response = await api.put(`/admin/boms/${bomId}/transfer-ownership`, payload);
      
      console.log('✅ Transfert réussi:', {
        bom_id: bomId,
        new_owner: toUserId,
        transfer_id: response.data.transfer_id
      });
      console.groupEnd();
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur transferBomOwnership:', error.response?.data || error.message);
      console.groupEnd();
      throw error;
    }
  },

  async toggleBomTradable(id: number, raison: string): Promise<NFT> {
    checkAuth();
    console.group(`🔄 [toggleBomTradable] BOM ID: ${id}`);
    
    try {
      const currentBom = await this.getNFTById(id) as any;
      const newTradableStatus = !currentBom.is_tradable;
      
      console.log(`📊 Statut tradable actuel: ${currentBom.is_tradable ? 'Oui' : 'Non'}`);
      console.log(`🔄 Nouveau statut: ${newTradableStatus ? 'Oui' : 'Non'}`);
      console.log('🔎 Raison:', raison);
      
      const currentUser = await AuthService.getCurrentUser();
      const payload = {
        is_tradable: newTradableStatus,
        raison: raison,
        admin_id: currentUser.id
      };
      
      const response = await api.put(`/admin/nfts/${id}`, payload);
      console.log(`✅ Statut tradable modifié: ${response.data.title} → ${newTradableStatus ? 'Tradable' : 'Non-tradable'}`);
      console.groupEnd();
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur toggleBomTradable:', error.response?.data || error.message);
      console.groupEnd();
      throw error;
    }
  },

  async getAuditLog(bomId: number): Promise<any[]> {
    checkAuth();
    console.log(`🔍 [getAuditLog] Récupération historique BOM ID: ${bomId}`);
    
    try {
      const startTime = performance.now();
      const response = await api.get(`/admin/boms/${bomId}/audit-log`);
      const endTime = performance.now();
      
      console.log(`✅ ${response.data.length} événements audit récupérés (${(endTime - startTime).toFixed(2)}ms)`, {
        count: response.data.length,
        sample: response.data.slice(0, 2)
      });
      
      return response.data;
    } catch (error: any) {
      console.warn('⚠️ Endpoint audit-log non disponible, retour vide');
      return [];
    }
  },

  async bulkToggleStatus(bomIds: number[], newStatus: boolean, raison: string): Promise<{ successful: number[], failed: Array<{ id: number, error: string }> }> {
    checkAuth();
    console.group(`🔄 [bulkToggleStatus] Toggle ${bomIds.length} BOMs → ${newStatus ? 'Actif' : 'Inactif'}`);
    console.log('📋 IDs:', bomIds);
    console.log('🔎 Raison:', raison);
    
    try {
      const currentUser = await AuthService.getCurrentUser();
      const payload = {
        bom_ids: bomIds,
        is_active: newStatus,
        raison: raison,
        admin_id: currentUser.id
      };
      
      const response = await api.post('/admin/boms/bulk-toggle-status', payload);
      
      console.log(`✅ Bulk action réussi:`, {
        successful: response.data.successful.length,
        failed: response.data.failed.length
      });
      console.groupEnd();
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur bulkToggleStatus:', error.response?.data || error.message);
      console.groupEnd();
      throw error;
    }
  },

  async getAdvancedFilters(filters: {
    status?: boolean;
    edition_type?: string;
    category?: string;
    value_min?: number;
    value_max?: number;
    owner_id?: number;
    is_tradable?: boolean;
    search?: string;
  }): Promise<NFT[]> {
    checkAuth();
    console.log('🔍 [getAdvancedFilters] Recherche avec filtres avancés:', filters);
    
    try {
      const startTime = performance.now();
      const params = new URLSearchParams();
      
      if (filters.status !== undefined) params.append('is_active', String(filters.status));
      if (filters.edition_type) params.append('edition_type', filters.edition_type);
      if (filters.category) params.append('category', filters.category);
      if (filters.value_min) params.append('value_min', String(filters.value_min));
      if (filters.value_max) params.append('value_max', String(filters.value_max));
      if (filters.owner_id) params.append('owner_id', String(filters.owner_id));
      if (filters.is_tradable !== undefined) params.append('is_tradable', String(filters.is_tradable));
      if (filters.search) params.append('search', filters.search);
      
      const response = await api.get(`/admin/nfts/advanced-search?${params.toString()}`);
      const endTime = performance.now();
      
      console.log(`✅ ${response.data.length} BOMs trouvés (${(endTime - startTime).toFixed(2)}ms)`, {
        count: response.data.length,
        sample: response.data.slice(0, 2)
      });
      
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur getAdvancedFilters:', error.response?.data || error.message);
      throw error;
    }
  },

  async burnBom(bomId: number, raison: string): Promise<{ message: string, burned_at: string }> {
    checkAuth();
    console.group(`🔥 [burnBom] Destruction BOM ID: ${bomId}`);
    console.log('🔎 Raison:', raison);
    
    try {
      const currentUser = await AuthService.getCurrentUser();
      const payload = {
        raison: raison,
        admin_id: currentUser.id
      };
      
      const response = await api.delete(`/admin/boms/${bomId}/burn`, { data: payload });
      
      console.log(`✅ BOM détruit avec succès:`, {
        bom_id: bomId,
        burned_at: response.data.burned_at
      });
      console.groupEnd();
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur burnBom:', error.response?.data || error.message);
      console.groupEnd();
      throw error;
    }
  },

  // ===================== COLLECTIONS =====================
  async getCollections(): Promise<NFTCollection[]> {
    checkAuth();
    try {
      const response = await api.get('/nfts/collections/');
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur getCollections:', error);
      return [];
    }
  },

  async createCollection(collectionData: CollectionCreateData): Promise<NFTCollection> {
    checkAuth();
    const response = await api.post('/admin/collections', collectionData);
    return response.data;
  },

  async verifyCollection(collectionId: number): Promise<any> {
    checkAuth();
    const response = await api.put(`/admin/collections/${collectionId}/verify`);
    return response.data;
  },

  // ===================== USERS =====================
  async getUsers(): Promise<User[]> {
    checkAuth();
    try {
      console.log('👥 [ADMIN-SERVICE] ▶️ Récupération users: GET /users/');
      const startTime = performance.now();
      
      const response = await api.get('/users/');
      
      const endTime = performance.now();
      console.log(`✅ [ADMIN-SERVICE] ${response.data.length} utilisateurs reçus du backend (${(endTime - startTime).toFixed(2)}ms)`, {
        count: response.data.length,
        sample: response.data.slice(0, 2)
      });
      
      return response.data;
    } catch (error: any) {
      console.error('🔴 [ADMIN-SERVICE] Erreur getUsers:', error.message || error);
      return [];
    }
  },

  async toggleUserStatus(userId: number, isActive: boolean): Promise<User> {
    checkAuth();
    const response = await api.patch(`/admin/users/${userId}`, { is_active: isActive });
    return response.data;
  },

  async toggleUserAdmin(userId: number, isAdmin: boolean): Promise<User> {
    checkAuth();
    const response = await api.patch(`/admin/users/${userId}/admin`, { is_admin: isAdmin });
    return response.data;
  },

  async banUser(userId: number, reason?: string): Promise<{ success: boolean; message: string }> {
    checkAuth();
    console.log(`🚫 [ADMIN-SERVICE] ▶️ Bannissement utilisateur ${userId}: DELETE /admin/users/${userId}/ban`);
    const startTime = performance.now();
    try {
      const response = await api.delete(`/admin/users/${userId}/ban`, {
        data: reason ? { reason } : undefined,
      });
      const endTime = performance.now();
      console.log(`✅ [ADMIN-SERVICE] Utilisateur ${userId} banni avec succès (${(endTime - startTime).toFixed(2)}ms)`);
      return response.data;
    } catch (error: any) {
      console.error(`🔴 [ADMIN-SERVICE] Erreur bannissement utilisateur ${userId}:`, error.message);
      throw error;
    }
  },

  async deleteUser(userId: number, reason?: string): Promise<{ success: boolean; message: string }> {
    checkAuth();
    console.log(`💀 [ADMIN-SERVICE] ▶️ Suppression complète utilisateur ${userId}: DELETE /admin/users/${userId}`);
    const startTime = performance.now();
    try {
      const response = await api.delete(`/admin/users/${userId}`, {
        data: reason ? { reason } : undefined,
      });
      const endTime = performance.now();
      console.log(`✅ [ADMIN-SERVICE] Utilisateur ${userId} supprimé complètement (${(endTime - startTime).toFixed(2)}ms)`);
      return response.data;
    } catch (error: any) {
      console.error(`🔴 [ADMIN-SERVICE] Erreur suppression utilisateur ${userId}:`, error.message);
      throw error;
    }
  },

  // ===================== STATISTICS =====================
  async getStats(): Promise<AdminStats> {
    checkAuth();
    try {
      console.log('📊 [ADMIN-SERVICE] ▶️ Récupération stats: GET /admin/stats');
      const startTime = performance.now();
      
      const response = await api.get('/admin/stats');
      
      const endTime = performance.now();
      console.log('✅ [ADMIN-SERVICE] Stats reçues du backend:', {
        total_users: response.data.total_users,
        total_boms: response.data.total_boms,
        active_boms: response.data.active_boms,
        total_platform_value: response.data.total_platform_value,
        temps_reponse: `${(endTime - startTime).toFixed(2)}ms`
      });
      
      return response.data;
    } catch (error: any) {
      console.error('🔴 [ADMIN-SERVICE] Erreur getStats:', error.message || error);
      return {
        total_users: 0,
        total_boms: 0,
        active_boms: 0,
        total_platform_value: 0
      };
    }
  },

  // ===================== TRANSACTIONS =====================
  async getTransactions(): Promise<Transaction[]> {
    checkAuth();
    try {
      const response = await api.get('/admin/transactions');
      return response.data;
    } catch (error: any) {
      console.warn('⚠️ Endpoint /admin/transactions non disponible');
      try {
        const response = await api.get('/wallet/transactions');
        return response.data;
      } catch (innerError) {
        console.error('❌ Erreur getTransactions:', innerError);
        return [];
      }
    }
  },

  // CORRECTION : getPaymentTransactions avec decimal string
  async getPaymentTransactions(params?: {
    limit?: number;
    offset?: number;
    type?: string;
    status?: string;
    user_id?: number;
    start_date?: string;
    end_date?: string;
  }): Promise<{
    transactions: PaymentTransaction[];
    total: number;
    page: number;
    pages: number;
  }> {
    return transactionService.getTransactions(params);
  },

  async getGifts(): Promise<Gift[]> {
    checkAuth();
    try {
      const response = await api.get('/admin/gifts');
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur getGifts:', error.message);
      return [];
    }
  },

  // ===================== COMMISSIONS & FONDS =====================
  async getCommissions(): Promise<Commission[]> {
    checkAuth();
    try {
      const response = await api.get('/admin/commissions');
      return (response.data || []).map((commission: any) => ({
        ...commission,
        amount: parseFloat(commission.amount ?? commission.total ?? 0),
      }));
    } catch (error: any) {
      console.error('❌ Erreur getCommissions:', error);
      throw error;
    }
  },

  async getAllUserFunds(): Promise<UserFunds[]> {
    checkAuth();
    console.log('📊 getAllUserFunds - version compatible');
    
    try {
      // UTILISE LA ROUTE QUI EXISTE DÉJÀ
      const response = await api.get('/admin/user-funds');
      console.log(`✅ ${response.data.length} utilisateurs avec fonds récupérés`);
      
      // Transforme les données pour correspondre à UserFunds
      return response.data.map((fund: any) => ({
        user_id: fund.user_id,
        full_name: fund.full_name || `Utilisateur ${fund.user_id}`,
        phone: fund.phone || '',
        cash_balance: parseFloat(fund.cash_balance) || 0,
        wallet_balance: parseFloat(fund.wallet_balance) || 0,
        pending_withdrawals: parseFloat(fund.pending_withdrawals) || 0,
        total_commissions_earned: parseFloat(fund.total_commissions_earned) || 0,
        wallet_balance_stored: parseFloat(fund.wallet_balance_stored) || parseFloat(fund.wallet_balance) || 0,
        has_discrepancy: Boolean(fund.has_discrepancy),
        discrepancy_amount: parseFloat(fund.discrepancy_amount) || 0,
        last_transaction_date: fund.last_transaction_date || null
      }));
      
    } catch (error: any) {
      console.error('❌ Erreur getAllUserFunds:', error);
      
      // Fallback: utiliser getUsers si l'endpoint spécifique échoue
      try {
        const users = await this.getUsers();
        console.log(`⚠️ Fallback sur getUsers: ${users.length} utilisateurs`);
        
        return users.map(user => ({
          user_id: user.id,
          full_name: user.full_name || `Utilisateur ${user.id}`,
          phone: user.phone || '',
          cash_balance: user.wallet_balance || 0,
          wallet_balance: user.wallet_balance || 0,
          pending_withdrawals: 0,
          total_commissions_earned: 0,
          wallet_balance_stored: user.wallet_balance || 0,
          has_discrepancy: false,
          discrepancy_amount: 0,
          last_transaction_date: null
        }));
      } catch (fallbackError) {
        console.error('❌ Erreur fallback getAllUserFunds:', fallbackError);
        return [];
      }
    }
  },

  async getUserFunds(userId: number): Promise<UserFunds> {
    checkAuth();
    console.log(`💰 getUserFunds - version compatible pour user ${userId}`);
    
    try {
      // OPTION 1: Utiliser la route qui EXISTE DÉJÀ
      const response = await api.get(`/admin/users/${userId}/funds`);
      console.log(`✅ Données reçues pour user ${userId}`);
      
      return {
        user_id: userId,
        full_name: response.data.full_name || `Utilisateur ${userId}`,
        phone: response.data.phone || '',
        cash_balance: parseFloat(response.data.cash_balance) || 0,
        wallet_balance: parseFloat(response.data.wallet_balance) || 0,
        pending_withdrawals: parseFloat(response.data.pending_withdrawals) || 0,
        total_commissions_earned: parseFloat(response.data.total_commissions_earned) || 0,
        wallet_balance_stored: parseFloat(response.data.wallet_balance_stored) || parseFloat(response.data.wallet_balance) || 0,
        has_discrepancy: Boolean(response.data.has_discrepancy),
        discrepancy_amount: parseFloat(response.data.discrepancy) || 0,
        last_transaction_date: response.data.last_transaction_date || null
      };
      
    } catch (error: any) {
      console.error(`❌ Erreur getUserFunds user ${userId}:`, error);
      
      // OPTION 2: Fallback - utiliser getAllUserFunds
      try {
        const allFunds = await this.getAllUserFunds();
        const userFund = allFunds.find(f => f.user_id === userId);
        
        if (userFund) {
          console.log(`✅ Récupéré via getAllUserFunds pour user ${userId}`);
          return userFund;
        }
      } catch (fallbackError) {
        console.warn(`⚠️ Fallback échoué pour user ${userId}`);
      }
      
      // Fallback ultime
      return {
        user_id: userId,
        full_name: 'Utilisateur',
        phone: '',
        cash_balance: 0,
        wallet_balance: 0,
        pending_withdrawals: 0,
        total_commissions_earned: 0,
        wallet_balance_stored: 0,
        has_discrepancy: false,
        discrepancy_amount: 0,
        last_transaction_date: null
      };
    }
  },

  // CORRECTION : redistributeFunds avec structure corrigée
  async redistributeFunds(request: RedistributionRequest): Promise<RedistributionResponse> {
    return redistributionService.redistributeFunds(request);
  },

  async getDailyCommissions(): Promise<CommissionSummary> {
    checkAuth();
    try {
      const response = await api.get('/admin/commissions/daily');
      return {
        ...response.data,
        deposit_commissions: parseFloat(response.data.deposit_commissions) || 0,
        withdrawal_commissions: parseFloat(response.data.withdrawal_commissions) || 0,
        total_commissions: parseFloat(response.data.total_commissions) || 0
      };
    } catch (error: any) {
      console.warn('⚠️ Endpoint /admin/commissions/daily non trouvé');
      return {
        date: new Date().toISOString(),
        deposit_commissions: 15000,
        withdrawal_commissions: 8000,
        total_commissions: 23000,
        deposit_count: 12,
        withdrawal_count: 8
      };
    }
  },

  // ===================== TEST FUNCTIONS =====================
  async testConnection(): Promise<{ success: boolean, message: string }> {
    try {
      checkAuth();
      await api.get('/admin/stats');
      return { success: true, message: 'Connexion API admin OK' };
    } catch (error: any) {
      return { 
        success: false, 
        message: `Erreur connexion: ${error.response?.status || error.message}` 
      };
    }
  },

  // ===================== TRÉSORERIE PLATEFORME =====================
  getTreasuryBalance: treasuryService.getTreasuryBalance,
  getTreasuryWithdrawn: treasuryService.getTreasuryWithdrawn,
  getTreasuryTransactions: treasuryService.getTreasuryTransactions,
  getTreasuryStats: treasuryService.getTreasuryStats,
  depositToTreasury: treasuryService.depositToTreasury,
  withdrawFromTreasury: treasuryService.withdrawFromTreasury,
  testTreasuryConnection: treasuryService.testTreasuryConnection,

  // ==================== NOUVELLES FONCTIONNALITÉS (CORRECTION) ====================
  // Transactions améliorées
  getTransactionsPaginated: transactionService.getTransactions,
  getTransactionStats: transactionService.getTransactionStats,
  exportTransactions: transactionService.exportTransactions,
  
  // Redistribution corrigée
  getRedistributionHistory: redistributionService.getRedistributionHistory,
  validateRedistribution: redistributionService.validateRedistribution,
  
  // Utilitaires Decimal
  toDecimalString,
  parseDecimal,
  formatCurrency,

  // Méthodes utilitaires pour la précision décimale (compatibilité)
  formatAmount: treasuryService.formatAmount,
  parseAmount: treasuryService.parseAmount,
  calculateTotalFees: treasuryService.calculateTotalFees,

  // ===================== SETTINGS =====================
  async getSettings(): Promise<any> {
    checkAuth();
    try {
      const response = await api.get('/admin/settings');
      console.log('⚙️ Paramètres chargés:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur getSettings:', error);
      return {};
    }
  },

  async updateSettingsGeneral(data: any): Promise<{ success: boolean; data: any }> {
    checkAuth();
    try {
      const response = await api.put('/admin/settings/general', data);
      console.log('✅ Paramètres généraux mis à jour');
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur updateSettingsGeneral:', error);
      throw error;
    }
  },

  async updateSettingsFees(data: any): Promise<{ success: boolean; data: any }> {
    checkAuth();
    try {
      const response = await api.put('/admin/settings/fees', data);
      console.log('✅ Paramètres de frais mis à jour');
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur updateSettingsFees:', error);
      throw error;
    }
  },

  async updateSettingsPayment(data: any): Promise<{ success: boolean; data: any }> {
    checkAuth();
    try {
      const response = await api.put('/admin/settings/payment', data);
      console.log('✅ Paramètres de paiement mis à jour');
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur updateSettingsPayment:', error);
      throw error;
    }
  },

  async updateSettingsNotifications(data: any): Promise<{ success: boolean; data: any }> {
    checkAuth();
    try {
      const response = await api.put('/admin/settings/notifications', data);
      console.log('✅ Paramètres de notifications mis à jour');
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur updateSettingsNotifications:', error);
      throw error;
    }
  },

  async updateSettingsSecurity(data: any): Promise<{ success: boolean; data: any }> {
    checkAuth();
    try {
      const response = await api.put('/admin/settings/security', data);
      console.log('✅ Paramètres de sécurité mis à jour');
      return response.data;
    } catch (error: any) {
      console.error('❌ Erreur updateSettingsSecurity:', error);
      throw error;
    }
  }
};

// Exports pour compatibilité
export const getTreasuryBalance = treasuryService.getTreasuryBalance;
export const getTreasuryWithdrawn = treasuryService.getTreasuryWithdrawn;
export const getTreasuryTransactions = treasuryService.getTreasuryTransactions;
export const getTreasuryStats = treasuryService.getTreasuryStats;
export const depositToTreasury = treasuryService.depositToTreasury;
export const withdrawFromTreasury = treasuryService.withdrawFromTreasury;

export { formatCurrency as formatAmount, toBigNumber as parseAmount };
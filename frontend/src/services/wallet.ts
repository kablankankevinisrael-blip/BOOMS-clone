import api from './api';

export interface WalletBalance {
  available_balance: number;
  locked_balance: number;
  total_balance: number;
  currency: string;
}

export interface Transaction {
  id: number;
  user_id: number;
  amount: number;
  transaction_type: 
    | 'deposit' | 'withdrawal' 
    | 'boom_purchase' | 'boom_sell'
    | 'deposit_real' | 'withdrawal_real' | 'boom_purchase_real' | 'boom_sell_real'
    | 'redistribution_received'
    | 'bonus_received' | 'royalties_received' | 'gift_received'
    | 'bonus_payout' | 'royalties_payout' | 'gift_sent'
    | 'bonus_received_real' | 'royalties_received_real' | 'gift_received_real'
    | 'commission_received_real' | 'cashback_real' | 'reward_real'
    | 'fee_real' | 'commission_paid_real' | 'gift_sent_real'
    | 'penalty_real' | 'tax_real'
    | 'royalties_redistribution' | 'community_bonus' | 'system_redistribution';
  description: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
}

export interface DepositRequest {
  amount: number;
  phone_number: string;
}

export interface WithdrawalRequest {
  amount: number;
  phone_number: string;
}

export interface DetailedBalance {
  liquid_balance: number;
  bom_value: number;
  total_balance: number;
  currency: string;
}

export interface DualBalance {
  real_balance: number;
  virtual_balance: number;
  total_balance: number;
  currency: string;
  real_source: string;
  virtual_source: string;
}

export interface CashBalance {
  available: number;
  locked: number;
  usable: number;
  currency: string;
}

export interface VirtualBalance {
  balance: number;
  currency: string;
  source: string;
}

export interface PurchaseCheck {
  canPurchase: boolean;
  availableBalance: number;
  requiredAmount: number;
  missingAmount: number;
  isVirtual: boolean;
}

export interface CompleteBalance {
  cash: CashBalance;
  virtual: VirtualBalance;
  total: number;
  currency: string;
}

export function getTransactionTarget(transactionType: string): 'real' | 'virtual' | 'neutral' {
  const realTypes = [
    'deposit', 'withdrawal', 'boom_purchase', 'boom_sell', 
    'deposit_real', 'withdrawal_real', 'boom_purchase_real', 'boom_sell_real',
    'gift_received', 'bonus_received', 'fee', 'commission',
    'bonus_received_real', 'royalties_received_real', 'gift_received_real',
    'commission_received_real', 'cashback_real', 'reward_real',
    'fee_real', 'commission_paid_real', 'gift_sent_real',
    'penalty_real', 'tax_real'
  ];
  
  const virtualTypes = [
    'redistribution_received',
    'royalties_redistribution', 'community_bonus', 'system_redistribution'
  ];
  
  if (realTypes.includes(transactionType)) {
    return 'real';
  } else if (virtualTypes.includes(transactionType)) {
    return 'virtual';
  } else {
    return 'neutral';
  }
}

class WalletService {
  private cashBalanceCache: CashBalance | null = null;
  private virtualBalanceCache: VirtualBalance | null = null;
  private lastRefresh = 0;
  private readonly CACHE_DURATION = 10000;

  /**
   * 🔴 MÉTHODE AMÉLIORÉE : Rafraîchir le solde CASH
   */
  async refreshCashBalance(force: boolean = false): Promise<CashBalance> {
    try {
      // ✅ AJOUT: ID unique pour tracking des requêtes
      const requestId = Date.now();
      console.log(`🔄 [WALLET-SERVICE] Refresh cash #${requestId} (force: ${force})`);
      
      const now = Date.now();
      const shouldRefresh = force || 
                           !this.cashBalanceCache || 
                           (now - this.lastRefresh) > this.CACHE_DURATION;

      if (!shouldRefresh && this.cashBalanceCache) {
        console.log(`💰 [WALLET-SERVICE] Utilisation du cache cash balance (req #${requestId})`);
        return this.cashBalanceCache;
      }

      console.log(`🔄 [WALLET-SERVICE] refreshCashBalance: Appel API (req #${requestId})`);
      
      // 🔴 AMÉLIORATION: Invalider le cache côté client
      const params: any = { _t: Date.now() };
      if (force) {
        params.force = true;
      }
      
      const response = await api.get('/wallet/cash-balance', { params });

      const cashData = response.data;
      const cashBalance: CashBalance = {
        available: cashData.balance || cashData.available_balance || 0,
        locked: cashData.locked_balance || 0,
        usable: (cashData.balance || 0) - (cashData.locked_balance || 0),
        currency: cashData.currency || 'FCFA'
      };

      this.cashBalanceCache = cashBalance;
      this.lastRefresh = now;

      console.log(`✅ [WALLET] refreshCashBalance: Nouveau solde ${cashBalance.available} ${cashBalance.currency}`);
      
      return cashBalance;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur refreshCashBalance:', error);
      
      if (this.cashBalanceCache) {
        console.warn('⚠️ [WALLET] Utilisation du cache suite à erreur API');
        return this.cashBalanceCache;
      }
      
      return { 
        available: 0, 
        locked: 0, 
        usable: 0, 
        currency: 'FCFA' 
      };
    }
  }

  /**
   * 🔴 MÉTHODE AMÉLIORÉE : Rafraîchir le solde VIRTUEL
   */
  async refreshVirtualBalance(force: boolean = false): Promise<VirtualBalance> {
    try {
      const now = Date.now();
      const shouldRefresh = force || 
                           !this.virtualBalanceCache || 
                           (now - this.lastRefresh) > this.CACHE_DURATION;

      if (!shouldRefresh && this.virtualBalanceCache) {
        console.log('🎁 [WALLET] Utilisation du cache virtual balance');
        return this.virtualBalanceCache;
      }

      console.log('🔄 [WALLET] refreshVirtualBalance: Appel API pour user');
      
      // 🔴 AMÉLIORATION: Invalider le cache côté client
      const params: any = { _t: Date.now() };
      if (force) {
        params.force = true;
      }
      
      const response = await api.get('/wallet/balance', { params });

      const virtualData = response.data;
      const virtualBalance: VirtualBalance = {
        balance: virtualData.balance || virtualData.available_balance || 0,
        currency: virtualData.currency || 'FCFA',
        source: 'Redistributions communautaires'
      };

      this.virtualBalanceCache = virtualBalance;
      this.lastRefresh = now;

      console.log(`✅ [WALLET] refreshVirtualBalance: Nouveau solde ${virtualBalance.balance} ${virtualBalance.currency}`);
      
      return virtualBalance;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur refreshVirtualBalance:', error);
      
      if (this.virtualBalanceCache) {
        console.warn('⚠️ [WALLET] Utilisation du cache suite à erreur API');
        return this.virtualBalanceCache;
      }
      
      return { 
        balance: 0, 
        currency: 'FCFA', 
        source: 'Système' 
      };
    }
  }

  /**
   * 🔴 MÉTHODE AMÉLIORÉE : Rafraîchir TOUS les soldes
   */
  async refreshAllBalances(force: boolean = false): Promise<CompleteBalance> {
    try {
      const [cash, virtual] = await Promise.all([
        this.refreshCashBalance(force),
        this.refreshVirtualBalance(force)
      ]);

      return {
        cash,
        virtual,
        total: cash.usable + virtual.balance,
        currency: cash.currency
      };
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur refreshAllBalances:', error);
      return {
        cash: { available: 0, locked: 0, usable: 0, currency: 'FCFA' },
        virtual: { balance: 0, currency: 'FCFA', source: 'Erreur' },
        total: 0,
        currency: 'FCFA'
      };
    }
  }

  /**
   * Rafraîchir les transactions
   */
  async refreshTransactions(): Promise<Transaction[]> {
    try {
      const response = await api.get('/wallet/transactions', {
        params: { force: true }
      });
      return response.data;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur refreshTransactions:', error);
      return [];
    }
  }

  /**
   * Obtenir le solde détaillé
   */
  async getDetailedBalance(): Promise<DetailedBalance> {
    try {
      const response = await api.get('/wallet/balance/detailed');
      return response.data;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur solde détaillé:', error);
      return {
        liquid_balance: 0,
        bom_value: 0,
        total_balance: 0,
        currency: 'FCFA'
      };
    }
  }

  /**
   * Obtenir le solde simple (VIRTUEL - Wallet)
   */
  async getBalance(): Promise<WalletBalance> {
    try {
      const response = await api.get('/wallet/balance');
      return response.data;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur solde:', error);
      return {
        available_balance: 0,
        locked_balance: 0,
        total_balance: 0,
        currency: 'FCFA'
      };
    }
  }

  /**
   * Obtenir le solde RÉEL (CashBalance) - POUR ACHATS BOOM
   */
  async getRealBalance(): Promise<{ balance: number; currency: string }> {
    try {
      const response = await api.get('/wallet/cash-balance');
      return {
        balance: response.data.balance || 0,
        currency: response.data.currency || 'FCFA'
      };
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur argent réel:', error);
      return { balance: 0, currency: 'FCFA' };
    }
  }

  /**
   * Obtenir les DEUX soldes en une seule requête
   */
  async getDualBalance(): Promise<DualBalance> {
    try {
      const response = await api.get('/wallet/dual-balance');
      return response.data;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur soldes duals:', error);
      return {
        real_balance: 0,
        virtual_balance: 0,
        total_balance: 0,
        currency: 'FCFA',
        real_source: 'CashBalance - Pour achats BOOM',
        virtual_source: 'Wallet - Bonus & redistributions'
      };
    }
  }

  /**
   * Obtenir l'historique des transactions
   */
  async getTransactions(): Promise<Transaction[]> {
    try {
      const response = await api.get('/wallet/transactions');
      return response.data;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur transactions:', error);
      return [];
    }
  }

  /**
   * Déposer des fonds RÉELS
   */
  async deposit(depositData: DepositRequest): Promise<Transaction> {
    try {
      const response = await api.post('/wallet/deposit', depositData);
      
      // 🔴 AMÉLIORATION: Refresh forcé après dépôt
      await this.refreshCashBalance(true);
      
      return response.data;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur dépôt:', error);
      throw error;
    }
  }

  /**
   * Retirer des fonds RÉELS
   */
  async withdraw(withdrawalData: WithdrawalRequest): Promise<Transaction> {
    try {
      const response = await api.post('/wallet/withdraw', withdrawalData);
      
      // 🔴 AMÉLIORATION: Refresh forcé après retrait
      await this.refreshCashBalance(true);
      
      return response.data;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur retrait:', error);
      throw error;
    }
  }

  /**
   * Obtenir uniquement le solde RÉEL (pour affichage clair)
   */
  async getCashBalance(): Promise<CashBalance> {
    return this.refreshCashBalance(false);
  }

  /**
   * Obtenir uniquement le solde VIRTUEL (redistributions)
   */
  async getVirtualBalance(): Promise<VirtualBalance> {
    return this.refreshVirtualBalance(false);
  }

  /**
   * Vérifier si un achat est possible (solde réel suffisant)
   */
  async canPurchase(amount: number): Promise<PurchaseCheck> {
    try {
      const cashBalance = await this.getCashBalance();
      const canBuy = cashBalance.usable >= amount;
      
      return {
        canPurchase: canBuy,
        availableBalance: cashBalance.usable,
        requiredAmount: amount,
        missingAmount: Math.max(0, amount - cashBalance.usable),
        isVirtual: false
      };
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur vérification achat:', error);
      return {
        canPurchase: false,
        availableBalance: 0,
        requiredAmount: amount,
        missingAmount: amount,
        isVirtual: false
      };
    }
  }

  /**
   * Obtenir le détail complet des soldes (pour debug)
   */
  async getCompleteBalance(): Promise<CompleteBalance> {
    return this.refreshAllBalances(false);
  }

  /**
   * Obtenir le montant bloqué (si applicable)
   */
  async getLockedBalance(): Promise<number> {
    try {
      const response = await api.get('/wallet/locked-balance');
      return response.data.locked_balance || 0;
    } catch (error: any) {
      console.error('❌ [WALLET] Erreur montant bloqué:', error);
      return 0;
    }
  }

  /**
   * Invalider le cache (après une action utilisateur)
   */
  invalidateCache(): void {
    this.cashBalanceCache = null;
    this.virtualBalanceCache = null;
    this.lastRefresh = 0;
    console.log('🗑️ [WALLET] Cache invalidé');
  }
}

// Export unique
export const walletService = new WalletService();
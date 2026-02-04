import api from './api';

export interface PurchaseRequest {
  bom_id: number;
  quantity: number;
}

export interface PurchaseResponse {
  success: boolean;
  message: string;
  boom: {
    id: number;
    title: string;
    new_social_value: number;
    social_score: number;
  };
  financial: {
    amount_paid: number;
    fees: number;
    net_social_value: number;
  };
  social_impact: {
    share_count_24h: number;
    unique_holders: number;
    social_event: string | null;
  };
}

export interface InventoryBoomAsset {
  id: number;
  token_id: string;
  title: string;
  artist?: string;
  category?: string;
  current_social_value?: number;
  social_value?: number;
  value?: number;
  purchase_price?: number;
  base_price?: number;
  social_score?: number;
  social_event?: string | null;
  share_count_24h?: number;
  unique_holders_count?: number;
  edition_type?: string;
  current_edition?: number;
  max_editions?: number;
  preview_image?: string;
  animation_url?: string;
  collection_name?: string | null;
  market_capitalization?: number;
  capitalization_units?: number;
  redistribution_pool?: number;
  effective_capitalization?: number;
  [key: string]: any;
}

export interface InventoryFinancialBlock {
  purchase_price: number;
  current_social_value: number;
  profit_loss: number;
  profit_loss_percent: number;
  estimated_value?: number;
}

export interface InventorySocialMetrics {
  social_value: number;
  base_value: number;
  total_value: number;
  buy_count: number;
  sell_count: number;
  share_count: number;
  interaction_count: number;
  social_score: number;
  share_count_24h: number;
  unique_holders: number;
  acceptance_rate: number;
  social_event?: string | null;
  daily_interaction_score: number;
  market_capitalization?: number;
  capitalization_units?: number;
  redistribution_pool?: number;
  effective_capitalization?: number;
}

export interface InventoryItem {
  id: number;
  user_id: number;
  bom_id: number;
  token_id?: string;
  quantity?: number;
  transfer_id?: string;
  purchase_price?: number;
  current_value?: number;
  profit_loss?: number;
  hold_days?: number;
  times_shared?: number;
  is_transferable?: boolean;
  is_favorite?: boolean;
  acquired_at?: string;
  bom_asset?: InventoryBoomAsset; // Compatibilité legacy
  boom_data?: InventoryBoomAsset; // Nouveau schéma backend
  financial?: Partial<InventoryFinancialBlock>;
  social_metrics?: Partial<InventorySocialMetrics>;
  [key: string]: any;
}

export interface SellRequest {
  user_bom_id: number;
}

export interface SellResponse {
  success: boolean;
  message: string;
  financial: {
    amount_received: number;
    fees: number;
    profit_loss: number;
  };
  boom: {
    id: number;
    title: string;
    new_social_value: number;
    price_change: string;
  };
}

class PurchaseService {
  /**
   * Acheter un BOOM (fait augmenter sa valeur sociale)
   */
  async purchaseBom(purchaseData: PurchaseRequest): Promise<PurchaseResponse> {
    try {
      console.log('🛒 [PURCHASE] Début achat via /purchase/bom', purchaseData);
      
      const response = await api.post('/purchase/bom', {
        bom_id: purchaseData.bom_id,
        quantity: purchaseData.quantity
      });
      
      console.log('✅ [PURCHASE] Achat réussi via /purchase/bom:', response.data);
      
      // 🔥 CORRECTION: Synchronisation CRITIQUE du solde CASH
      if (response.data?.financial?.new_wallet_balance !== undefined) {
        console.log('💰 [PURCHASE] Nouveau solde cash du backend:', response.data.financial.new_wallet_balance);
        
        // IMPORTANT: Cette valeur DOIT être propagée au contexte
        // Le frontend NE DOIT PAS faire de calcul local (cashBalance - totalCost)
        // Il doit UTILISER la valeur exacte du backend
      }
      
      // 🔥 APPELER LA SYNC DU SOLDE RÉEL (cash)
      try {
        await this.forceCashBalanceSync();
        console.log('✅ [PURCHASE] Sync cash après achat réussie');
      } catch (syncError) {
        console.warn('⚠️ [PURCHASE] Sync cash échouée (non-critique):', syncError);
      }
      
      return response.data;
    } catch (error: any) {
      console.error('❌ [PURCHASE] Erreur achat:', error);
      console.error('❌ [PURCHASE] Détails:', error.response?.data);
      throw error;
    }
  }

  /**
   * Vendre/Retirer un BOOM (fait diminuer sa valeur sociale)
   */
  async sellBom(sellData: SellRequest): Promise<SellResponse> {
    try {
      const response = await api.post('/market/sell', {
        user_bom_id: sellData.user_bom_id
      });
      
      // 🔴 CORRECTION: Synchronisation IMMÉDIATE après vente
      try {
        await this.forceWalletSync();
        console.log('✅ [PURCHASE] Sync wallet après vente réussie');
      } catch (syncError) {
        console.warn('⚠️ [PURCHASE] Sync wallet échouée (non-critique):', syncError);
      }
      
      return response.data;
    } catch (error: any) {
      console.error('❌ [PURCHASE] Erreur vente:', error);
      throw error;
    }
  }

  /**
   * Obtenir l'inventaire avec valeurs sociales (avec support du force refresh)
   */
  async getInventory(force: boolean = false): Promise<InventoryItem[]> {
    try {
      const params = force ? { _t: Date.now(), force: true } : {};
      const response = await api.get('/purchase/inventory', { params });
      console.log(`📦 [PURCHASE] Inventaire chargé${force ? ' (FORCE)' : ''}:`, response.data.length, 'items');
      return response.data;
    } catch (error: any) {
      console.error('❌ [PURCHASE] Erreur inventaire:', error);
      return [];
    }
  }

  /**
   * 🔥 AJOUT: Méthode publique pour rafraîchir l'inventaire
   */
  async refreshInventory(force: boolean = true): Promise<InventoryItem[]> {
    console.log(`🔄 [PURCHASE] refreshInventory appelé${force ? ' (FORCE)' : ''}`);
    return await this.getInventory(force);
  }

  /**
   * Rafraîchir l'inventaire silencieusement (sans erreur visible)
   */
  private async refreshInventorySilent(): Promise<void> {
    try {
      await api.get('/purchase/inventory');
      console.log('✅ [PURCHASE] Inventaire refresh silencieux');
    } catch (error) {
      console.warn('⚠️ [PURCHASE] Refresh inventaire échoué (non-critique)');
    }
  }

  /**
   * Méthode privée pour forcer la synchro cash
   */
  private async forceCashBalanceSync(): Promise<void> {
    try {
      await api.get('/wallet/cash-balance', {
        params: { _t: Date.now(), force: true }
      });
      console.log('✅ [PURCHASE] Force cash balance sync réussie');
    } catch (error) {
      console.error('❌ [PURCHASE] Force cash balance sync échouée:', error);
      throw error;
    }
  }

  /**
   * Méthode privée pour forcer la synchro wallet complète
   */
  private async forceWalletSync(): Promise<void> {
    try {
      await Promise.all([
        api.get('/wallet/cash-balance', {
          params: { _t: Date.now(), force: true }
        }),
        api.get('/wallet/balance', {
          params: { _t: Date.now(), force: true }
        })
      ]);
      console.log('✅ [PURCHASE] Force wallet sync réussie');
    } catch (error) {
      console.error('❌ [PURCHASE] Force wallet sync échouée:', error);
      throw error;
    }
  }

  /**
   * Obtenir le prix d'achat avec frais
   */
  async getBuyQuote(bomId: number, quantity: number = 1): Promise<{
    boom_id: number;
    boom_title: string;
    current_social_value: number;
    purchase_price: number; // avec frais
    fees: number; // frais 5%
    total_cost: number;
    quantity: number;
  }> {
    try {
      const response = await api.get(`/market/price/${bomId}/buy`, {
        params: { quantity }
      });
      return response.data;
    } catch (error) {
      console.error('❌ [PURCHASE] Erreur devis achat:', error);
      throw error;
    }
  }

  /**
   * Obtenir le prix de vente avec frais
   */
  async getSellQuote(userBomId: number): Promise<{
    user_bom_id: number;
    boom_title: string;
    current_social_value: number;
    sell_price: number; // après frais
    fees: number; // frais 5%
    net_amount: number;
    profit_loss: number;
  }> {
    try {
      const response = await api.get(`/sell/quote/${userBomId}`);
      return response.data;
    } catch (error) {
      console.error('❌ [PURCHASE] Erreur devis vente:', error);
      throw error;
    }
  }
}

// Export unique
export const purchaseService = new PurchaseService();
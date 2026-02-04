/**
 * SERVICE DE MARCHÉ FINANCIER BOOMS
 * Interface avec l'API de trading addictif
 * Version corrigée et optimisée - Cohérence backend/frontend
 */
import api from './api';
import { BomAsset } from './boms';

export interface MarketPriceQuote {
  boom_id: number;
  boom_title: string;
  quantity: number;
  prices: {
    market_price: number;
    buy_price_per_unit: number;
    fees_per_unit: number;
    total_cost: number;
  };
  fees_breakdown: {
    spread_percentage: number;
    fees_amount: number;
    event_active: string | null;
    event_effect: string;
  };
  market_impact: string;
}

export interface MarketTradeFinancials {
  price_paid?: number;
  price_received?: number;
  amount_received?: number;
  sell_price?: number;
  fees?: number;
  profit_loss?: number;
  profit_percentage?: number;
  net_amount?: number;
  new_wallet_balance?: number | string;
  new_cash_balance?: number | string;
  new_real_balance?: number | string;
  cash_balance_before?: number | string;
  wallet_balance?: number | string;
  balances?: {
    real_balance?: number | string;
    virtual_balance?: number | string;
  };
  [key: string]: any;
}

export interface MarketTradeResponse {
  success: boolean;
  message: string;
  boom?: {
    id: number;
    title: string;
    new_price: number;
  };
  financial?: MarketTradeFinancials;
  addiction: {
    xp_gained: number;
    streak_bonus: number;
    event_bonus: number;
    potential_badges: string[];
    current_streak: {
      days: number;
      current_streak: number;
      longest_streak: number;
      bonus_multiplier: number;
  };
    leaderboard_position: number;
  };
  market_impact: {
    price_change: string;
    new_volume: number;
    rank_change: string;
  };
}

export interface BoomMarketData {
  boom_id: number;
  title: string;
  base_price?: number;
  current_social_value?: number;
  total_value?: number;
  prices: {
    base: number;
    current: number;
    buy: number;
    sell: number;
  };
  market_stats: {
    buy_volume_24h: number;
    sell_volume_24h: number;
    total_volume_24h: number;
    trade_count: number;
    volatility: number;
    liquidity_pool: number;
  };
  change: {
    percent: number;
    absolute: number;
  };
  event: {
    active: string | null;
    message: string | null;
    expires_at: string | null;
  };
  price_history: Array<{
    timestamp: string;
    price: number;
    action: string;
    volume: number;
    event?: string;
  }>;
  market_capitalization?: number;
  effective_capitalization?: number;
  capitalization_units?: number;
  redistribution_pool?: number;
  stabilization_ratio?: number;
}

export interface MarketOverview {
  total_market_cap: number;
  total_volume_24h: number;
  active_nfts: number;
  total_fees_collected: number;
  top_gainers: Array<{
    id: number;
    title: string;
    change: string;
    change_value: number;
    current_price: number;
    base_price: number;
  }>;
  top_losers: Array<{
    id: number;
    title: string;
    change: string;
    change_value: number;
    current_price: number;
    base_price: number;
  }>;
  hot_nfts: Array<{
    id: number;
    title: string;
    trade_count: number;
    volume_24h: number;
    current_price: number;
    event: string | null;
  }>;
  active_events: Array<{
    boom_id: number;
    title: string;
    event: string;
    event_message: string;
    expires_in: number;
  }>;
}

export interface MarketBuyRequest {
  boom_id: number;
  quantity: number;
}

export interface MarketSellRequest {
  user_bom_id: number;
}

export interface TrendingBoom {
  id: number;
  title: string;
  artist: string;
  current_price: number;
  price_change_24h: number;
  volume_24h: number;
  trade_count: number;
  trend_score: number;
  event: string | null;
  preview_image: string;
}

export interface ActiveEvent {
  boom_id: number;
  boom_title: string;
  event_type: string;
  event_message: string;
  time_remaining_minutes: number;
  current_price: number;
  preview_image: string;
  effect_description: string;
}

class MarketService {
  /**
   * Obtenir l'aperçu du marché
   */
  async getMarketOverview(): Promise<MarketOverview> {
    try {
      const response = await api.get('/market/overview');
      return response.data;
    } catch (error) {
      console.error('Error fetching market overview:', error);
      throw error;
    }
  }

  /**
   * Obtenir les données marché pour un Boom spécifique
   */
  async getBoomMarketData(boomId: number): Promise<BoomMarketData> {
    try {
      const response = await api.get(`/market/boom/${boomId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching market data for boom ${boomId}:`, error);
      throw error;
    }
  }

  /**
   * Obtenir un devis d'achat
   */
  async getBuyQuote(boomId: number, quantity: number = 1): Promise<MarketPriceQuote> {
    try {
      const response = await api.get(`/market/price/${boomId}/buy`, {
        params: { quantity }
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching buy quote for boom ${boomId}:`, error);
      throw error;
    }
  }

  /**
   * Obtenir un devis de vente
   */
  async getSellQuote(boomId: number): Promise<MarketPriceQuote> {
    try {
      const response = await api.get(`/market/price/${boomId}/sell`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching sell quote for boom ${boomId}:`, error);
      throw error;
    }
  }

  /**
   * Exécuter un achat sur le marché
   */
  async executeBuy(buyRequest: MarketBuyRequest): Promise<MarketTradeResponse> {
    try {
      const response = await api.post('/market/buy', buyRequest);
      const tradeResponse = response.data;
      
      console.log('✅ [MARKET] Achat exécuté - Réponse backend:', {
        success: tradeResponse.success,
        cash_included: tradeResponse.financial?.new_cash_balance,
        message: tradeResponse.message
      });
      
      return tradeResponse;
    } catch (error) {
      console.error('Error executing market buy:', error);
      throw error;
    }
  }

  /**
   * Exécuter une vente sur le marché
   */
  async executeSell(sellRequest: MarketSellRequest): Promise<MarketTradeResponse> {
    try {
      const response = await api.post('/market/sell', sellRequest);
      const tradeResponse = response.data;
      
      console.log('✅ [MARKET] Vente exécutée - Réponse backend:', {
        success: tradeResponse.success,
        cash_included: tradeResponse.financial?.new_cash_balance,
        message: tradeResponse.message
      });
      
      return tradeResponse;
    } catch (error) {
      console.error('Error executing market sell:', error);
      throw error;
    }
  }

  /**
   * Obtenir les Booms tendance
   */
  async getTrendingBooms(limit: number = 10): Promise<{
    trending_booms: TrendingBoom[];
    total_trending: number;
    market_status: string;
  }> {
    try {
      const response = await api.get('/market/trending', {
        params: { limit }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching trending booms:', error);
      throw error;
    }
  }

  /**
   * Obtenir les événements actifs
   */
  async getActiveEvents(): Promise<{
    active_events: ActiveEvent[];
    total_active_events: number;
    next_event_check_in: number;
  }> {
    try {
      const response = await api.get('/market/events/active');
      return response.data;
    } catch (error) {
      console.error('Error fetching active events:', error);
      throw error;
    }
  }

  /**
   * Déclencher un événement de test (admin)
   */
  async triggerTestEvent(boomId: number, eventType: string): Promise<any> {
    try {
      const response = await api.post('/market/events/trigger-test', null, {
        params: { boom_id: boomId, event_type: eventType }
      });
      return response.data;
    } catch (error) {
      console.error('Error triggering test event:', error);
      throw error;
    }
  }

  /**
   * Simuler l'impact d'un achat sur le prix
   */
  simulatePriceImpact(currentPrice: number, quantity: number, volatility: number = 0.01): {
    newPrice: number;
    impactPercent: number;
  } {
    const priceChange = volatility * quantity * 0.01;
    const newPrice = currentPrice * (1 + priceChange);
    const impactPercent = priceChange * 100;
    
    return {
      newPrice: parseFloat(newPrice.toFixed(4)),
      impactPercent: parseFloat(impactPercent.toFixed(4))
    };
  }

  /**
   * Calculer les frais de spread (5% par défaut)
   */
  calculateSpreadFees(marketPrice: number, quantity: number, spreadPercent: number = 0.05): {
    buyPrice: number;
    sellPrice: number;
    feesPerUnit: number;
    totalFees: number;
  } {
    const buyPrice = marketPrice * (1 + spreadPercent);
    const sellPrice = marketPrice * (1 - spreadPercent);
    const feesPerUnit = marketPrice * spreadPercent;
    const totalFees = feesPerUnit * quantity;
    
    return {
      buyPrice: parseFloat(buyPrice.toFixed(4)),
      sellPrice: parseFloat(sellPrice.toFixed(4)),
      feesPerUnit: parseFloat(feesPerUnit.toFixed(4)),
      totalFees: parseFloat(totalFees.toFixed(4))
    };
  }

  /**
   * Obtenir le statut du marché (pour notifications)
   */
  getMarketStatus(): string {
    const statuses = [
      "📈 Marché en hausse",
      "📉 Marché en baisse", 
      "⚡ Forte volatilité",
      "🎰 Événements actifs",
      "📊 Activité normale"
    ];
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  /**
   * Obtenir un message addictif pour un trade
   */
  getAddictiveMessage(action: 'buy' | 'sell', profit?: number): string {
    const buyMessages = [
      "🔥 Excellent timing d'achat!",
      "📈 Tu viens d'acheter un futur winner!",
      "💎 Diamond hands activés!",
      "🚀 To the moon avec cet achat!",
      "🎯 Précision de trader!"
    ];
    
    const sellMessages = [
      "💰 Cash out réussi!",
      "📊 Trade parfaitement exécuté!",
      "💸 Argent encaissé avec succès!",
      "🏆 Vente de maître!",
      "✨ Timing parfait pour vendre!"
    ];
    
    if (action === 'buy') {
      return buyMessages[Math.floor(Math.random() * buyMessages.length)];
    } else {
      let message = sellMessages[Math.floor(Math.random() * sellMessages.length)];
      if (profit && profit > 0) {
        message += ` Gain: +${profit} FCFA!`;
      }
      return message;
    }
  }
}

export const marketService = new MarketService();
import api from './api';
import { CAPITALIZATION_CONSTANTS } from '../utils/stabilization';

export interface NFTAttribute {
  trait_type: string;
  value: string;
}

// NOUVELLE INTERFACE BOOM (identique à NFT mais avec champs BOOM)
export interface Boom {
  // === IDENTIFICATION ===
  id: number;
  token_id: string;
  
  // === MÉTADONNÉES ===
  title: string;
  description: string | null;
  artist: string;
  category: string;
  tags: string[];
  
  // === MÉDIAS ===
  animation_url: string;
  audio_url: string | null;
  preview_image: string;
  duration: number | null;
  has_audio: boolean;
  
  // === VALEURS (AJOUTÉS pour BOOM) ===
  base_value?: number;           // Nouveau: valeur de base
  social_value?: number;         // Nouveau: valeur sociale
  total_value?: number;          // Nouveau: valeur totale
  social_delta?: number;         // Nouveau: écart social (total - base)
  
  // === VALEURS EXISTANTES (gardées pour compatibilité) ===
  value: number;                // Valeur réelle (alias de total_value)
  purchase_price: number;       // Prix d'achat
  royalty_percentage: number;   // % royalties
  
  // === PROPRIÉTÉ ===
  owner_id: number | null;
  owner_name?: string;
  creator_id: number;
  creator_name?: string;
  
  // === COLLECTION ===
  collection_id: number | null;
  collection_name: string | null;
  
  // === ÉDITION ===
  edition_type: 'common' | 'rare' | 'ultra_rare' | 'legendary';
  max_editions: number | null;
  current_edition: number;
  available_editions: number | null;
  
  // === MÉTADONNÉES NFT ===
  metadata: {
    standard: string;
    attributes: NFTAttribute[];
    external_url: string;
    animation_type: 'gif' | 'mp4' | 'webm';
    created_with: string;
    [key: string]: any;
  };
  
  // === CHAMPS BOOM (AJOUTÉS) ===
  current_social_value?: number;   // Compatibilité avec l'existant
  social_score?: number;           // Score social
  social_event?: 'viral' | 'trending' | 'new' | 'stable';
  share_count_24h?: number;
  buy_count_24h?: number;
  sell_count_24h?: number;
  buy_count?: number;
  sell_count?: number;
  share_count?: number;
  interaction_count?: number;
  volatility?: number;
  unique_holders_count?: number;
  market_capitalization?: number;
  effective_capitalization?: number;
  capitalization_units?: number;
  redistribution_pool?: number;
  palier_threshold?: number;
  stabilization_ratio?: number;
  
  // === ÉTAT ===
  is_active: boolean;
  is_minted: boolean;
  is_listed: boolean;
  listing_price: number | null;
  
  // === TIMESTAMPS ===
  minted_at: string;
  created_at: string;
  updated_at: string | null;
}

// ALIAS POUR COMPATIBILITÉ
export type NFT = Boom;

export interface Collection {
  id: number;
  name: string;
  description: string | null;
  creator_id: number;
  creator_name?: string;
  banner_image: string | null;
  thumbnail_image: string | null;
  is_verified: boolean;
  total_items: number;
  floor_price: number | null;
  total_volume: number;
  collection_metadata: Record<string, any>;
  created_at: string;
}

export interface BoomFilters {
  category?: string;
  artist?: string;
  collection?: string;
  edition_type?: string;
  owner?: number;
  min_value?: number;
  max_value?: number;
  min_social_value?: number;
  max_social_value?: number;
  social_event?: string;
  has_audio?: boolean;
  search?: string;
  sort_by?: 'social_value' | 'total_value' | 'base_value' | 'volatility' | 'buy_count';
  limit?: number;
  offset?: number;
}

// ALIAS POUR COMPATIBILITÉ
export type NFTFilters = BoomFilters;

export interface UserBoom extends Boom {
  transfer_id?: string;
  sender_id?: number;
  receiver_id?: number;
  transfer_message?: string;
  is_transferable: boolean;
  acquired_at: string;
  transferred_at: string | null;
}

// ALIAS POUR COMPATIBILITÉ
export type UserNFT = UserBoom;

// ✅ Fonction utilitaire pour valider les URLs média
export const validateBoomMediaUrl = (boom: Boom): string => {
  if (!boom.animation_url) {
    return boom.preview_image || 'https://media.giphy.com/media/3o7abAHdYvZdBNnGZq/giphy.gif';
  }
  
  if (!boom.animation_url.startsWith('http')) {
    console.warn(`URL animation invalide pour BOOM ${boom.token_id}: ${boom.animation_url}`);
    return boom.preview_image || 'https://media.giphy.com/media/3o7abAHdYvZdBNnGZq/giphy.gif';
  }
  
  return boom.animation_url;
};

export const detectAnimationType = (url: string): 'gif' | 'mp4' | 'image' => {
  if (!url) return 'image';
  
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('.gif') || lowerUrl.includes('giphy')) {
    return 'gif';
  } else if (lowerUrl.match(/\.(mp4|mov|avi|mkv|webm|m4v)$/)) {
    return 'mp4';
  } else {
    return 'image';
  }
};

const toNumber = (value: any, fallback = 0): number => {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBoom = (boom: any): Boom => {
  const baseValue = toNumber(
    boom.base_value ??
    boom.base_price ??
    boom.purchase_price ??
    boom.value
  );
  const microValue = toNumber(
    boom.current_social_value ??
    boom.applied_micro_value ??
    boom.social_value ??
    0
  );
  const totalValue = toNumber(
    boom.total_value ??
    boom.value ??
    (baseValue + microValue)
  );
  const socialDelta = totalValue - baseValue;
  const socialMetrics = (boom && typeof boom === 'object' ? boom.social_metrics : null) || {};
  const marketCap = toNumber(boom.market_capitalization ?? socialMetrics.market_capitalization);
  const effectiveCap = toNumber(
    boom.effective_capitalization ??
    socialMetrics.effective_capitalization ??
    marketCap
  );
  const capUnits = toNumber(boom.capitalization_units ?? socialMetrics.capitalization_units);
  const redistributionPool = toNumber(boom.redistribution_pool ?? socialMetrics.redistribution_pool);
  const stabilizationRatio = toNumber(boom.stabilization_ratio ?? socialMetrics.stabilization_ratio);
  const buyCountTotal = toNumber(boom.buy_count ?? socialMetrics.buy_count);
  const sellCountTotal = toNumber(boom.sell_count ?? socialMetrics.sell_count);
  const buyCount24h = toNumber(boom.buy_count_24h ?? socialMetrics.buy_count_24h);
  const sellCount24h = toNumber(boom.sell_count_24h ?? socialMetrics.sell_count_24h);
  const palierThreshold = toNumber(
    boom.palier_threshold ??
    socialMetrics.palier_threshold ??
    CAPITALIZATION_CONSTANTS?.PALIER_THRESHOLD ??
    1_000_000
  );

  return {
    ...boom,
    base_value: baseValue,
    social_value: socialDelta,
    social_delta: socialDelta,
    current_social_value: microValue,
    total_value: totalValue,
    value: totalValue,
    animation_url: validateBoomMediaUrl(boom),
    has_audio: Boolean(boom.audio_url),
    market_capitalization: marketCap,
    effective_capitalization: effectiveCap,
    capitalization_units: capUnits,
    redistribution_pool: redistributionPool,
    stabilization_ratio: stabilizationRatio,
    buy_count: buyCountTotal,
    sell_count: sellCountTotal,
    buy_count_24h: buyCount24h,
    sell_count_24h: sellCount24h,
    palier_threshold: palierThreshold
  };
};

// ✅ SERVICE PRINCIPAL BOOM (identique à l'ancien nftsService)
export const boomsService = {
  // === RÉCUPÉRATION BOOMS ===
  async getBooms(filters?: BoomFilters): Promise<Boom[]> {
    try {
      const params = new URLSearchParams();
      
      // Ajouter les filtres
      if (filters?.category) params.append('category', filters.category);
      if (filters?.artist) params.append('artist', filters.artist);
      if (filters?.collection) params.append('collection', filters.collection);
      if (filters?.edition_type) params.append('edition_type', filters.edition_type);
      if (filters?.owner) params.append('owner', filters.owner.toString());
      if (filters?.min_value !== undefined) params.append('min_value', filters.min_value.toString());
      if (filters?.max_value !== undefined) params.append('max_value', filters.max_value.toString());
      if (filters?.min_social_value !== undefined) params.append('min_social_value', filters.min_social_value.toString());
      if (filters?.max_social_value !== undefined) params.append('max_social_value', filters.max_social_value.toString());
      if (filters?.social_event) params.append('social_event', filters.social_event);
      if (filters?.search) params.append('search', filters.search);
      if (filters?.sort_by) params.append('sort_by', filters.sort_by);
      if (filters?.has_audio !== undefined) params.append('has_audio', filters.has_audio.toString());
      if (filters?.limit) params.append('limit', filters.limit.toString());
      if (filters?.offset) params.append('offset', filters.offset.toString());
      
      const url = `/nfts${params.toString() ? `?${params.toString()}` : ''}`;
      console.log(`🌐 [boomsService] GET ${url}`);
      
      const response = await api.get(url);
      const validatedBooms = Array.isArray(response.data)
        ? response.data.map(normalizeBoom)
        : [];
      
      console.log(`✅ [boomsService] ${validatedBooms.length} BOOMS chargés`);
      return validatedBooms;
    } catch (error) {
      console.error('❌ [boomsService] Error fetching BOOMS:', error);
      return [];
    }
  },

  // ✅ FONCTION CRITIQUE : Détails d'un BOOM
  async getBoomDetails(idOrTokenId: number | string): Promise<Boom> {
    try {
      console.log(`📡 [boomsService] getBoomDetails appelé avec:`, idOrTokenId);
      
      const response = await api.get(`/nfts/${idOrTokenId}`);
      const validatedBoom = normalizeBoom(response.data);
      
      console.log(`✅ [boomsService] BOOM chargé:`, {
        id: validatedBoom.id,
        token_id: validatedBoom.token_id,
        title: validatedBoom.title,
        social_value: validatedBoom.social_value
      });
      
      return validatedBoom;
    } catch (error: any) {
      console.error(`❌ [boomsService] Erreur getBoomDetails:`, error);
      
      // Fallback : essayer de trouver dans la liste
      try {
        console.log(`🔄 Tentative fallback: recherche dans liste complète`);
        const allBooms = await this.getBooms({ limit: 100 });
        const foundBoom = allBooms.find(b => 
          b.id === idOrTokenId || 
          b.token_id === idOrTokenId.toString()
        );
        
        if (foundBoom) {
          console.log(`✅ BOOM trouvé via fallback`);
          return foundBoom;
        }
      } catch (fallbackError) {
        console.error(`💥 Fallback échoué:`, fallbackError);
      }
      
      throw new Error(`BOOM avec ID/token ${idOrTokenId} non trouvé`);
    }
  },

  // === COLLECTIONS ===
  async getCollections(): Promise<Collection[]> {
    try {
      console.log(`🌐 [boomsService] GET /nfts/collections`);
      const response = await api.get('/nfts/collections');
      console.log(`✅ [boomsService] ${response.data?.length || 0} collections chargées`);
      return response.data || [];
    } catch (error) {
      console.error('❌ [boomsService] Error fetching collections:', error);
      return [];
    }
  },

  async getCollectionById(id: number): Promise<Collection> {
    try {
      const response = await api.get(`/nfts/collections/${id}`);
      return response.data;
    } catch (error) {
      console.error('❌ [boomsService] Error fetching collection:', error);
      throw error;
    }
  },

  async getCollectionBooms(collectionId: number, limit: number = 20): Promise<Boom[]> {
    try {
      const response = await api.get(`/nfts/collections/${collectionId}/nfts?limit=${limit}`);
      return Array.isArray(response.data) ? response.data.map(normalizeBoom) : [];
    } catch (error) {
      console.error('❌ [boomsService] Error fetching collection BOOMS:', error);
      return [];
    }
  },

  // === FILTRES ET LISTES ===
  async getCategories(): Promise<string[]> {
    try {
      console.log(`🌐 [boomsService] GET /nfts/categories/list`);
      const response = await api.get('/nfts/categories/list');
      console.log(`✅ [boomsService] ${response.data?.categories?.length || 0} catégories`);
      return response.data?.categories || [];
    } catch (error) {
      console.error('❌ [boomsService] Error fetching categories:', error);
      return [];
    }
  },

  async getArtists(): Promise<string[]> {
    try {
      console.log(`🌐 [boomsService] GET /nfts/artists`);
      const response = await api.get('/nfts/artists/list'); 
      console.log(`✅ [boomsService] ${response.data?.artists?.length || 0} artistes`);
      return response.data?.artists || [];
    } catch (error) {
      console.error('❌ [boomsService] Error fetching artists:', error);
      return [];
    }
  },

  async getCollectionNames(): Promise<string[]> {
    try {
      console.log(`🌐 [boomsService] GET /nfts/collections/list`);
      
      const response = await api.get('/nfts/collections/list');
      const collections = response.data || [];
      
      console.log(`📊 [boomsService] ${collections.length} collections reçues`);
      
      const collectionNames = collections
        .map((col: Collection) => col.name)
        .filter((name: string | null) => name && name.trim() !== '');
      
      console.log(`✅ [boomsService] ${collectionNames.length} noms de collections extraits`);
      return collectionNames;
    } catch (error) {
      console.error('❌ [boomsService] Error fetching collections list:', error);
      return [];
    }
  },

  async getEditionTypes(): Promise<string[]> {
    return ['common', 'rare', 'ultra_rare', 'legendary'];
  },

  // === UTILISATEURS ===
  async getUserOwnedBooms(userId: number): Promise<Boom[]> {
    try {
      const response = await api.get(`/users/${userId}/nfts`);
      return Array.isArray(response.data) ? response.data.map(normalizeBoom) : [];
    } catch (error) {
      console.error('❌ [boomsService] Error fetching user BOOMS:', error);
      return [];
    }
  },

  async getUserCreatedBooms(userId: number): Promise<Boom[]> {
    try {
      const response = await api.get(`/users/${userId}/created-nfts`);
      return Array.isArray(response.data) ? response.data.map(normalizeBoom) : [];
    } catch (error) {
      console.error('❌ [boomsService] Error fetching user created BOOMS:', error);
      return [];
    }
  },

  async getArtistBooms(artistName: string): Promise<Boom[]> {
    try {
      const response = await api.get(`/nfts/artist/${encodeURIComponent(artistName)}`);
      return Array.isArray(response.data) ? response.data.map(normalizeBoom) : [];
    } catch (error) {
      console.error('❌ [boomsService] Error fetching artist BOOMS:', error);
      return [];
    }
  },

  // === RECHERCHE ===
  async searchBooms(query: string, limit: number = 20): Promise<Boom[]> {
    try {
      const response = await api.get(`/nfts/search?q=${encodeURIComponent(query)}&limit=${limit}`);
      return Array.isArray(response.data) ? response.data.map(normalizeBoom) : [];
    } catch (error) {
      console.error('❌ [boomsService] Error searching BOOMS:', error);
      return [];
    }
  },

  // === STATISTIQUES ===
  async getBoomStats() {
    try {
      const response = await api.get('/nfts/stats');
      return response.data;
    } catch (error) {
      console.error('❌ [boomsService] Error fetching BOOM stats:', error);
      return {
        total_nfts: 0,
        total_collections: 0,
        total_artists: 0,
        total_value: 0
      };
    }
  },

  // === TÉLÉCHARGEMENT MÉTADONNÉES ===
  async downloadBoomMetadata(tokenId: string) {
    try {
      const response = await api.get(`/nfts/${tokenId}/metadata`);
      return response.data;
    } catch (error) {
      console.error('❌ [boomsService] Error downloading BOOM metadata:', error);
      return null;
    }
  },

  // === VÉRIFICATION PROPRIÉTÉ ===
  async verifyOwnership(tokenId: string, userId: number): Promise<boolean> {
    try {
      const response = await api.get(`/nfts/${tokenId}/verify-ownership/${userId}`);
      return response.data.is_owner;
    } catch (error) {
      console.error('❌ [boomsService] Error verifying ownership:', error);
      return false;
    }
  },

  // === TRANSFERT ===
  async transferBoom(tokenId: string, toUserId: number, message?: string) {
    try {
      const response = await api.post(`/nfts/${tokenId}/transfer`, {
        to_user_id: toUserId,
        message: message || ''
      });
      return response.data;
    } catch (error) {
      console.error('❌ [boomsService] Error transferring BOOM:', error);
      throw error;
    }
  },

  // === MISE EN VENTE ===
  async listBoomForSale(tokenId: string, price: number) {
    try {
      const response = await api.post(`/nfts/${tokenId}/list`, {
        price: price
      });
      return response.data;
    } catch (error) {
      console.error('❌ [boomsService] Error listing BOOM:', error);
      throw error;
    }
  },

  async unlistBoom(tokenId: string) {
    try {
      const response = await api.post(`/nfts/${tokenId}/unlist`);
      return response.data;
    } catch (error) {
      console.error('❌ [boomsService] Error unlisting BOOM:', error);
      throw error;
    }
  },

  // === ACHAT ===
  async purchaseBoom(tokenId: string, quantity: number = 1) {
    try {
      const response = await api.post(`/nfts/${tokenId}/purchase`, {
        quantity: quantity
      });
      return response.data;
    } catch (error) {
      console.error('❌ [boomsService] Error purchasing BOOM:', error);
      throw error;
    }
  },

  // === TEST CONNEXION ===
  async testConnection(): Promise<boolean> {
    try {
      await api.get('/nfts');
      console.log('✅ [boomsService] Connexion API OK');
      return true;
    } catch (error) {
      console.error('❌ [boomsService] Connexion API échouée:', error);
      return false;
    }
  }
};

// ✅ EXPORT POUR COMPATIBILITÉ - MÊME NOMS QU'AVANT
export const nftsService = {
  getNFTs: boomsService.getBooms,
  getNFTDetails: boomsService.getBoomDetails,
  getCollections: boomsService.getCollections,
  getCollectionById: boomsService.getCollectionById,
  getCollectionNFTs: boomsService.getCollectionBooms,
  getCategories: boomsService.getCategories,
  getArtists: boomsService.getArtists,
  getCollections: boomsService.getCollectionNames,
  getEditionTypes: boomsService.getEditionTypes,
  getUserOwnedNFTs: boomsService.getUserOwnedBooms,
  getUserCreatedNFTs: boomsService.getUserCreatedBooms,
  getArtistNFTs: boomsService.getArtistBooms,
  searchNFTs: boomsService.searchBooms,
  getNFTStats: boomsService.getBoomStats,
  downloadNFTMetadata: boomsService.downloadBoomMetadata,
  verifyOwnership: boomsService.verifyOwnership,
  transferNFT: boomsService.transferBoom,
  listNFTForSale: boomsService.listBoomForSale,
  unlistNFT: boomsService.unlistBoom,
  purchaseNFT: boomsService.purchaseBoom,
  testConnection: boomsService.testConnection
};
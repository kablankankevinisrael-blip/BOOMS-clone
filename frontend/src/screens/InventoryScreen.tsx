import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  RefreshControl,
  Alert,
  Modal,
  ScrollView,
  SectionList,
  SafeAreaView
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { purchaseService, InventoryItem } from '../services/purchase';
import { boomsWebSocket, getActionIcon, formatDelta } from '../services/websocket';
import { NFTAnimationPlayer } from '../components/VideoPlayer';
import {
  computeCapProgress,
  describeMicroInfluence,
  formatCompactCurrency,
  getNextMilestone
} from '../utils/stabilization';

type NormalizedBom = {
  id: number | string;
  title: string;
  description?: string;
  artist: string;
  base_value: number;
  social_value: number;
  current_social_value: number;
  value: number;
  current_market_value: number;
  social_score?: number;
  social_event?: string | null;
  category?: string;
  collection_name?: string;
  edition_type?: string;
  preview_image?: string | null;
  animation_url?: string | null;
  audio_url?: string | null;
  media_url?: string | null;
  thumbnail_url?: string | null;
  acquired_at?: string;
  is_transferable?: boolean;
  token_id?: string;
  purchase_price?: number;
  profit_loss?: number;
  return_rate?: number;
};

type InventoryNFT = InventoryItem & {
  bom: NormalizedBom;
  lastMarketDelta?: number;
  lastMarketAction?: string;
  lastMarketUpdate?: number;
};

type GroupedInventory = {
  byCollection: Record<string, InventoryNFT[]>;
  byRarity: Record<string, InventoryNFT[]>;
  stats: {
    collections: number;
    rarities: number;
  };
};

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'XOF',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

const formatCurrencyValue = (value: number): string => {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number(value) || 0;
  return currencyFormatter.format(parseFloat(numeric.toFixed(4)));
};

const formatSignedCurrency = (value: number): string => {
  const formatted = formatCurrencyValue(Math.abs(value));
  if (!value) {
    return formatted;
  }
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatted}`;
};

const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp) {
    return 'Flux live';
  }
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 5) return "à l'instant";
  if (diffSeconds < 60) return `il y a ${diffSeconds}s`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
};

const getMarketActionLabel = (action?: string): string => {
  switch (action) {
    case 'buy':
      return 'Pression acheteuse détectée';
    case 'sell':
      return 'Vente enregistrée sur le marché';
    case 'share':
      return 'Buzz social en cours';
    case 'gift':
      return 'Transfert observé';
    case 'like':
      return 'Engagement social';
    default:
      return 'Flux de marché en temps réel';
  }
};

const safeGet = <T,>(obj: any, path: string, fallback: T): T => {
  if (!obj || typeof obj !== 'object') return fallback;

  const keys = path.split('.');
  let result: any = obj;

  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      console.log(`⚠️ [INVENTORY] Propriété manquante: ${path}`);
      return fallback;
    }
  }

  return (result ?? fallback) as T;
};

const safeNumber = (value: any, fallback: number = 0): number => {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return !isNaN(parsed) ? parsed : fallback;
  }
  return fallback;
};

const extractMetric = (item: InventoryNFT, pathCandidates: string[]): number => {
  for (const path of pathCandidates) {
    const candidate = safeGet<any>(item, path, null);
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return 0;
};

const getStabilizationSnapshot = (item: InventoryNFT) => {
  const marketCap = extractMetric(item, [
    'social_metrics.market_capitalization',
    'bom.market_capitalization',
    'bom_asset.market_capitalization',
    'market_capitalization'
  ]);
  const effectiveCap = extractMetric(item, [
    'social_metrics.effective_capitalization',
    'bom.effective_capitalization',
    'bom_asset.effective_capitalization'
  ]) || marketCap;
  const redistributionPool = extractMetric(item, [
    'social_metrics.redistribution_pool',
    'bom.redistribution_pool',
    'bom_asset.redistribution_pool'
  ]);
  const capUnits = extractMetric(item, [
    'social_metrics.capitalization_units',
    'bom.capitalization_units',
    'bom_asset.capitalization_units'
  ]);
  const capProgress = computeCapProgress(effectiveCap);
  const nextMilestone = getNextMilestone(capProgress);

  return {
    marketCap,
    effectiveCap,
    redistributionPool,
    capUnits,
    capProgress,
    nextMilestone
  };
};

export default function InventoryScreen({ navigation }: any) {
  const [inventory, setInventory] = useState<InventoryNFT[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNFT, setSelectedNFT] = useState<InventoryNFT | null>(null);
  const [groupedInventory, setGroupedInventory] = useState<GroupedInventory>({
    byCollection: {},
    byRarity: {},
    stats: { collections: 0, rarities: 0 }
  });
  const [viewMode, setViewMode] = useState<'list' | 'collection' | 'rarity'>('list');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [totalValue, setTotalValue] = useState<number>(0);
  const [averageSocialScore, setAverageSocialScore] = useState<number>(0);
  const [portfolioPnL, setPortfolioPnL] = useState<number>(0);
  const [totalInvested, setTotalInvested] = useState<number>(0);

  // ==================== CALCUL DES TOTAUX ====================
  const calculateTotals = useCallback((inv: InventoryNFT[]) => {
    let totalVal = 0;
    let totalSocialScores = 0;
    let countWithScore = 0;
    let invested = 0;
    let totalPnL = 0;
    
    inv.forEach(item => {
      const currentMarket = safeGet<number | null>(item, 'bom.current_market_value', null);
      const fallbackValue = safeGet(item, 'bom.value', 0);
      const value = safeNumber(currentMarket ?? fallbackValue);
      totalVal += value;
      const costBasis = safeNumber(safeGet(item, 'bom.purchase_price', fallbackValue));
      invested += costBasis;
      totalPnL += value - costBasis;
      
      const socialScore = safeNumber(safeGet(item, 'bom.social_score', 0));
      if (socialScore > 0) {
        totalSocialScores += socialScore;
        countWithScore++;
      }
    });
    
    const avgScore = countWithScore > 0 ? totalSocialScores / countWithScore : 0;
    const avgReturn = invested > 0 ? (totalPnL / invested) * 100 : 0;
    
    setTotalValue(totalVal);
    setAverageSocialScore(avgScore);
    setPortfolioPnL(totalPnL);
    setTotalInvested(invested);
    
    return { totalVal, avgScore };
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log('🔍 [INVENTORY] Focus effect - Chargement inventaire');
      loadInventory();
    }, [])
  );

  const loadInventory = async () => {
    try {
      setLoading(true);
      console.time('📦 [INVENTORY] Temps chargement inventaire');
      
      console.log('🔄 [INVENTORY] Appel API getInventory...');
      const inventoryData = await purchaseService.getInventory();
      
      // DEBUG: Log complet des données reçues
      console.log('📊 [INVENTORY] Données API brutes reçues:', {
        type: typeof inventoryData,
        isArray: Array.isArray(inventoryData),
        length: Array.isArray(inventoryData) ? inventoryData.length : 'N/A',
        sample: Array.isArray(inventoryData) && inventoryData.length > 0 
          ? JSON.stringify(inventoryData[0], null, 2).substring(0, 500) + '...'
          : 'Aucune donnée'
      });

      // Validation des données
      if (!Array.isArray(inventoryData)) {
        console.error('❌ [INVENTORY] Données invalides: pas un tableau', inventoryData);
        Alert.alert('Erreur', 'Format de données invalide. Réessayez.');
        setInventory([]);
        setTotalValue(0);
        setAverageSocialScore(0);
        return;
      }

      // Nettoyage et normalisation des données
      const cleanedInventory: InventoryNFT[] = inventoryData.map((item, index) => {
        // DEBUG: Analyse de la structure
        if (index === 0) {
          console.log('🔎 [INVENTORY] Structure du premier item:', {
            keys: Object.keys(item),
            hasBom: 'bom' in item,
            hasBoom_data: 'boom_data' in item,
            bom_keys: item.bom ? Object.keys(item.bom) : 'N/A',
            boom_data_keys: item.boom_data ? Object.keys(item.boom_data) : 'N/A'
          });
        }

        const dataSource = item.bom || item.boom_data || {};
        const assetData = item.bom_asset || {};
        const rawItem = item as any;
        const financial = rawItem?.financial || {};
        const socialMetrics = rawItem?.social_metrics || {};
        const purchasePrice = safeNumber(
          item.purchase_price ??
          assetData.purchase_price ??
          dataSource.purchase_price ??
          financial.purchase_price ??
          rawItem?.financial?.amount_paid ??
          rawItem?.cost_basis ??
          0
        );
        const baseValue = safeNumber(
          dataSource.base_value ??
          socialMetrics.base_value ??
          rawItem?.base_value ??
          assetData.base_price ??
          purchasePrice
        );
        const microValue = safeNumber(
          financial.applied_micro_value ??
          financial.current_social_value ??
          socialMetrics.social_value ??
          dataSource.current_social_value ??
          dataSource.social_value ??
          assetData.current_social_value ??
          0
        );
        const backendTotalValue = safeNumber(
          financial.total_value ??
          socialMetrics.total_value ??
          item.current_value ??
          rawItem?.current_value ??
          dataSource.total_value ??
          dataSource.current_market_value ??
          rawItem?.market_value ??
          dataSource.value ??
          assetData.value ??
          0
        );
        const liveValue = backendTotalValue || (baseValue + microValue) || purchasePrice || baseValue;
        const normalizedBase = baseValue || purchasePrice || (liveValue - microValue);
        const socialDelta = liveValue - normalizedBase;
        const profitLoss = socialDelta;
        const returnRate = normalizedBase > 0
          ? (profitLoss / normalizedBase) * 100
          : 0;
        const animationUrl = dataSource.animation_url || dataSource.media_url || dataSource.preview_image;
        const audioUrl = dataSource.audio_url || dataSource.audio;
        const tokenId = dataSource.token_id || dataSource.token || assetData.token_id || rawItem?.token_id;
        
        // Créer un item nettoyé
        return {
          ...item,
          id: item.id || `item-${index}-${Date.now()}`,
          // S'assurer que nous avons une propriété 'bom' standardisée
          bom: {
            id: dataSource.id || item.bom_id || index,
            title: dataSource.title || 'Sans titre',
            description: dataSource.description || '',
            artist: dataSource.artist || dataSource.creator_name || 'Artiste inconnu',
            base_value: normalizedBase,
            purchase_price: purchasePrice || normalizedBase,
            social_value: socialDelta,
            current_social_value: microValue || socialDelta,
            total_value: liveValue,
            value: liveValue,
            current_market_value: liveValue,
            profit_loss: profitLoss,
            return_rate: returnRate,
            social_score: safeNumber(dataSource.social_score),
            social_event: dataSource.social_event,
            category: dataSource.category,
            collection_name: dataSource.collection_name || dataSource.collection || 'Non classé',
            edition_type: dataSource.edition_type || 'common',
            preview_image: dataSource.preview_image || dataSource.thumbnail_url || dataSource.image_url || 
                          'https://via.placeholder.com/150/333333/ffffff?text=BOOM',
            animation_url: animationUrl,
            audio_url: audioUrl,
            thumbnail_url: dataSource.thumbnail_url,
            media_url: dataSource.media_url,
            token_id: tokenId,
            acquired_at: item.acquired_at || new Date().toISOString(),
            is_transferable: item.is_transferable !== false,
          },
          lastMarketDelta: 0,
          lastMarketAction: 'init',
          lastMarketUpdate: Date.now()
        } as InventoryNFT;
      });

      console.log('✅ [INVENTORY] Inventaire nettoyé:', {
        items: cleanedInventory.length,
        preview: cleanedInventory.slice(0, 3).map(item => ({
          title: item.bom.title,
          value: item.bom.value,
          collection: item.bom.collection_name
        }))
      });

      setInventory(cleanedInventory);
      setGroupedInventory(groupNFTsIntelligently(cleanedInventory));
      
      // Calculer les totaux
      const { totalVal, avgScore } = calculateTotals(cleanedInventory);
      
      console.timeEnd('📦 [INVENTORY] Temps chargement inventaire');

    } catch (error: any) {
      console.error('❌ [INVENTORY] Erreur chargement:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      
      Alert.alert(
        'Erreur de chargement',
        error.message || 'Impossible de charger votre collection. Vérifiez votre connexion.'
      );
      
      // Réinitialiser les totaux en cas d'erreur
      setTotalValue(0);
      setAverageSocialScore(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const groupNFTsIntelligently = useCallback((items: InventoryNFT[]): GroupedInventory => {
    console.log('📂 [INVENTORY] Groupement des NFTs...');
    
    const byCollection = new Map<string, InventoryNFT[]>();
    const byRarity = new Map<string, InventoryNFT[]>();
    
    items.forEach((item, index) => {
      const bom = item.bom;
      
      // Groupement par collection
      const collection = bom.collection_name || 'Non classé';
      if (!byCollection.has(collection)) {
        byCollection.set(collection, []);
      }
      byCollection.get(collection)!.push(item);
      
      // Groupement par rareté
      const rarity = bom.edition_type || 'common';
      if (!byRarity.has(rarity)) {
        byRarity.set(rarity, []);
      }
      byRarity.get(rarity)!.push(item);
    });
    
    const result: GroupedInventory = {
      byCollection: Object.fromEntries(byCollection),
      byRarity: Object.fromEntries(byRarity),
      stats: {
        collections: byCollection.size,
        rarities: byRarity.size
      }
    };
    
    console.log('✅ [INVENTORY] Groupement terminé:', result.stats);
    return result;
  }, []);

  useEffect(() => {
    const unsubscribe = boomsWebSocket.onUpdate((data: any) => {
      if (data.type !== 'social_update') {
        return;
      }

      setInventory((currentInventory) => {
        let hasChanged = false;
        let updatedSnapshot: InventoryNFT | null = null;

        const updatedInventory = currentInventory.map(item => {
          const bomId = item?.bom?.id || item?.bom_id;
          if (!bomId || bomId !== data.boom_id || !item.bom) {
            return item;
          }

          hasChanged = true;
          const baseValue = safeNumber(item.bom.base_value ?? item.bom.purchase_price ?? 0);
          const microValue = safeNumber(
            data.new_social_value ??
            item.bom.current_social_value ??
            item.bom.social_value ??
            0
          );
          const updatedValue = safeNumber(
            data.new_total_value ??
            data.total_value ??
            item.bom.total_value ??
            (baseValue + microValue)
          );
          const socialDelta = updatedValue - baseValue;
          const profitLoss = socialDelta;
          const returnRate = baseValue > 0 ? (profitLoss / baseValue) * 100 : 0;
          const liveDelta = safeNumber(data.delta ?? 0);
          const liveAction = data.action || item.lastMarketAction;
          const liveTimestamp = Date.now();

          const updatedBom = {
            ...item.bom,
            base_value: baseValue,
            social_value: socialDelta,
            current_social_value: microValue,
            total_value: updatedValue,
            value: updatedValue,
            current_market_value: updatedValue,
            profit_loss: profitLoss,
            return_rate: returnRate,
            social_event: data.social_event ?? item.bom.social_event
          };

          if (typeof data.social_score === 'number') {
            updatedBom.social_score = safeNumber(data.social_score, updatedBom.social_score || 0);
          }

          const updatedItem: InventoryNFT = {
            ...item,
            bom: updatedBom,
            lastMarketDelta: liveDelta,
            lastMarketAction: liveAction,
            lastMarketUpdate: liveTimestamp
          };

          updatedSnapshot = updatedItem;

          return updatedItem;
        });

        if (hasChanged && updatedSnapshot) {
          console.log('📡 [INVENTORY] Mise à jour en temps réel pour:', data.boom_id);
          calculateTotals(updatedInventory);
          setGroupedInventory(groupNFTsIntelligently(updatedInventory));
          setSelectedNFT(prev => {
            if (!prev) return prev;
            const prevId = prev.bom?.id || prev.bom_id;
            return prevId === updatedSnapshot!.bom.id ? { ...updatedSnapshot! } : prev;
          });
          return updatedInventory;
        }

        return currentInventory;
      });
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [calculateTotals, groupNFTsIntelligently]);

  const getBestImageUrl = (bom: any): string => {
    const urls = [
      bom.preview_image,
      bom.thumbnail_url,
      bom.media_url,
      bom.animation_url
    ].filter(url => url && url.startsWith('http'));
    
    return urls[0] || 'https://via.placeholder.com/150/333333/ffffff?text=BOOM';
  };

  const getRarityLabel = (editionType: string): string => {
    const map: Record<string, string> = {
      'legendary': 'Légendaire',
      'ultra_rare': 'Ultra Rare',
      'rare': 'Rare',
      'common': 'Standard',
      'standard': 'Standard'
    };
    return map[editionType] || editionType || 'Standard';
  };

  const getRarityColor = (editionType: string): string => {
    const map: Record<string, string> = {
      'legendary': '#D4AF37',
      'ultra_rare': '#9B59B6',
      'rare': '#3498DB',
      'common': '#95A5A6',
      'standard': '#95A5A6'
    };
    return map[editionType] || '#95A5A6';
  };

  const handleObserveNFT = (item: InventoryNFT) => {
    console.log('👁️ [INVENTORY] Observation NFT:', item.bom.title);
    setSelectedNFT(item);
  };

  const handleSendGift = (item: InventoryNFT) => {
    console.log('🎁 [INVENTORY] Offrir NFT:', item.bom.title);
    navigation.navigate('SendGift', {
      bomId: item.bom.id,
      bomTitle: item.bom.title,
      bomImageUrl: getBestImageUrl(item.bom),
    });
  };

  const getSectionsData = () => {
    console.log(`📋 [INVENTORY] Mode d'affichage: ${viewMode}`);
    
    if (viewMode === 'collection' && groupedInventory.byCollection) {
      return Object.entries(groupedInventory.byCollection)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([title, data]) => ({
          title: `${title} (${(data as InventoryNFT[]).length})`,
          data: data as InventoryNFT[],
          type: 'collection'
        }));
    }
    
    if (viewMode === 'rarity' && groupedInventory.byRarity) {
      const rarityOrder = ['legendary', 'ultra_rare', 'rare', 'common', 'standard'];
      return Object.entries(groupedInventory.byRarity)
        .sort(([a], [b]) => rarityOrder.indexOf(a) - rarityOrder.indexOf(b))
        .map(([title, data]) => ({
          title: `${getRarityLabel(title)} (${(data as InventoryNFT[]).length})`,
          data: data as InventoryNFT[],
          type: 'rarity'
        }));
    }
    
    return [{
      title: `Collection complète (${inventory.length})`,
      data: inventory,
      type: 'list'
    }];
  };

  const renderInventoryItem = ({ item }: { item: InventoryNFT }) => {
    const imageUrl = getBestImageUrl(item.bom);
    const rarityColor = getRarityColor(item.bom.edition_type);
    const rarityLabel = getRarityLabel(item.bom.edition_type);
    const value = safeNumber(item.bom.current_market_value ?? item.bom.value);
    const purchasePrice = safeNumber(item.bom.purchase_price ?? item.bom.base_value);
    const baseValue = purchasePrice > 0 ? purchasePrice : safeNumber(item.bom.base_value);
    const socialValue = safeNumber(item.bom.social_value ?? (value - baseValue));
    const socialScore = safeNumber(item.bom.social_score);
    const profitLoss = value - baseValue;
    const returnRate = baseValue > 0 ? (profitLoss / baseValue) * 100 : 0;
    const marketDelta = safeNumber(item.lastMarketDelta ?? 0);
    const marketColor = marketDelta === 0 ? '#6B7280' : marketDelta > 0 ? '#10B981' : '#EF4444';
    const actionIcon = getActionIcon(item.lastMarketAction || 'update');
    const marketLabel = marketDelta === 0 ? 'Stable' : formatDelta(marketDelta);
    const lastUpdateLabel = item.lastMarketUpdate ? `MAJ ${formatRelativeTime(item.lastMarketUpdate)}` : 'Flux live';
    const marketZoneLabel = profitLoss > 0 ? 'En zone de profit' : profitLoss < 0 ? 'En zone de perte' : "À l'équilibre";
    const marketInsight = `${marketZoneLabel} • ${lastUpdateLabel}`;
    const profitColor = profitLoss === 0 ? '#6B7280' : profitLoss > 0 ? '#10B981' : '#EF4444';
    const signedPnL = formatSignedCurrency(profitLoss);
    const stabilization = getStabilizationSnapshot(item);
    
    return (
      <TouchableOpacity 
        style={styles.inventoryItem}
        activeOpacity={0.9}
        onPress={() => handleObserveNFT(item)}
      >
        <View style={styles.itemImageContainer}>
          <Image 
            source={{ uri: imageUrl }} 
            style={styles.itemImage}
            defaultSource={{ uri: 'https://via.placeholder.com/150/333333/ffffff?text=BOOM' }}
            onError={(e) => console.log('❌ Erreur image:', e.nativeEvent.error)}
          />
          <View style={[styles.rarityBadge, { backgroundColor: rarityColor }]}>
            <Text style={styles.rarityText}>{rarityLabel}</Text>
          </View>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        </View>
        
        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.bom.title}
          </Text>
          
          <Text style={styles.itemArtist} numberOfLines={1}>
            {item.bom.artist}
          </Text>
          
          {item.bom.collection_name && (
            <Text style={styles.itemCollection} numberOfLines={1}>
              {item.bom.collection_name}
            </Text>
          )}
          
          <View style={styles.itemMetrics}>
            <View style={styles.marketValueBlock}>
              <Text style={styles.marketLabel}>Valeur marché</Text>
              <Text style={styles.marketValue}>{formatCurrencyValue(value)}</Text>
            </View>
            <View style={[styles.marketTicker, { borderColor: marketColor }]}>
              <Text style={[styles.marketTickerValue, { color: marketColor }]}>
                {actionIcon} {marketLabel}
              </Text>
              <Text style={styles.marketTickerMeta}>{lastUpdateLabel}</Text>
            </View>
          </View>

          <View style={styles.marketSplit}>
            <View style={styles.marketSplitItem}>
              <Text style={styles.marketSplitLabel}>Prix d'achat</Text>
              <Text style={styles.marketSplitValue}>{formatCurrencyValue(baseValue)}</Text>
            </View>
            <View style={styles.marketSplitItem}>
              <Text style={styles.marketSplitLabel}>Profit / Pertes</Text>
              <Text style={[styles.marketSplitValue, { color: profitColor }]}>{signedPnL}</Text>
              <Text style={[styles.returnBadge, profitLoss > 0 ? styles.returnPositive : profitLoss < 0 ? styles.returnNegative : styles.returnNeutral]}>
                {returnRate.toFixed(2)}%
              </Text>
            </View>
          </View>

          <Text style={styles.marketInsight}>
            {marketInsight}
          </Text>

          <View style={styles.capShieldCard}>
            <View style={styles.capShieldHeader}>
              <Text style={styles.capShieldTitle}>Bouclier de capitalisation</Text>
              <Text style={styles.capShieldValue}>{formatCompactCurrency(stabilization.marketCap)}</Text>
            </View>
            <View style={styles.capShieldBar}>
              <View
                style={[
                  styles.capShieldProgress,
                  { width: `${Math.max(4, Math.min(100, stabilization.capProgress * 100))}%` }
                ]}
              />
            </View>
            <Text style={styles.capShieldHint}>
              {stabilization.capProgress >= 1
                ? 'Palier atteint : influence micro verrouillée'
                : `Prochain palier : ${formatCompactCurrency(stabilization.nextMilestone)}`}
            </Text>
            {stabilization.redistributionPool > 0 && (
              <Text style={styles.capShieldSub}>
                Redistribution dispo : {formatCompactCurrency(stabilization.redistributionPool)}
              </Text>
            )}
            <Text style={styles.capShieldMicro}>
              {describeMicroInfluence(stabilization.capUnits)}
            </Text>
          </View>
          
          {socialScore > 0 && (
            <View style={styles.socialScore}>
              <Text style={styles.socialScoreText}>
                {socialScore.toFixed(1)} ⭐
              </Text>
            </View>
          )}
          
          {item.bom.social_event && (
            <View style={styles.socialEventBadge}>
              <Text style={styles.socialEventText}>
                {item.bom.social_event === 'viral' ? '🔥 Viral' : 
                 item.bom.social_event === 'trending' ? '📈 Trending' : 
                 '🆕 Nouveau'}
              </Text>
            </View>
          )}
          
          <View style={styles.itemActions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleObserveNFT(item)}
            >
              <Text style={styles.actionButtonText}>Détails</Text>
            </TouchableOpacity>
            
            {item.bom.is_transferable !== false && (
              <TouchableOpacity
                style={[styles.actionButton, styles.giftButton]}
                onPress={() => handleSendGift(item)}
              >
                <Text style={styles.actionButtonText}>Offrir</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSectionHeader = ({ section }: { section: any }) => {
    const isExpanded = expandedSections.has(section.title);
    
    return (
      <TouchableOpacity 
        style={styles.sectionHeader}
        onPress={() => {
          const newExpanded = new Set(expandedSections);
          if (isExpanded) {
            newExpanded.delete(section.title);
          } else {
            newExpanded.add(section.title);
          }
          setExpandedSections(newExpanded);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderContent}>
          <Text style={styles.sectionTitle}>
            {isExpanded ? '▼' : '▶'} {section.title}
          </Text>
          <Text style={styles.sectionSubtitle}>
            {section.data.length} œuvre{section.data.length > 1 ? 's' : ''}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderObservationModal = () => {
    if (!selectedNFT) return null;
    
    const rarityColor = getRarityColor(selectedNFT.bom.edition_type);
    const value = safeNumber(selectedNFT.bom.current_market_value ?? selectedNFT.bom.value);
    const purchasePrice = safeNumber(selectedNFT.bom.purchase_price ?? selectedNFT.bom.base_value);
    const baseValue = purchasePrice > 0 ? purchasePrice : safeNumber(selectedNFT.bom.base_value);
    const socialValue = safeNumber(selectedNFT.bom.social_value ?? (value - baseValue));
    const socialScore = safeNumber(selectedNFT.bom.social_score);
    const marketDelta = safeNumber(selectedNFT.lastMarketDelta ?? 0);
    const marketColor = marketDelta === 0 ? '#111827' : marketDelta > 0 ? '#10B981' : '#EF4444';
    const actionIcon = getActionIcon(selectedNFT.lastMarketAction || 'update');
    const marketLabel = marketDelta === 0 ? 'Stable' : formatDelta(marketDelta);
    const marketAction = getMarketActionLabel(selectedNFT.lastMarketAction);
    const marketUpdate = formatRelativeTime(selectedNFT.lastMarketUpdate);
    const animationSource = selectedNFT.bom.animation_url || selectedNFT.bom.media_url || getBestImageUrl(selectedNFT.bom);
    const tokenId = selectedNFT.bom.token_id?.toString();
    const profitLoss = value - baseValue;
    const returnRate = baseValue > 0 ? (profitLoss / baseValue) * 100 : 0;
    const profitColor = profitLoss === 0 ? '#6B7280' : profitLoss > 0 ? '#10B981' : '#EF4444';
    const signedPnL = formatSignedCurrency(profitLoss);
    const stabilization = getStabilizationSnapshot(selectedNFT);
    
    return (
      <Modal
        visible={!!selectedNFT}
        animationType="slide"
        onRequestClose={() => setSelectedNFT(null)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setSelectedNFT(null)}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Détails de l'œuvre</Text>
            <View style={{ width: 40 }} />
          </View>
          
          <ScrollView 
            style={styles.modalContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.modalAnimationContainer}>
              <View style={styles.modalAnimationFrame}>
                <NFTAnimationPlayer
                  animationUrl={animationSource}
                  previewImage={getBestImageUrl(selectedNFT.bom)}
                  audioUrl={selectedNFT.bom.audio_url}
                  style={styles.modalAnimation}
                  autoPlay
                  showControls
                  loop
                  tokenId={tokenId}
                  showNFTBadge={false}
                  showTypeIndicator={false}
                />
              </View>
            </View>
            
            <View style={styles.modalInfo}>
              <View style={styles.modalHeaderRow}>
                <View style={styles.titleContainer}>
                  <Text style={styles.modalNFTTitle}>{selectedNFT.bom.title}</Text>
                  <Text style={styles.modalNFTArtist}>{selectedNFT.bom.artist}</Text>
                </View>
                <View style={[styles.modalRarityBadge, { backgroundColor: rarityColor }]}>
                  <Text style={styles.modalRarityText}>
                    {getRarityLabel(selectedNFT.bom.edition_type)}
                  </Text>
                </View>
              </View>
              
              {selectedNFT.bom.description && (
                <View style={styles.descriptionContainer}>
                  <Text style={styles.descriptionLabel}>Description</Text>
                  <Text style={styles.modalDescription}>
                    {selectedNFT.bom.description}
                  </Text>
                </View>
              )}
              
              <View style={styles.modalStatsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Valeur actuelle</Text>
                  <Text style={styles.statValue}>
                    {formatCurrencyValue(value)}
                  </Text>
                </View>

                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Prix d'achat</Text>
                  <Text style={styles.statValue}>
                    {formatCurrencyValue(baseValue)}
                  </Text>
                </View>

                <View style={[styles.statCard, styles.statCardWide]}>
                  <Text style={styles.statLabel}>Profit / Pertes</Text>
                  <Text style={[styles.statValue, { color: profitColor }]}>
                    {signedPnL}
                  </Text>
                  <Text style={[styles.statSubValue, { color: profitColor }]}>
                    ROI {returnRate.toFixed(2)}%
                  </Text>
                </View>

                {socialValue !== 0 && (
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Valeur sociale</Text>
                    <Text style={[
                      styles.statValue,
                      socialValue >= 0 ? styles.socialValue : styles.socialValueLoss
                    ]}>
                      {formatCurrencyValue(socialValue)}
                    </Text>
                  </View>
                )}
                
                {socialScore > 0 && (
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Score social</Text>
                    <Text style={[styles.statValue, styles.socialScoreValue]}>
                      {socialScore.toFixed(1)} ⭐
                    </Text>
                  </View>
                )}
                
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Collection</Text>
                  <Text style={styles.statValue}>
                    {selectedNFT.bom.collection_name || 'Général'}
                  </Text>
                </View>
                
                {selectedNFT.bom.category && (
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Catégorie</Text>
                    <Text style={styles.statValue}>
                      {selectedNFT.bom.category}
                    </Text>
                  </View>
                )}
                
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Acquis le</Text>
                  <Text style={styles.statValue}>
                    {new Date(selectedNFT.acquired_at).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </Text>
                </View>
              </View>

              <View style={styles.modalStabilizationCard}>
                <View style={styles.modalStabilizationHeader}>
                  <Text style={styles.modalStabilizationTitle}>Bouclier de capitalisation</Text>
                  <Text style={styles.modalStabilizationValue}>
                    {formatCompactCurrency(stabilization.marketCap)}
                  </Text>
                </View>
                <View style={styles.modalStabilizationBar}>
                  <View
                    style={[
                      styles.modalStabilizationProgress,
                      { width: `${Math.max(4, Math.min(100, stabilization.capProgress * 100))}%` }
                    ]}
                  />
                </View>
                <Text style={styles.modalStabilizationHint}>
                  {stabilization.capProgress >= 1
                    ? 'Palier atteint : besoin massif pour influencer le prix'
                    : `Prochain palier : ${formatCompactCurrency(stabilization.nextMilestone)}`}
                </Text>
                {stabilization.redistributionPool > 0 && (
                  <Text style={styles.modalStabilizationHint}>
                    Redistribution prête : {formatCompactCurrency(stabilization.redistributionPool)}
                  </Text>
                )}
                <Text style={styles.modalStabilizationMicro}>
                  {describeMicroInfluence(stabilization.capUnits)}
                </Text>
              </View>
              
              <View style={styles.modalMarketCard}>
                <View style={styles.marketInsightHeader}>
                  <Text style={styles.marketInsightTitle}>Suivi marché</Text>
                </View>
                <Text style={[styles.modalMarketAmount, { color: marketColor }]}>
                  {actionIcon} {marketLabel}
                </Text>
                <Text style={styles.modalMarketAction}>{marketAction}</Text>
                <Text style={styles.modalMarketMeta}>Dernière mise à jour {marketUpdate}</Text>
              </View>

              {selectedNFT.bom.social_event && (
                <View style={styles.socialInfo}>
                  <Text style={styles.socialInfoTitle}>
                    {selectedNFT.bom.social_event === 'viral' ? '🔥 En tendance virale' :
                     selectedNFT.bom.social_event === 'trending' ? '📈 En croissance' :
                     '🆕 Nouvelle acquisition'}
                  </Text>
                  <Text style={styles.socialInfoText}>
                    {selectedNFT.bom.social_event === 'viral' ? 
                      'Cette œuvre connaît un engouement exceptionnel' :
                      selectedNFT.bom.social_event === 'trending' ?
                      'Popularité en hausse constante' :
                      'Récemment ajoutée à votre collection'}
                  </Text>
                </View>
              )}
              
              <View style={styles.modalActions}>
                {selectedNFT.bom.is_transferable !== false && (
                  <TouchableOpacity
                    style={[styles.modalActionButton, styles.modalGiftButton]}
                    onPress={() => {
                      setSelectedNFT(null);
                      setTimeout(() => handleSendGift(selectedNFT), 300);
                    }}
                  >
                    <Text style={styles.modalActionText}>🎁 Offrir cette œuvre</Text>
                  </TouchableOpacity>
                )}
                
                <TouchableOpacity
                  style={[styles.modalActionButton, styles.modalCloseButton]}
                  onPress={() => setSelectedNFT(null)}
                >
                  <Text style={[styles.modalActionText, styles.modalCloseText]}>Fermer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Chargement de votre collection...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sections = getSectionsData();
  const pnlLabel = formatSignedCurrency(portfolioPnL);
  const pnlColor = portfolioPnL === 0 ? '#374151' : portfolioPnL > 0 ? '#047857' : '#B91C1C';
  const investedLabel = formatCurrencyValue(totalInvested);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* En-tête */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>Collection personnelle</Text>
          </View>
          
          <Text style={styles.subtitle}>
            {inventory.length} œuvre{inventory.length > 1 ? 's' : ''} •
            Investi: {investedLabel} •
            Valeur totale: {formatCurrencyValue(totalValue)} •
            Score moyen: {averageSocialScore.toFixed(2)} •{' '}
            <Text style={[styles.subtitle, { color: pnlColor }]}>P&L: {pnlLabel}</Text>
          </Text>
          
          <View style={styles.viewModeSelector}>
            {['list', 'collection', 'rarity'].map((mode) => (
              <TouchableOpacity 
                key={mode}
                style={[
                  styles.viewModeButton, 
                  viewMode === mode && styles.viewModeButtonActive
                ]}
                onPress={() => setViewMode(mode as any)}
              >
                <Text style={[
                  styles.viewModeText, 
                  viewMode === mode && styles.viewModeTextActive
                ]}>
                  {mode === 'list' ? 'Liste' : 
                   mode === 'collection' ? 'Collections' : 
                   'Rareté'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Contenu principal */}
        {inventory.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Collection vide</Text>
            <Text style={styles.emptyText}>
              Commencez votre collection en explorant la galerie d'œuvres disponibles.
            </Text>
            <TouchableOpacity 
              style={styles.browseButton}
              onPress={() => navigation.navigate('Catalogue')}
            >
              <Text style={styles.browseButtonText}>🖼️ Explorer la galerie</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id?.toString() || Math.random().toString()}
            renderItem={({ item }) => {
              const isExpanded = expandedSections.has(sections.find(s => s.data.includes(item))?.title || '');
              if (expandedSections.size > 0 && !isExpanded) return null;
              return renderInventoryItem({ item });
            }}
            renderSectionHeader={renderSectionHeader}
            refreshControl={
              <RefreshControl 
                refreshing={refreshing} 
                onRefresh={() => {
                  setRefreshing(true);
                  loadInventory();
                }}
                colors={['#10B981']}
                tintColor="#10B981"
              />
            }
            stickySectionHeadersEnabled={true}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={<View style={styles.listFooter} />}
          />
        )}

        {/* Modal d'observation */}
        {renderObservationModal()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  header: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    paddingTop: 50,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  subtitle: {
    fontSize: 15,
    color: '#666666',
    marginBottom: 20,
  },
  viewModeSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  viewModeButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
    flex: 1,
  },
  viewModeButtonActive: {
    backgroundColor: '#10B981',
  },
  viewModeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    textAlign: 'center',
  },
  viewModeTextActive: {
    color: '#FFFFFF',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  browseButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    backgroundColor: '#10B981',
    borderRadius: 12,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  browseButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  listFooter: {
    height: 20,
  },
  inventoryItem: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  itemImageContainer: {
    position: 'relative',
    marginRight: 16,
  },
  itemImage: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    bottom: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    borderRadius: 20,
  },
  liveBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  rarityBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  rarityText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  itemInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  itemTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  itemArtist: {
    fontSize: 14,
    color: '#10B981',
    marginBottom: 4,
    fontWeight: '500',
  },
  itemCollection: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 8,
  },
  itemMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  marketValueBlock: {
    flex: 1,
  },
  marketLabel: {
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  marketValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  marketTicker: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'flex-end',
    minWidth: 130,
  },
  marketTickerValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  marketTickerMeta: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  marketSplit: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 16,
  },
  marketSplitItem: {
    flex: 1,
    alignItems: 'flex-start',
  },
  marketSplitLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  marketSplitValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  returnBadge: {
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#E5E7EB',
    color: '#374151',
  },
  returnPositive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#047857',
  },
  returnNegative: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#B91C1C',
  },
  returnNeutral: {
    backgroundColor: '#E5E7EB',
    color: '#374151',
  },
  marketInsight: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 10,
  },
  capShieldCard: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  capShieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  capShieldTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#312E81',
  },
  capShieldValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338CA',
  },
  capShieldBar: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#E0E7FF',
    overflow: 'hidden',
    marginBottom: 8,
  },
  capShieldProgress: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#4C1D95',
  },
  capShieldHint: {
    fontSize: 11,
    color: '#4338CA',
    marginBottom: 2,
  },
  capShieldSub: {
    fontSize: 11,
    color: '#1E40AF',
    marginBottom: 2,
  },
  capShieldMicro: {
    fontSize: 11,
    color: '#312E81',
    fontStyle: 'italic',
  },
  socialScore: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FFF3CD',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFEAA7',
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  socialScoreText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '600',
  },
  socialEventBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#D1ECF1',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BEE5EB',
    marginBottom: 12,
  },
  socialEventText: {
    fontSize: 12,
    color: '#0C5460',
    fontWeight: '600',
  },
  itemActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#10B981',
    flex: 1,
  },
  giftButton: {
    backgroundColor: '#FFC107',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  sectionHeader: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeaderContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666666',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 20,
    color: '#666666',
    fontWeight: '500',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  modalContent: {
    flex: 1,
  },
  modalAnimationContainer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    position: 'relative',
    alignItems: 'center',
  },
  modalAnimationFrame: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 4,
    borderColor: '#0F172A',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  modalAnimation: {
    width: '100%',
    height: '100%',
  },
  modalInfo: {
    padding: 20,
    backgroundColor: '#FFFFFF',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  titleContainer: {
    flex: 1,
    marginRight: 12,
  },
  modalNFTTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  modalNFTArtist: {
    fontSize: 16,
    color: '#10B981',
    fontWeight: '500',
  },
  modalRarityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  modalRarityText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  descriptionContainer: {
    marginBottom: 24,
  },
  descriptionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 15,
    color: '#666666',
    lineHeight: 22,
  },
  modalStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  modalStabilizationCard: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    padding: 16,
    marginBottom: 24,
  },
  modalStabilizationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalStabilizationTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#312E81',
  },
  modalStabilizationValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4338CA',
  },
  modalStabilizationBar: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E0E7FF',
    overflow: 'hidden',
    marginBottom: 8,
  },
  modalStabilizationProgress: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#4C1D95',
  },
  modalStabilizationHint: {
    fontSize: 12,
    color: '#4338CA',
    marginBottom: 4,
  },
  modalStabilizationMicro: {
    fontSize: 12,
    color: '#312E81',
    fontStyle: 'italic',
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  statCardWide: {
    flexBasis: '100%',
    minWidth: '100%'
  },
  statLabel: {
    fontSize: 13,
    color: '#6C757D',
    marginBottom: 8,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  statSubValue: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '600',
  },
  socialValue: {
    color: '#28A745',
  },
  socialValueLoss: {
    color: '#EF4444',
  },
  socialScoreValue: {
    color: '#FFC107',
  },
  socialInfo: {
    padding: 20,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C8E6C9',
    marginBottom: 24,
  },
  modalMarketCard: {
    padding: 20,
    backgroundColor: '#F0FDF4',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    marginBottom: 24,
  },
  marketInsightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  marketInsightTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#14532D',
  },
  modalMarketAmount: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 4,
  },
  modalMarketAction: {
    fontSize: 14,
    color: '#065F46',
    marginBottom: 4,
  },
  modalMarketMeta: {
    fontSize: 12,
    color: '#047857',
  },
  socialInfoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2E7D32',
    marginBottom: 8,
  },
  socialInfoText: {
    fontSize: 15,
    color: '#388E3C',
    lineHeight: 20,
  },
  modalActions: {
    gap: 12,
  },
  modalActionButton: {
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalGiftButton: {
    backgroundColor: '#10B981',
  },
  modalCloseButton: {
    backgroundColor: '#F5F5F5',
  },
  modalActionText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalCloseText: {
    color: '#666666',
  },
});
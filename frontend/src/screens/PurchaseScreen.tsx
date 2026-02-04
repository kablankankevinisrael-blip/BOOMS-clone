import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  Animated,
  Dimensions,
  SafeAreaView
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { marketService, MarketTradeResponse } from '../services/market';
import { purchaseService, InventoryItem } from '../services/purchase';
import { LinearGradient } from 'expo-linear-gradient';
import { useWallet } from '../contexts/WalletContext';
import {
  CAPITALIZATION_CONSTANTS,
  computeCapProgress,
  formatCompactCurrency,
  getNextMilestone
} from '../utils/stabilization';

const { width } = Dimensions.get('window');
const {
  FLOOR: CAPITALIZATION_FLOOR,
  CEIL: CAPITALIZATION_CEIL,
  SPREAD: CAPITALIZATION_SPREAD,
  PALIER_THRESHOLD,
  MICRO_IMPACT_RATE
} = CAPITALIZATION_CONSTANTS;
const PLATFORM_FEE_RATE = 0.05;
const PALIER_THRESHOLD_LABEL = formatCompactCurrency(PALIER_THRESHOLD);
const MICRO_IMPACT_RATE_PERCENT = (MICRO_IMPACT_RATE * 100).toFixed(2);

interface TradingData {
  currentValue: number;
  priceChange24h: number;
  volume24h: number;
  volatility: number;
  buyPrice: number;
  sellPrice: number;
  socialScore: number;
  uniqueHolders: number;
  totalShares: number;
  marketCap?: number;
  effectiveCap?: number;
  redistributionPool?: number;
  capProgress?: number;
  stabilizationMultiplier?: number;
  nextMilestone?: number;
}

export default function PurchaseScreen({ route, navigation }: any) {
  const { bom } = route.params;
  const { user } = useAuth();
  
  // ✅ MISE À JOUR DU CONTEXTE - RÉCUPÉRATION DES VARIABLES RENOMMÉES
  const { 
    cashBalance,           // ✅ AJOUT: cashBalance pour vérification directe
    usableBalance,         // Solde réel utilisable (cashBalance - locked si nécessaire)
    hasSufficientFunds,    // Méthode de vérification
    applyRealtimeCashBalance,
    requestBackendSync
  } = useWallet();
  
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [tradingData, setTradingData] = useState<TradingData | null>(null);
  const [priceAnimation] = useState(new Animated.Value(1));
  const [selectedTab, setSelectedTab] = useState<'details' | 'performance' | 'purchase'>('purchase');
  
  // États pour la possession et l'inventaire
  const [userOwnsBom, setUserOwnsBom] = useState(false);
  const [userBomId, setUserBomId] = useState<number | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryCount, setInventoryCount] = useState(0);
  
  // ✅ NOUVEAU: États pour les devis
  const [buyQuote, setBuyQuote] = useState<any>(null);
  const [sellQuote, setSellQuote] = useState<any>(null);

  const feePercents = useMemo(() => {
    if (!tradingData || !tradingData.currentValue || tradingData.currentValue <= 0) {
      const fallback = PLATFORM_FEE_RATE * 100;
      return { buy: fallback, sell: fallback };
    }
    const base = tradingData.currentValue;
    const buy = ((tradingData.buyPrice - base) / base) * 100;
    const sell = ((base - tradingData.sellPrice) / base) * 100;
    const fallback = PLATFORM_FEE_RATE * 100;
    return {
      buy: Number.isFinite(buy) ? Math.max(0, buy) : fallback,
      sell: Number.isFinite(sell) ? Math.max(0, sell) : fallback
    };
  }, [tradingData]);

  const extractNumber = (value: any): number | null => {
    if (typeof value === 'number' && !Number.isNaN(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  const formatCurrencyWithDecimals = (value: number): string => {
    return parseFloat(value.toFixed(4)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  const resolveRealBalanceFromFinancials = (financial: MarketTradeResponse['financial'] | undefined): number | null => {
    if (!financial) return null;
    const candidates = [
      financial.new_cash_balance,
      financial.new_wallet_balance,
      (financial as any)?.new_real_balance,
      (financial as any)?.real_balance_after,
      (financial as any)?.real_balance,
      (financial as any)?.cash_included,
      (financial as any)?.balances?.real_balance,
      (financial as any)?.real_balance_after_sale
    ];

    for (const candidate of candidates) {
      const numeric = extractNumber(candidate);
      if (numeric !== null) {
        return numeric;
      }
    }

    return null;
  };

  useEffect(() => {
    loadData();
    startPriceUpdates();
    return () => {
      // Cleanup
    };
  }, []);

  useEffect(() => {
    // Recharger les devis quand quantity change
    if (bom.id && tradingData) {
      loadQuotes();
    }
  }, [quantity, bom.id, tradingData, userOwnsBom]);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Charger l'inventaire utilisateur pour vérifier la possession
      await loadUserInventory();
      
      // 2. Charger les données de trading
      await loadTradingData();
      
      // 3. Charger les devis
      await loadQuotes();
      
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Erreur', 'Impossible de charger les données');
    } finally {
      setLoading(false);
    }
  };

  const loadUserInventory = async (forceRefresh: boolean = false) => {
    try {
      console.log('🔍 Chargement inventaire utilisateur...', forceRefresh ? '(force)' : '');
      const userInventory = await purchaseService.getInventory(forceRefresh);
      setInventory(userInventory);
      
      // Compter combien d'exemplaires l'utilisateur possède
      const ownedItems = userInventory.filter(item => 
        item.bom_id === bom.id || 
        (item.bom_asset && item.bom_asset.id === bom.id)
      );
      
      setInventoryCount(ownedItems.length);
      
      if (ownedItems.length > 0) {
        setUserOwnsBom(true);
        setUserBomId(ownedItems[0].id); // Prendre le premier pour la vente
        console.log(`✅ Utilisateur possède ${ownedItems.length} exemplaire(s) du Boom ${bom.id}`);
      } else {
        setUserOwnsBom(false);
        setUserBomId(null);
        console.log(`❌ Utilisateur ne possède pas le Boom ${bom.id}`);
      }
      
    } catch (error) {
      console.error('Error loading inventory:', error);
      setUserOwnsBom(false);
      setInventoryCount(0);
    }
  };

  const loadTradingData = async () => {
    try {
      // ✅ CORRECTION: Récupérer les données réelles du marché
      let marketData;
      try {
        marketData = await marketService.getBoomMarketData(bom.id);
      } catch (error) {
        console.log('Utilisation des données mockées (fallback)');
        marketData = null;
      }
      
      if (marketData && marketData.success !== false) {
        const basePrice = extractNumber(marketData?.prices?.base) ?? extractNumber(bom.base_price) ?? bom.purchase_price ?? 0;
        const liveValue = extractNumber(marketData?.prices?.current ?? marketData?.current_social_value) ?? basePrice;
        const volume24h = extractNumber(marketData?.volume_24h) ?? extractNumber(marketData?.market_stats?.total_volume_24h) ?? 0;
        const volatility = extractNumber(marketData?.volatility) ?? extractNumber(marketData?.market_stats?.volatility) ?? 1.8;
        const fallbackReference = bom.purchase_price || 7300;
        const buyPrice = extractNumber(marketData?.buy_price ?? marketData?.prices?.buy) ?? (fallbackReference * (1 + PLATFORM_FEE_RATE));
        const sellPrice = extractNumber(marketData?.sell_price ?? marketData?.prices?.sell) ?? (fallbackReference * (1 - PLATFORM_FEE_RATE));
        const socialScore = extractNumber(marketData?.social_score) ?? 1.2;
        const uniqueHolders = extractNumber(marketData?.unique_holders) ?? bom.unique_holders_count ?? 1;
        const totalShares = extractNumber(marketData?.total_shares) ?? bom.total_shares ?? 0;
        const marketCap = extractNumber(marketData?.market_capitalization) ?? extractNumber(marketData?.social_metrics?.market_capitalization) ?? extractNumber((bom as any)?.social_metrics?.market_capitalization) ?? 0;
        const effectiveCap = extractNumber(marketData?.effective_capitalization) ?? marketCap;
        const redistributionPool = extractNumber(marketData?.redistribution_pool) ?? extractNumber((bom as any)?.social_metrics?.redistribution_pool) ?? 0;
        const capProgress = computeCapProgress(effectiveCap);
        const stabilizationMultiplier = basePrice > 0 ? liveValue / basePrice : 1;
        const nextMilestone = getNextMilestone(capProgress);

        const enrichedTradingData: TradingData = {
          currentValue: liveValue,
          priceChange24h: marketData.price_change_24h || 2.5,
          volume24h: volume24h || 1250000,
          volatility,
          buyPrice,
          sellPrice,
          socialScore,
          uniqueHolders,
          totalShares,
          marketCap,
          effectiveCap,
          redistributionPool,
          capProgress,
          stabilizationMultiplier,
          nextMilestone
        };
        setTradingData(enrichedTradingData);
      } else {
        // Fallback: Simuler des données de trading
        const mockTradingData: TradingData = {
          currentValue: bom.value || bom.purchase_price || 7300,
          priceChange24h: 2.5,
          volume24h: 1250000,
          volatility: 1.8,
          buyPrice: (bom.purchase_price || 7300) * 1.02,
          sellPrice: (bom.purchase_price || 7300) * 0.98,
          socialScore: 1.2,
          uniqueHolders: bom.unique_holders_count || 1,
          totalShares: bom.total_shares || 0,
          marketCap: 0,
          effectiveCap: 0,
          redistributionPool: 0,
          capProgress: 0,
          stabilizationMultiplier: 1,
          nextMilestone: getNextMilestone(0)
        };
        setTradingData(mockTradingData);
      }
      
    } catch (error) {
      console.error('Error loading trading data:', error);
      // Fallback minimal
      setTradingData({
        currentValue: bom.purchase_price || 7300,
        priceChange24h: 0,
        volume24h: 0,
        volatility: 0,
        buyPrice: (bom.purchase_price || 7300) * 1.02,
        sellPrice: (bom.purchase_price || 7300) * 0.98,
        socialScore: 1.0,
        uniqueHolders: 1,
        totalShares: 0
      });
    }
  };

  const loadQuotes = async () => {
    try {
      if (!bom.id) return;
      
      // Charger le devis d'achat
      const buyQuoteData = await marketService.getBuyQuote(bom.id, quantity);
      setBuyQuote(buyQuoteData);
      
      // Charger le devis de vente seulement si possédé
      if (userOwnsBom && userBomId) {
        const sellQuoteData = await marketService.getSellQuote(bom.id);
        setSellQuote(sellQuoteData);
      } else {
        setSellQuote(null);
      }
      
    } catch (error) {
      console.error('Error loading quotes:', error);
      setBuyQuote(null);
      setSellQuote(null);
    }
  };

  const startPriceUpdates = () => {
    // Simulation de mise à jour du prix
    const interval = setInterval(() => {
      if (tradingData) {
        const randomChange = (Math.random() - 0.5) * 0.5; // ±0.25%
        const newValue = tradingData.currentValue * (1 + randomChange / 100);
        
        setTradingData(prev => prev ? {
          ...prev,
          currentValue: newValue,
          priceChange24h: prev.priceChange24h + randomChange
        } : null);
        
        if (randomChange > 0) {
          animatePriceUp();
        } else if (randomChange < 0) {
          animatePriceDown();
        }
      }
    }, 10000); // Toutes les 10 secondes
    
    return () => clearInterval(interval);
  };

  const animatePriceUp = () => {
    Animated.sequence([
      Animated.timing(priceAnimation, {
        toValue: 1.05,
        duration: 200,
        useNativeDriver: true
      }),
      Animated.timing(priceAnimation, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true
      })
    ]).start();
  };

  const animatePriceDown = () => {
    Animated.sequence([
      Animated.timing(priceAnimation, {
        toValue: 0.95,
        duration: 200,
        useNativeDriver: true
      }),
      Animated.timing(priceAnimation, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true
      })
    ]).start();
  };

  const handlePurchase = async () => {
    if (!tradingData || !user) return;
    
    const totalCost = tradingData.buyPrice * quantity;
    const fees = totalCost - (tradingData.currentValue * quantity);
    
    // ✅ CORRECTION: Utiliser usableBalance au lieu de cashBalance pour l'alignement
    if (!usableBalance || usableBalance < totalCost) {
      Alert.alert(
        '❌ Solde insuffisant',
        `Total requis: ${formatCurrencyWithDecimals(totalCost)} FCFA\n` +
        `Votre solde réel disponible: ${usableBalance ? formatCurrencyWithDecimals(usableBalance) : '0'} FCFA\n\n` +
        `Il vous manque ${(totalCost - (usableBalance || 0)).toLocaleString()} FCFA\n\n` +
        `💡 Seul l'argent réel peut être utilisé pour les achats.`,
        [
          { text: 'Modifier quantité', style: 'cancel' },
          { 
            text: 'Recharger mon solde', 
            onPress: () => navigation.navigate('Deposit')
          }
        ]
      );
      return;
    }
    
    setProcessing(true);
    
    try {
      console.log('🛒 Lancement achat avec solde réel...');
      
      // ✅ CORRECTION: Utiliser purchaseService au lieu de marketService
      const buyRequest = {
        bom_id: bom.id,
        quantity: quantity
      };
      
      const response = await purchaseService.purchaseBom(buyRequest);
      
      // 🔥 CORRECTION: Synchronisation IMMÉDIATE après achat
      if (response.financial?.new_wallet_balance !== undefined) {
        console.log('💰 Mise à jour cashBalance après achat:', response.financial.new_wallet_balance);
      }

      const backendCashAfterPurchase = resolveRealBalanceFromFinancials(response.financial);
      if (backendCashAfterPurchase !== null) {
        applyRealtimeCashBalance(backendCashAfterPurchase, 'purchase');
      }
      const purchaseDisplayCash = backendCashAfterPurchase ?? extractNumber(response.financial?.new_wallet_balance) ?? 0;

      // ✅ Synchroniser le contexte wallet pour propager le nouveau solde
      try {
        await requestBackendSync('purchase-complete');
        console.log('🔄 WalletContext synchronisé (fallback) après achat');
      } catch (syncError) {
        console.warn('⚠️ Impossible de déclencher la resync WalletContext:', syncError);
      }

      // ✅ Forcer la récupération inventaire à jour pour l'écran courant
      await loadUserInventory(true);
      
      // SUCCÈS - Achat effectué
      Alert.alert(
        '🎉 Achat confirmé',
        `Vous avez acquis ${quantity} exemplaire(s) de "${bom.title}"\n\n` +
        `💸 Montant débité: ${totalCost.toLocaleString()} FCFA\n` +
        `Frais inclus: ${fees.toLocaleString()} FCFA\n\n` +
        // ✅ CORRECTION: Utiliser EXCLUSIVEMENT la valeur backend, pas de calcul local
        `✅ Nouveau solde réel: ${purchaseDisplayCash.toLocaleString()} FCFA\n\n` +
        `L'œuvre a été ajoutée à votre collection.`,
        [
          { 
            text: 'Voir ma collection', 
            onPress: () => navigation.navigate('Inventory')
          },
          {
            text: 'Continuer',
            onPress: () => {
              setProcessing(false);
            }
          }
        ]
      );
      
    } catch (error: any) {
      console.error('❌ Erreur achat:', error);
      Alert.alert(
        'Erreur d\'achat',
        error.response?.data?.detail || error.message || 'L\'achat n\'a pas pu être effectué'
      );
      setProcessing(false);
    }
  };

  const handleSell = async () => {
    // 🔒 BLOQUER DOUBLE CLIC
    if (processing) {
      console.log('⛔ Vente déjà en cours, action ignorée');
      return;
    }
    
    setProcessing(true);
    
    if (!tradingData || !userBomId) {
      setProcessing(false);
      return;
    }
    
    // ✅ CORRECTION: Vérifier la quantité disponible
    if (quantity > inventoryCount) {
      Alert.alert(
        'Quantité insuffisante',
        `Vous ne possédez que ${inventoryCount} exemplaire(s) de cette œuvre.\n\n` +
        `Vous essayez d'en vendre ${quantity}.`,
        [
          { 
            text: 'Ajuster', 
            onPress: () => setQuantity(inventoryCount)
          },
          { text: 'Annuler', style: 'cancel' }
        ]
      );
      setProcessing(false);
      return;
    }

    // Vérification finale de possession
    const ownedItems = inventory.filter(item => 
      item.bom_id === bom.id || 
      (item.bom_asset && item.bom_asset.id === bom.id)
    );
    const sellTargets = ownedItems.slice(0, quantity);

    const sellPrice = tradingData.sellPrice * sellTargets.length;
    
    if (sellTargets.length === 0) {
      Alert.alert(
        'Non disponible',
        'Vous ne possédez plus cette œuvre.\n\n' +
        'Vous devez l\'acquérir avant de pouvoir la céder.',
        [
          { text: 'Acquérir', onPress: () => setSelectedTab('purchase') },
          { text: 'Annuler', style: 'cancel' }
        ]
      );
      setProcessing(false);
      return;
    }

    console.log('📤 Lancement vente → UserBom IDs:', sellTargets.map(item => item.id));
    
    try {
      const sellResponses: MarketTradeResponse[] = [];
      for (const target of sellTargets) {
        const response = await marketService.executeSell({ user_bom_id: target.id });
        sellResponses.push(response);

        const backendCashAfterSale = resolveRealBalanceFromFinancials(response.financial);
        if (backendCashAfterSale !== null) {
          applyRealtimeCashBalance(backendCashAfterSale, 'sell');
        }
      }

      const lastResponse = sellResponses[sellResponses.length - 1];
      const backendCashAfterSale = resolveRealBalanceFromFinancials(lastResponse.financial);
      const saleDisplayCash = backendCashAfterSale ?? extractNumber(lastResponse.financial?.new_cash_balance) ?? (cashBalance + sellPrice);

      // ✅ Synchroniser immédiatement l'état wallet côté frontend
      try {
        await requestBackendSync('sell-complete');
        console.log('🔄 WalletContext synchronisé (fallback) après vente');
      } catch (syncError) {
        console.warn('⚠️ Impossible de déclencher la resync WalletContext après vente:', syncError);
      }

      await loadUserInventory(true);
      
      const totalNetAmount = sellResponses.reduce((sum, response) => {
        const responseNet = extractNumber(response.financial?.net_amount ?? response.net_amount ?? tradingData.sellPrice) ?? 0;
        return sum + responseNet;
      }, 0);

      const totalFees = sellResponses.reduce((sum, response) => {
        const responseFees = extractNumber(response.financial?.fees ?? response.fees ?? (tradingData.currentValue - tradingData.sellPrice)) ?? 0;
        return sum + responseFees;
      }, 0);

      Alert.alert(
        sellResponses.length > 1 ? '💰 Ventes confirmées' : '💰 Vente confirmée',
        `Vous avez cédé ${sellResponses.length} exemplaire(s) de "${bom.title}"\n\n` +
        `Montant brut: ${sellPrice.toLocaleString()} FCFA\n` +
        `Frais retenus: ${totalFees.toLocaleString()} FCFA\n` +
        `Net crédité: ${totalNetAmount.toLocaleString()} FCFA\n` +
        `Nouveau solde: ${saleDisplayCash.toLocaleString()} FCFA\n\n` +
        `Votre solde a été mis à jour.`,
        [
          { 
            text: 'Voir mon portefeuille', 
            onPress: () => navigation.navigate('Wallet')
          },
          {
            text: 'Continuer',
            onPress: async () => {
              setProcessing(false);
            }
          }
        ]
      );
      
    } catch (error: any) {
      console.error('❌ Erreur vente:', error);
      const errorMessage = error.response?.data?.detail || error.message || 'La vente n\'a pas pu être effectuée';
      
      if (errorMessage.includes('non trouvé') || errorMessage.includes('possédez pas')) {
        Alert.alert(
          'Vente impossible',
          'Cette œuvre n\'est plus dans votre inventaire.\n\n' +
          'Elle a peut-être déjà été vendue ou transférée.',
          [
            { 
              text: 'Recharger', 
              onPress: () => {
                // ✅ PATCH FINAL: Le WebSocket a déjà mis à jour le solde
                // On recharge uniquement l'inventaire
                loadUserInventory(); // ✅ UNIQUEMENT l'inventaire
                setProcessing(false);
              }
            },
            { text: 'Annuler', style: 'cancel' }
          ]
        );
      } else {
        Alert.alert('Erreur de vente', errorMessage);
      }
      setProcessing(false);
    }
  };

  const handleQuantityChange = (newQuantity: number) => {
    if (newQuantity < 1) return;
    
    // ✅ CORRECTION: Limiter la quantité d'achat selon le stock
    if (bom.max_editions && bom.available_editions && newQuantity > bom.available_editions) {
      Alert.alert(
        'Stock limité',
        `Seulement ${bom.available_editions} exemplaire(s) disponible(s).`,
        [{ text: 'OK', onPress: () => setQuantity(bom.available_editions) }]
      );
      setQuantity(bom.available_editions);
      return;
    }
    
    // ✅ CORRECTION: Limiter la quantité de vente selon la possession
    if (userOwnsBom && newQuantity > inventoryCount) {
      Alert.alert(
        'Quantité insuffisante',
        `Vous ne possédez que ${inventoryCount} exemplaire(s).`,
        [{ text: 'OK', onPress: () => setQuantity(inventoryCount) }]
      );
      setQuantity(inventoryCount);
      return;
    }
    
    setQuantity(newQuantity);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.loadingText}>Chargement des données...</Text>
      </View>
    );
  }

  const availableStock = bom.available_editions || 999;
  const canBuyMore = availableStock >= quantity;
  const canSell = userOwnsBom && inventoryCount >= quantity;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        
        {/* EN-TÊTE */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Acquisition d'œuvre</Text>
          <View style={styles.headerRight} />
        </View>

        {/* IMAGE DE L'ŒUVRE */}
        <View style={styles.artworkContainer}>
          <Image 
            source={{ uri: bom.preview_image || bom.animation_url || bom.image_url }} 
            style={styles.artworkImage}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={styles.artworkGradient}
          />
          <View style={styles.artworkInfo}>
            <Text style={styles.artworkTitle}>{bom.title}</Text>
            <Text style={styles.artworkArtist}>{bom.artist}</Text>
            {bom.edition_type && (
              <View style={styles.editionBadge}>
                <Text style={styles.editionText}>
                  {bom.edition_type === 'common' ? 'Standard' : 
                   bom.edition_type === 'rare' ? 'Rare' :
                   bom.edition_type === 'epic' ? 'Épique' : 'Légendaire'}
                </Text>
                {bom.current_edition && bom.max_editions && (
                  <Text style={styles.editionNumber}>
                    Édition {bom.current_edition}/{bom.max_editions}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>

        {/* ONGLETS */}
        <View style={styles.tabContainer}>
          <TouchableOpacity 
            style={[styles.tab, selectedTab === 'details' && styles.tabActive]}
            onPress={() => setSelectedTab('details')}
          >
            <Text style={[styles.tabText, selectedTab === 'details' && styles.tabTextActive]}>
              Détails
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.tab, selectedTab === 'performance' && styles.tabActive]}
            onPress={() => setSelectedTab('performance')}
          >
            <Text style={[styles.tabText, selectedTab === 'performance' && styles.tabTextActive]}>
              Performance
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.tab, selectedTab === 'purchase' && styles.tabActive]}
            onPress={() => setSelectedTab('purchase')}
          >
            <Text style={[styles.tabText, selectedTab === 'purchase' && styles.tabTextActive]}>
              Acquisition
            </Text>
          </TouchableOpacity>
        </View>

        {/* CONTENU DES ONGLETS */}
        {selectedTab === 'details' && (
          <View style={styles.tabContent}>
            <Text style={styles.sectionTitle}>À propos de cette œuvre</Text>
            {bom.description && (
              <Text style={styles.description}>{bom.description}</Text>
            )}
            
            <View style={styles.detailsGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Catégorie</Text>
                <Text style={styles.detailValue}>{bom.category || 'Art numérique'}</Text>
              </View>
              
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Créée le</Text>
                <Text style={styles.detailValue}>
                  {bom.created_at ? new Date(bom.created_at).toLocaleDateString('fr-FR') : 'Date inconnue'}
                </Text>
              </View>
              
              {bom.collection_id && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Collection</Text>
                  <Text style={styles.detailValue}>À déterminer</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {selectedTab === 'performance' && tradingData && (
          <View style={styles.tabContent}>
            <Text style={styles.sectionTitle}>Performance du marché</Text>
            
            <View style={styles.performanceCard}>
              <Animated.View style={[styles.priceContainer, { transform: [{ scale: priceAnimation }] }]}>
                <Text style={styles.priceLabel}>Valeur actuelle</Text>
                <Text style={styles.priceValue}>
                  {tradingData.currentValue.toLocaleString()} FCFA
                </Text>
                <View style={[styles.changeBadge, tradingData.priceChange24h >= 0 ? styles.changePositive : styles.changeNegative]}>
                  <Text style={styles.changeText}>
                    {tradingData.priceChange24h >= 0 ? '+' : ''}{tradingData.priceChange24h.toFixed(2)}%
                  </Text>
                </View>
              </Animated.View>
              
              <View style={styles.performanceGrid}>
                <View style={styles.performanceItem}>
                  <Text style={styles.performanceLabel}>Volume 24h</Text>
                  <Text style={styles.performanceValue}>
                    {tradingData.volume24h.toLocaleString()} FCFA
                  </Text>
                </View>
                
                <View style={styles.performanceItem}>
                  <Text style={styles.performanceLabel}>Volatilité</Text>
                  <Text style={styles.performanceValue}>
                    {tradingData.volatility.toFixed(1)}%
                  </Text>
                </View>
                
                <View style={styles.performanceItem}>
                  <Text style={styles.performanceLabel}>Détenteurs</Text>
                  <Text style={styles.performanceValue}>
                    {tradingData.uniqueHolders}
                  </Text>
                </View>
                
                <View style={styles.performanceItem}>
                  <Text style={styles.performanceLabel}>Score social</Text>
                  <Text style={styles.performanceValue}>
                    {tradingData.socialScore.toFixed(2)}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.stabilityCard}>
              <Text style={styles.stabilityTitle}>Bouclier de capitalisation</Text>
              <Text style={styles.stabilitySubtitle}>
                Chaque bloc de {PALIER_THRESHOLD_LABEL} déclenche +{MICRO_IMPACT_RATE_PERCENT}% via le micro-moteur.
                Actuellement {formatCompactCurrency(tradingData.effectiveCap ?? tradingData.marketCap ?? 0)} sont engagés sur cette œuvre.
              </Text>

              <View style={styles.stabilityStatsRow}>
                <View style={styles.stabilityStat}>
                  <Text style={styles.stabilityStatLabel}>Capitalisation</Text>
                  <Text style={styles.stabilityStatValue}>
                    {formatCompactCurrency(tradingData.marketCap ?? 0)}
                  </Text>
                </View>
                <View style={styles.stabilityStat}>
                  <Text style={styles.stabilityStatLabel}>Progression</Text>
                  <Text style={styles.stabilityStatValue}>
                    {((tradingData.capProgress ?? 0) * 100).toFixed(1)} %
                  </Text>
                </View>
                <View style={styles.stabilityStat}>
                  <Text style={styles.stabilityStatLabel}>Pool de redistribution</Text>
                  <Text style={styles.stabilityStatValue}>
                    {formatCompactCurrency(tradingData.redistributionPool ?? 0)}
                  </Text>
                </View>
              </View>

              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, {
                    width: `${Math.min((tradingData.capProgress ?? 0) * 100, 100)}%`
                  }]}
                />
              </View>

              <View style={styles.stabilityFooter}>
                <Text style={styles.stabilityFooterText}>
                  Multiplicateur prix : {(tradingData.stabilizationMultiplier ?? 1).toFixed(2)}×
                </Text>
                <Text style={styles.stabilityFooterText}>
                  Prochain palier : {tradingData.nextMilestone ? formatCompactCurrency(tradingData.nextMilestone) : 'objectif atteint'}
                </Text>
              </View>

              <Text style={styles.stabilityFootnote}>
                Seuls les paliers de {PALIER_THRESHOLD_LABEL} ajoutent +{MICRO_IMPACT_RATE_PERCENT}% à la valeur sociale : sans ce volume, le prix reste verrouillé.
              </Text>
            </View>
          </View>
        )}

        {selectedTab === 'purchase' && tradingData && (
          <View style={styles.tabContent}>
            <Text style={styles.sectionTitle}>Options d'acquisition</Text>
            
            {/* QUANTITÉ */}
            <View style={styles.quantitySection}>
              <Text style={styles.quantityLabel}>Quantité</Text>
              <View style={styles.quantityControls}>
                <TouchableOpacity 
                  style={[styles.quantityButton, quantity <= 1 && styles.quantityButtonDisabled]}
                  onPress={() => handleQuantityChange(quantity - 1)}
                  disabled={quantity <= 1}
                >
                  <Text style={styles.quantityButtonText}>-</Text>
                </TouchableOpacity>
                
                <View style={styles.quantityDisplay}>
                  <Text style={styles.quantityNumber}>{quantity}</Text>
                  <Text style={styles.quantityUnit}>exemplaire{quantity > 1 ? 's' : ''}</Text>
                </View>
                
                <TouchableOpacity 
                  style={[styles.quantityButton, !canBuyMore && styles.quantityButtonDisabled]}
                  onPress={() => handleQuantityChange(quantity + 1)}
                  disabled={!canBuyMore}
                >
                  <Text style={styles.quantityButtonText}>+</Text>
                </TouchableOpacity>
              </View>
              
              {/* ✅ CORRECTION: Affichage des limites */}
              {userOwnsBom && (
                <Text style={styles.quantityInfo}>
                  Vous possédez: {inventoryCount} exemplaire(s)
                </Text>
              )}
              {bom.max_editions && bom.available_editions !== undefined && (
                <Text style={styles.quantityInfo}>
                  Disponible: {bom.available_editions} / {bom.max_editions}
                </Text>
              )}
            </View>

            {/* DÉTAILS FINANCIERS */}
            <View style={styles.financialCard}>
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>Valeur unitaire</Text>
                <Text style={styles.financialValue}>
                  {tradingData.currentValue.toLocaleString()} FCFA
                </Text>
              </View>
              
              {/* Section achat */}
              <View style={styles.sectionSubtitle}>
                <Text style={styles.sectionSubtitleText}>Pour l'acquisition</Text>
              </View>
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>
                  {`Frais d'acquisition (~${feePercents.buy.toFixed(2)}%)`}
                </Text>
                <Text style={[styles.financialValue, styles.feesText]}>
                  {(tradingData.buyPrice - tradingData.currentValue).toLocaleString()} FCFA
                </Text>
              </View>
              <View style={styles.financialRow}>
                <Text style={styles.financialLabel}>Prix total (achat)</Text>
                <Text style={[styles.financialValue, styles.buyTotal]}>
                  {(tradingData.buyPrice * quantity).toLocaleString()} FCFA
                </Text>
              </View>
              
              {/* Section vente - seulement si possédé */}
              {userOwnsBom && (
                <>
                  <View style={styles.sectionSubtitle}>
                    <Text style={styles.sectionSubtitleText}>Pour la cession</Text>
                  </View>
                  <View style={styles.financialRow}>
                    <Text style={styles.financialLabel}>
                      {`Frais de retrait (~${feePercents.sell.toFixed(2)}%)`}
                    </Text>
                    <Text style={[styles.financialValue, styles.feesText]}>
                      {(tradingData.currentValue - tradingData.sellPrice).toLocaleString()} FCFA
                    </Text>
                  </View>
                  <View style={styles.financialRow}>
                    <Text style={styles.financialLabel}>Montant net (vente)</Text>
                    <Text style={[styles.financialValue, styles.sellTotal]}>
                      {(tradingData.sellPrice * quantity).toLocaleString()} FCFA
                    </Text>
                  </View>
                </>
              )}
              
              <View style={styles.divider} />
              
              {/* ✅ MISE À JOUR: AFFICHAGE DU SOLDE UTILISABLE */}
              <View style={styles.financialRow}>
                <Text style={styles.totalLabel}>Votre solde réel disponible</Text>
                <Text style={styles.totalValue}>
                  {usableBalance?.toLocaleString()} FCFA {/* ✅ UTILISATION DE usableBalance */}
                </Text>
              </View>
              
              {/* Indicateur de possession */}
              {userOwnsBom ? (
                <View style={styles.ownershipBadge}>
                  <Text style={styles.ownershipBadgeText}>✅ Vous possédez {inventoryCount} exemplaire(s)</Text>
                  <Text style={styles.ownershipBadgeSubtext}>Prêt à céder sur le marché</Text>
                </View>
              ) : (
                <View style={styles.notOwnedBadge}>
                  <Text style={styles.notOwnedBadgeText}>❌ Vous ne possédez pas cette œuvre</Text>
                  <Text style={styles.notOwnedBadgeSubtext}>Achetez-la d'abord pour la céder</Text>
                </View>
              )}
            </View>

            {/* BOUTONS D'ACTION */}
            <View style={styles.actionButtons}>
              {/* BOUTON ACHAT - Toujours visible */}
              <TouchableOpacity 
                style={[
                  styles.buyButton, 
                  (processing || !canBuyMore) && styles.buttonDisabled
                ]}
                onPress={handlePurchase}
                disabled={processing || !canBuyMore}
              >
                {processing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.buyButtonText}>Acquérir cette œuvre</Text>
                    <Text style={styles.buyButtonSubtext}>
                      Débit: {(tradingData.buyPrice * quantity).toLocaleString()} FCFA
                    </Text>
                    {!canBuyMore && (
                      <Text style={styles.stockWarning}>Stock insuffisant</Text>
                    )}
                  </>
                )}
              </TouchableOpacity>
              
              {/* BOUTON VENTE - Seulement si possédé */}
              {userOwnsBom ? (
                <TouchableOpacity 
                  style={[
                    styles.sellButton, 
                    (processing || !canSell) && styles.buttonDisabled
                  ]}
                  onPress={handleSell}
                  disabled={processing || !canSell}
                >
                  {processing ? (
                    <ActivityIndicator color="#333" />
                  ) : (
                    <>
                      <Text style={styles.sellButtonText}>Céder cette œuvre</Text>
                      <Text style={styles.sellButtonSubtext}>
                        Crédit: {(tradingData.sellPrice * quantity).toLocaleString()} FCFA
                      </Text>
                      {!canSell && (
                        <Text style={styles.quantityWarning}>Quantité insuffisante</Text>
                      )}
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <View style={styles.ownershipMessage}>
                  <Text style={styles.ownershipText}>
                    ⚠️ Vous ne possédez pas cette œuvre
                  </Text>
                  <Text style={styles.ownershipSubtext}>
                    Achetez-la d'abord pour pouvoir la céder ultérieurement
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* INFORMATIONS COMPLÉMENTAIRES */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>À savoir</Text>
          <View style={styles.infoPoints}>
            <Text style={styles.infoPoint}>• L'acquisition inclut des frais plateforme (base 5%) qui alimentent la trésorerie et la sécurité du marché</Text>
            <Text style={styles.infoPoint}>• Chaque palier de {PALIER_THRESHOLD_LABEL} déclenche +{MICRO_IMPACT_RATE_PERCENT}% de micro-impact : seule cette accumulation collective déplace les prix</Text>
            <Text style={styles.infoPoint}>• La valeur des œuvres évolue en fonction de leur popularité et partage</Text>
            <Text style={styles.infoPoint}>• Vous pouvez céder vos œuvres à tout moment sur le marché</Text>
            <Text style={styles.infoPoint}>• Les œuvres acquises sont ajoutées à votre collection personnelle</Text>
            <Text style={styles.infoPoint}>• Le profit est calculé entre le prix d'achat et de vente</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 24,
    color: '#333',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  headerRight: {
    width: 40,
  },
  artworkContainer: {
    position: 'relative',
    height: 280,
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
  artworkGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  artworkInfo: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  artworkTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  artworkArtist: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 12,
  },
  editionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  editionText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
    marginRight: 8,
  },
  editionNumber: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  tab: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#333',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#333',
    fontWeight: '600',
  },
  tabContent: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 20,
  },
  sectionSubtitle: {
    marginTop: 15,
    marginBottom: 8,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  sectionSubtitleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    color: '#666',
    marginBottom: 20,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 15,
  },
  detailItem: {
    width: (width - 55) / 2,
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  detailLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  performanceCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  priceContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  priceLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  priceValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  changeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  changePositive: {
    backgroundColor: '#d1fae5',
  },
  changeNegative: {
    backgroundColor: '#fee2e2',
  },
  changeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  performanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stabilityCard: {
    marginTop: 20,
    backgroundColor: '#0f172a',
    borderRadius: 18,
    padding: 20,
  },
  stabilityTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 8,
  },
  stabilitySubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(248,250,252,0.75)',
    marginBottom: 16,
  },
  stabilityStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  stabilityStat: {
    flex: 1,
    paddingRight: 12,
  },
  stabilityStatLabel: {
    fontSize: 11,
    color: 'rgba(248,250,252,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  stabilityStatValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e0f2fe',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(248,250,252,0.2)',
    marginVertical: 12,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#38bdf8',
  },
  stabilityFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  stabilityFooterText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f1f5f9',
  },
  stabilityFootnote: {
    fontSize: 12,
    color: 'rgba(248,250,252,0.6)',
    lineHeight: 18,
  },
  performanceItem: {
    width: (width - 60) / 2,
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 12,
  },
  performanceLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  performanceValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  quantitySection: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    marginBottom: 20,
  },
  quantityLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
    textAlign: 'center',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  quantityButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityButtonDisabled: {
    backgroundColor: '#ccc',
  },
  quantityButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  quantityDisplay: {
    alignItems: 'center',
    minWidth: 80,
  },
  quantityNumber: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#333',
  },
  quantityUnit: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  quantityInfo: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  quantityWarning: {
    fontSize: 12,
    color: '#dc2626',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  financialCard: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    marginBottom: 20,
  },
  financialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  financialLabel: {
    fontSize: 14,
    color: '#666',
  },
  financialValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  feesText: {
    color: '#dc2626',
  },
  buyTotal: {
    color: '#16a34a',
    fontWeight: 'bold',
  },
  sellTotal: {
    color: '#2563eb',
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#e9ecef',
    marginVertical: 15,
  },
  totalLabel: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 20,
    color: '#16a34a',
    fontWeight: 'bold',
  },
  ownershipBadge: {
    backgroundColor: '#d1fae5',
    padding: 12,
    borderRadius: 8,
    marginTop: 15,
    alignItems: 'center',
  },
  ownershipBadgeText: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  ownershipBadgeSubtext: {
    color: '#065f46',
    fontSize: 12,
    opacity: 0.8,
  },
  notOwnedBadge: {
    backgroundColor: '#fef3c7',
    padding: 12,
    borderRadius: 8,
    marginTop: 15,
    alignItems: 'center',
  },
  notOwnedBadgeText: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  notOwnedBadgeSubtext: {
    color: '#92400e',
    fontSize: 12,
    opacity: 0.8,
  },
  actionButtons: {
    gap: 12,
    marginBottom: 15,
  },
  buyButton: {
    backgroundColor: '#28a745',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  sellButton: {
    backgroundColor: '#ffc107',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  buyButtonSubtext: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  sellButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  sellButtonSubtext: {
    color: '#666',
    fontSize: 13,
  },
  stockWarning: {
    color: '#fff',
    fontSize: 11,
    marginTop: 4,
    backgroundColor: 'rgba(220, 38, 38, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ownershipMessage: {
    backgroundColor: '#fff3cd',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffeaa7',
    alignItems: 'center',
  },
  ownershipText: {
    fontSize: 14,
    color: '#856404',
    fontWeight: '600',
    marginBottom: 5,
    textAlign: 'center',
  },
  ownershipSubtext: {
    fontSize: 12,
    color: '#856404',
    textAlign: 'center',
    lineHeight: 16,
  },
  infoSection: {
    backgroundColor: '#f8f9fa',
    margin: 20,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  infoPoints: {
    gap: 10,
  },
  infoPoint: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
});
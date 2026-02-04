import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'; 
import { 
  View, 
  Text, 
  FlatList, 
  ActivityIndicator, 
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  Alert,
  Animated,
  SafeAreaView
} from 'react-native';
import { NFTCard } from '../components/BomCard';
import { boomsService, Boom, BoomFilters } from '../services/boms';
import { interactionsService, InteractionStatsSummary } from '../services/interactions';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { boomsWebSocket } from '../services/websocket'; // Utiliser le service WebSocket global

export default function CatalogueScreen({ navigation, route }: any) {
  const [booms, setBooms] = useState<Boom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<BoomFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const discoverFilterRef = useRef<((boom: Boom) => boolean) | null>(null);
  const [activeDiscoverFilter, setActiveDiscoverFilter] = useState<string | null>(null);
  
  // Données pour les filtres
  const [categories, setCategories] = useState<string[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [editionTypes] = useState<string[]>(['common', 'rare', 'ultra_rare', 'legendary']);
  const [socialFilters] = useState<string[]>(['viral', 'trending', 'new', 'stable']);
  const [sortBy, setSortBy] = useState<'social_value' | 'total_value' | 'base_value' | 'volatility' | 'buy_count'>('social_value');

  const insets = useSafeAreaInsets();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [notificationAnim] = useState(new Animated.Value(0));
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  
  // Référence pour nettoyage
  const cleanupRef = useRef<(() => void) | null>(null);
  const gallerySubscribedRef = useRef(false);
  const interactionStatsRef = useRef<Record<number, InteractionStatsSummary>>({});
  const [interactionStatsMap, setInteractionStatsMap] = useState<Record<number, InteractionStatsSummary>>({});
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInitializedRef = useRef(false);
  const currencyFormatter = useMemo(() => new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'XOF',
    maximumFractionDigits: 0
  }), []);
  const formatCurrency = useCallback((value: number) => {
    const numeric = typeof value === 'number' && Number.isFinite(value)
      ? value
      : Number(value) || 0;
    return currencyFormatter.format(numeric);
  }, [currencyFormatter]);
  const discoverMeta = useMemo(() => ({
    ultra_rare: {
      headline: 'Rareté élevée',
      description: 'Affichage des BOOMS rares et ultra rares.'
    },
    viral: {
      headline: 'Impact social fort',
      description: 'BOOMS dont la valeur sociale explose.'
    },
    trending: {
      headline: 'Croissance dynamique',
      description: 'Sélection des BOOMS en forte hausse.'
    },
    nouveau: {
      headline: 'Nouvelles parutions',
      description: 'Dernières œuvres ajoutées sur la plateforme.'
    }
  }), []);

  const ensureGallerySubscription = useCallback(() => {
    if (!boomsWebSocket.isConnectedStatus()) {
      return;
    }
    if (gallerySubscribedRef.current) {
      return;
    }
    boomsWebSocket.sendMessage({
      type: 'subscribe',
      channel: 'gallery_updates',
      scope: 'all'
    });
    gallerySubscribedRef.current = true;
  }, []);

  const resetGallerySubscription = useCallback(() => {
    gallerySubscribedRef.current = false;
  }, []);

  const clearDiscoverFilter = useCallback(() => {
    discoverFilterRef.current = null;
    setActiveDiscoverFilter(null);
  }, []);

  const applyInteractionStats = useCallback((statsList: InteractionStatsSummary[]) => {
    if (!statsList.length) {
      return;
    }
    setInteractionStatsMap(prev => {
      const next = { ...prev };
      statsList.forEach(stats => {
        next[stats.boomId] = stats;
      });
      interactionStatsRef.current = next;
      return next;
    });
  }, []);

  const prefetchInteractionStats = useCallback(async (boomBatch: Boom[]) => {
    if (!boomBatch.length) {
      return;
    }
    const missingIds = boomBatch
      .map(boom => boom.id)
      .filter(id => !interactionStatsRef.current[id]);
    if (!missingIds.length) {
      return;
    }
    const toFetch = missingIds.slice(0, 8);
    const responses = await Promise.allSettled(
      toFetch.map(id => interactionsService.getStatsSummary(id))
    );
    const resolved = responses
      .filter((res): res is PromiseFulfilledResult<InteractionStatsSummary> => res.status === 'fulfilled')
      .map(res => res.value);
    applyInteractionStats(resolved);
  }, [applyInteractionStats]);

  // ==================== GESTION DES FILTRES DEPUIS DÉCOUVRIR ====================
  useEffect(() => {
    if (route.params?.filter) {
      handleDiscoverFilter(route.params.filter);
      if (navigation?.setParams) {
        navigation.setParams({ filter: undefined });
      }
    }
  }, [route.params?.filter, navigation]);

  const handleDiscoverFilter = (rawFilterType: string) => {
    const filterType = rawFilterType === 'nouveaute' ? 'nouveau' : rawFilterType;
    let newFilters: BoomFilters = {};
    let predicate: ((boom: Boom) => boolean) | null = null;
    let sortOverride: typeof sortBy | null = null;
    let alertMessage = '';
    switch (filterType) {
      case 'ultra_rare':
        predicate = (boom: Boom) => ['rare', 'ultra_rare'].includes(boom.edition_type);
        sortOverride = 'total_value';
        alertMessage = 'Rareté élevée: rares & ultra rares.';
        break;
      case 'viral':
        predicate = (boom: Boom) => {
          const socialDelta = Number(boom.social_value ?? boom.social_delta ?? 0);
          return boom.social_event === 'viral' || socialDelta >= 150000;
        };
        newFilters.social_event = 'viral';
        newFilters.min_social_value = 150000;
        sortOverride = 'social_value';
        alertMessage = 'Impact social massif mis en avant.';
        break;
      case 'trending':
        predicate = (boom: Boom) => {
          const base = Number(boom.base_value ?? boom.base_price ?? 0);
          const total = Number(boom.total_value ?? boom.value ?? base);
          if (base <= 0) {
            return boom.social_event === 'trending';
          }
          const growthPercent = ((total - base) / base) * 100;
          return boom.social_event === 'trending' || growthPercent >= 8;
        };
        newFilters.social_event = 'trending';
        sortOverride = 'social_value';
        alertMessage = 'Croissance soutenue détectée.';
        break;
      case 'nouveau':
        predicate = (boom: Boom) => {
          const createdAt = boom.created_at ? new Date(boom.created_at) : null;
          if (!createdAt) {
            return boom.social_event === 'new';
          }
          const daysDiff = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
          return boom.social_event === 'new' || daysDiff <= 15;
        };
        newFilters.social_event = 'new';
        sortOverride = 'base_value';
        alertMessage = 'Dernières sorties mises en avant.';
        break;
      default:
        clearDiscoverFilter();
        Alert.alert('Filtre indisponible', 'Cette découverte n\'est pas encore configurée.');
        return;
    }

    discoverFilterRef.current = predicate;
    setActiveDiscoverFilter(filterType);
    if (sortOverride && sortOverride !== sortBy) {
      setSortBy(sortOverride);
    }
    setFilters(newFilters);
    setShowFilters(false);
    setPage(1);
    loadBooms(1, true, { ...newFilters, sort_by: sortOverride ?? sortBy });
    if (alertMessage) {
      Alert.alert('Découvrir', alertMessage);
    }
  };

  // ==================== GESTION WEB SOCKET GLOBAL ====================
  const setupWebSocket = useCallback(() => {
    console.log('🔌 CatalogueScreen: Configuration de l\'écoute WebSocket global');
    
    const unsubscribeUpdate = boomsWebSocket.onUpdate((message: any) => {
      if (message.type === 'social_update' && message.boom_id) {
        console.log('📡 [Catalogue] Mise à jour reçue pour BOOM:', message.boom_id, message.delta);
        const deltaValue = Number(message.delta ?? 0);
        const shouldNotify = Math.abs(deltaValue) >= 1;
        if (shouldNotify) {
          showValueChangeNotification(message.title || 'BOOM', deltaValue, message.action);
        }
        
        setBooms(prev => prev.map(boom => {
          if (boom.id !== message.boom_id) {
            return boom;
          }
          const baseValue = Number(boom.base_value ?? boom.base_price ?? 0);
          const microValue = Number(
            message.new_social_value ??
            boom.current_social_value ??
            boom.social_value ??
            0
          );
          const totalValue = Number(
            message.new_total_value ??
            message.total_value ??
            boom.total_value ??
            (baseValue + microValue)
          );
          const socialDelta = totalValue - baseValue;
          return {
            ...boom,
            base_value: baseValue,
            social_value: socialDelta,
            social_delta: socialDelta,
            current_social_value: microValue,
            total_value: totalValue,
            value: totalValue,
            social_event: message.social_event ?? boom.social_event,
            buy_count: message.action === 'buy' ? (boom.buy_count || 0) + 1 : boom.buy_count,
            sell_count: message.action === 'sell' ? (boom.sell_count || 0) + 1 : boom.sell_count,
            share_count: ['share', 'share_internal'].includes(message.action)
              ? (boom.share_count || 0) + 1
              : boom.share_count,
            interaction_count: (boom.interaction_count || 0) + 1
          };
        }));
      }
      
      if (message.type === 'user_notification' || message.type === 'market_update') {
        console.log('📢 [Catalogue] Notification WebSocket:', message.type);
      }
    });
    
    const unsubscribeStatus = boomsWebSocket.onStatusChange((status) => {
      if (status === 'connected' || status === 'authenticated') {
        resetGallerySubscription();
        ensureGallerySubscription();
      } else if (status === 'disconnected' || status === 'error') {
        resetGallerySubscription();
      }
    });
    
    const compositeCleanup = () => {
      if (unsubscribeUpdate) {
        unsubscribeUpdate();
      }
      if (unsubscribeStatus) {
        unsubscribeStatus();
      }
      resetGallerySubscription();
    };
    cleanupRef.current = compositeCleanup;
    
    ensureGallerySubscription();
    
    return compositeCleanup;
  }, [ensureGallerySubscription, resetGallerySubscription, showValueChangeNotification]);

  // NOTIFICATION ANIMÉE pour changements de valeur
  const showValueChangeNotification = useCallback((title: string, change: number, action: string = 'update') => {
    let icon = '🔄';
    
    if (action === 'buy') {
      icon = '📈';
    } else if (action === 'sell') {
      icon = '📉';
    } else if (action === 'share' || action === 'share_internal') {
      icon = '🔄';
    }
    
    const formattedDelta = formatCurrency(Math.abs(change));
    const prefix = change > 0 ? '+' : change < 0 ? '-' : '';
    const messageValue = prefix ? `${prefix}${formattedDelta}` : formattedDelta;
    setNotificationMessage(`${icon} ${title}: ${messageValue}`);
    setShowNotification(true);
    
    Animated.sequence([
      Animated.timing(notificationAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true
      }),
      Animated.delay(3000),
      Animated.timing(notificationAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true
      })
    ]).start(() => {
      setShowNotification(false);
    });
  }, [formatCurrency, notificationAnim]);

  // Configuration WebSocket au focus
  useFocusEffect(
    useCallback(() => {
      refreshData();
      const unsubscribe = setupWebSocket();
      
      return () => {
        if (cleanupRef.current) {
          cleanupRef.current();
          cleanupRef.current = null;
        }
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }, [setupWebSocket])
  );

  // Initialisation des données
  useEffect(() => {
    loadInitialData();
    
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      await loadBooms(1, true);
      await loadFilterData();
    } catch (error) {
      console.error('Load initial data error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Chargement des BOOMS
  const loadBooms = async (pageNum: number, initialLoad = false, customFilters?: BoomFilters) => {
    try {
      if (initialLoad) setLoading(true);
      if (pageNum > 1) setLoadingMore(true);

      const mergedFilters = customFilters || filters;
      const pageLimit = 20;
      const sortSelection = customFilters?.sort_by ?? mergedFilters.sort_by ?? sortBy;
      const boomsData = await boomsService.getBooms({ 
        ...mergedFilters, 
        search: searchQuery,
        limit: pageLimit, 
        offset: (pageNum - 1) * pageLimit,
        sort_by: sortSelection
      });
      
      const processedData = boomsData.map(boom => {
        const baseValue = Number(boom.base_value ?? boom.base_price ?? 0);
        const microValue = Number(boom.current_social_value ?? boom.social_delta ?? 0);
        const totalValue = Number(boom.total_value ?? boom.value ?? baseValue + microValue);
        const socialDelta = typeof boom.social_delta === 'number'
          ? Number(boom.social_delta)
          : totalValue - baseValue;
        return {
          ...boom,
          base_value: baseValue,
          social_value: socialDelta,
          social_delta: socialDelta,
          current_social_value: microValue,
          total_value: totalValue,
          value: totalValue
        };
      });
      
      const finalData = discoverFilterRef.current
        ? processedData.filter(discoverFilterRef.current)
        : processedData;
      if (pageNum === 1) {
        setBooms(finalData);
      } else {
        setBooms(prev => [...prev, ...finalData]);
      }

      prefetchInteractionStats(finalData);
      
      setHasMore(boomsData.length === pageLimit);
      setPage(pageNum);
      setLastRefresh(new Date());
      
      // Afficher un message si aucun résultat après filtrage
      if (processedData.length === 0 && pageNum === 1) {
        const hasActiveFilters = Object.keys(customFilters || filters).length > 0 || searchQuery.trim() !== '';
        if (hasActiveFilters) {
          Alert.alert(
            'Aucun résultat',
            'Aucun BOOM ne correspond à vos critères de recherche.\nEssayez de modifier vos filtres.',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      console.error('Load BOOMS error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  // Déclenche automatiquement la recherche pendant la saisie (avec un léger debounce)
  useEffect(() => {
    if (!searchInitializedRef.current) {
      searchInitializedRef.current = true;
      return;
    }

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      loadBooms(1, true);
    }, 450);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery]);

  const loadFilterData = async () => {
    try {
      const [cats, arts] = await Promise.all([
        boomsService.getCategories(),
        boomsService.getArtists()
      ]);
      
      setCategories(cats || []);
      setArtists(arts || []);
    } catch (error) {
      console.error('Load filter data error:', error);
    }
  };

  const refreshData = () => {
    setRefreshing(true);
    loadBooms(1, true);
  };

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      loadBooms(page + 1);
    }
  };

  // Navigation vers détail BOOM
  const handleBoomPress = (boom: Boom) => {
    navigation.navigate('BomDetail', { 
      bomId: boom.id,
      social_value: boom.social_value,
      total_value: boom.total_value ?? ((boom.base_value || 0) + (boom.current_social_value || 0)),
      base_value: boom.base_value || boom.value
    });
  };

  const applyFilters = (newFilters: BoomFilters) => {
    clearDiscoverFilter();
    setFilters(newFilters);
    setShowFilters(false);
    setPage(1);
    loadBooms(1, true, newFilters);
  };

  const resetFilters = () => {
    const emptyFilters = {};
    clearDiscoverFilter();
    setFilters(emptyFilters);
    setShowFilters(false);
    setPage(1);
    setSearchQuery('');
    setSortBy('social_value');
    loadBooms(1, true, emptyFilters);
  };

  const handleSortChange = (newSort: typeof sortBy) => {
    setSortBy(newSort);
    setPage(1);
    loadBooms(1, true);
  };

  const activeFilterCount = Object.values(filters).filter(val => 
    val !== undefined && val !== '' && val !== null
  ).length;

  const formatEditionName = (edition: string) => {
    switch (edition) {
      case 'legendary': return 'Légendaire';
      case 'ultra_rare': return 'Ultra Rare';
      case 'rare': return 'Rare';
      default: return 'Commune';
    }
  };

  // FORMATER LE TEMPS DEPUIS DERNIER RAFRAÎCHISSEMENT
  const formatTimeSinceRefresh = () => {
    const diff = new Date().getTime() - lastRefresh.getTime();
    const seconds = Math.floor(diff / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}min`;
  };

  // ÉTAT DU WEB SOCKET GLOBAL
  const getWebSocketStatus = () => {
    if (boomsWebSocket.isConnectedStatus()) {
      if (boomsWebSocket.isAuthenticatedStatus()) {
        return { text: '✅ Temps-réel', color: '#10B981' };
      }
      return { text: '✅ Connecté', color: '#10B981' };
    }
    return { text: '🔌 Déconnecté', color: '#EF4444' };
  };

  const wsStatus = getWebSocketStatus();

  if (loading && booms.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Chargement de la galerie BOOMS...</Text>
          <Text style={styles.subLoadingText}>Système de trading social en ligne</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* NOTIFICATION ANIMÉE */}
        {showNotification && (
          <Animated.View 
            style={[
              styles.notification,
              {
                opacity: notificationAnim,
                transform: [{
                  translateY: notificationAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-50, 0]
                  })
                }]
              }
            ]}
          >
            <Text style={styles.notificationText}>{notificationMessage}</Text>
          </Animated.View>
        )}

        {activeDiscoverFilter && (
          <View style={styles.discoverBanner}>
            <View style={styles.discoverBannerTextWrap}>
              <Text style={styles.discoverBannerTitle}>
                {discoverMeta[activeDiscoverFilter]?.headline || 'Filtre Découvrir'}
              </Text>
              <Text style={styles.discoverBannerSubtitle}>
                {discoverMeta[activeDiscoverFilter]?.description || 'Affichage d\'une sélection thématique.'}
              </Text>
            </View>
            <TouchableOpacity style={styles.discoverBannerReset} onPress={resetFilters}>
              <Text style={styles.discoverBannerResetText}>Réinitialiser</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* HEADER */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>Galerie BOOMS</Text>
            <View style={styles.headerRight}>
              <TouchableOpacity onPress={refreshData} style={styles.refreshButton}>
                <Text style={styles.refreshText}>🔄 {formatTimeSinceRefresh()}</Text>
              </TouchableOpacity>
              <View style={[styles.wsStatus, { backgroundColor: wsStatus.color + '20' }]}>
                <Text style={[styles.wsStatusText, { color: wsStatus.color }]}>
                  {wsStatus.text}
                </Text>
              </View>
            </View>
          </View>
          
          <Text style={styles.subtitle}>
            {booms.length} BOOM{booms.length > 1 ? 's' : ''} • 
            <Text style={styles.highlight}> Trading social temps-réel</Text>
          </Text>
          
          {/* BARRE DE RECHERCHE */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher un BOOM, artiste..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => applyFilters({ ...filters, search: searchQuery })}
            />
            <TouchableOpacity 
              style={styles.searchButton}
              onPress={() => applyFilters({ ...filters, search: searchQuery })}
            >
              <Text style={styles.searchButtonText}>🔍</Text>
            </TouchableOpacity>
          </View>
          
          {/* TRI */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sortContainer}>
            <TouchableOpacity 
              style={[styles.sortButton, sortBy === 'social_value' && styles.sortButtonActive]}
              onPress={() => handleSortChange('social_value')}
            >
              <Text style={[styles.sortButtonText, sortBy === 'social_value' && styles.sortButtonTextActive]}>
                📈 Valeur sociale
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.sortButton, sortBy === 'total_value' && styles.sortButtonActive]}
              onPress={() => handleSortChange('total_value')}
            >
              <Text style={[styles.sortButtonText, sortBy === 'total_value' && styles.sortButtonTextActive]}>
                💰 Valeur totale
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.sortButton, sortBy === 'base_value' && styles.sortButtonActive]}
              onPress={() => handleSortChange('base_value')}
            >
              <Text style={[styles.sortButtonText, sortBy === 'base_value' && styles.sortButtonTextActive]}>
                ⚖️ Valeur base
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.sortButton, sortBy === 'volatility' && styles.sortButtonActive]}
              onPress={() => handleSortChange('volatility')}
            >
              <Text style={[styles.sortButtonText, sortBy === 'volatility' && styles.sortButtonTextActive]}>
                📊 Volatilité
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.sortButton, sortBy === 'buy_count' && styles.sortButtonActive]}
              onPress={() => handleSortChange('buy_count')}
            >
              <Text style={[styles.sortButtonText, sortBy === 'buy_count' && styles.sortButtonTextActive]}>
                🛒 Popularité
              </Text>
            </TouchableOpacity>
          </ScrollView>
          
          {/* BOUTON FILTRES */}
          <TouchableOpacity 
            style={styles.filterButton}
            onPress={() => setShowFilters(true)}
          >
            <Text style={styles.filterButtonText}>
              🔧 Filtres {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* LISTE DES BOOMS */}
        <FlatList
          data={booms}
          renderItem={({ item }) => (
            <NFTCard 
              nft={item} 
              onPress={handleBoomPress} 
              showCollection={true}
              showSocial={true}
              interactionSnapshot={interactionStatsMap[item.id]}
            />
          )}
          keyExtractor={(item) => item.token_id || item.id.toString()}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={refreshData}
              colors={['#667eea']}
              tintColor="#667eea"
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color="#667eea" />
                <Text style={styles.footerText}>Chargement des BOOMS...</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>🎨 Aucun BOOM trouvé</Text>
              <Text style={styles.emptySubtext}>
                Essayez de modifier vos critères de recherche ou filtrez différemment
              </Text>
              <TouchableOpacity 
                style={styles.resetButton}
                onPress={resetFilters}
              >
                <Text style={styles.resetButtonText}>Réinitialiser les filtres</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.browseButton}
                onPress={() => navigation.navigate('Dashboard')}
              >
                <Text style={styles.browseButtonText}>Retour au tableau de bord</Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />

        {/* MODAL FILTRES */}
        <Modal
          visible={showFilters}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowFilters(false)}
        >
          <SafeAreaView style={styles.modalOverlay}>
            <View style={[styles.modalContent, { paddingBottom: insets.bottom }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>🎯 Filtres avancés BOOMS</Text>
                <TouchableOpacity 
                  style={styles.modalCloseButton}
                  onPress={() => setShowFilters(false)}
                >
                  <Text style={styles.modalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
              
              <ScrollView style={styles.filtersContainer}>
                {/* FILTRE RECHERCHE */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>🔎 Recherche</Text>
                  <TextInput
                    style={styles.filterInput}
                    placeholder="Titre, artiste, description..."
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                </View>

                {/* FILTRE CATÉGORIE */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>📂 Catégorie</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.filterOptions}>
                      <TouchableOpacity
                        style={[styles.filterOption, !filters.category && styles.filterOptionActive]}
                        onPress={() => applyFilters({ ...filters, category: undefined })}
                      >
                        <Text style={[styles.filterOptionText, !filters.category && styles.filterOptionTextActive]}>
                          Toutes
                        </Text>
                      </TouchableOpacity>
                      {categories.map(category => (
                        <TouchableOpacity
                          key={category}
                          style={[styles.filterOption, filters.category === category && styles.filterOptionActive]}
                          onPress={() => applyFilters({ ...filters, category })}
                        >
                          <Text style={[styles.filterOptionText, filters.category === category && styles.filterOptionTextActive]}>
                            {category}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* FILTRE ARTISTE */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>👨‍🎨 Artiste</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.filterOptions}>
                      <TouchableOpacity
                        style={[styles.filterOption, !filters.artist && styles.filterOptionActive]}
                        onPress={() => applyFilters({ ...filters, artist: undefined })}
                      >
                        <Text style={[styles.filterOptionText, !filters.artist && styles.filterOptionTextActive]}>
                          Tous
                        </Text>
                      </TouchableOpacity>
                      {artists.map(artist => (
                        <TouchableOpacity
                          key={artist}
                          style={[styles.filterOption, filters.artist === artist && styles.filterOptionActive]}
                          onPress={() => applyFilters({ ...filters, artist })}
                        >
                          <Text style={[styles.filterOptionText, filters.artist === artist && styles.filterOptionTextActive]}>
                            {artist}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* FILTRE RARETÉ */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>💎 Rareté</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.filterOptions}>
                      <TouchableOpacity
                        style={[styles.filterOption, !filters.edition_type && styles.filterOptionActive]}
                        onPress={() => applyFilters({ ...filters, edition_type: undefined })}
                      >
                        <Text style={[styles.filterOptionText, !filters.edition_type && styles.filterOptionTextActive]}>
                          Toutes
                        </Text>
                      </TouchableOpacity>
                      {editionTypes.map(edition => (
                        <TouchableOpacity
                          key={edition}
                          style={[styles.filterOption, filters.edition_type === edition && styles.filterOptionActive]}
                          onPress={() => applyFilters({ ...filters, edition_type: edition })}
                        >
                          <Text style={[styles.filterOptionText, filters.edition_type === edition && styles.filterOptionTextActive]}>
                            {formatEditionName(edition)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* FILTRE SOCIAL */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>📱 Statut social</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.filterOptions}>
                      <TouchableOpacity
                        style={[styles.filterOption, !filters.social_event && styles.filterOptionActive]}
                        onPress={() => applyFilters({ ...filters, social_event: undefined })}
                      >
                        <Text style={[styles.filterOptionText, !filters.social_event && styles.filterOptionTextActive]}>
                          Tous
                        </Text>
                      </TouchableOpacity>
                      {socialFilters.map(event => (
                        <TouchableOpacity
                          key={event}
                          style={[styles.filterOption, filters.social_event === event && styles.filterOptionActive]}
                          onPress={() => applyFilters({ ...filters, social_event: event })}
                        >
                          <Text style={[styles.filterOptionText, filters.social_event === event && styles.filterOptionTextActive]}>
                            {event === 'viral' ? '🔥 Viral' : 
                             event === 'trending' ? '📈 Trending' : 
                             event === 'new' ? '🆕 Nouveau' :
                             '⭐ Stable'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* FILTRE VALEUR SOCIALE */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>📊 Fourchette de valeur sociale (FCFA)</Text>
                  <View style={styles.rangeDisplay}>
                    <View style={styles.rangeItem}>
                      <Text style={styles.rangeLabel}>Minimum</Text>
                      <Text style={styles.rangeValue}>
                        {typeof filters.min_social_value === 'number'
                          ? formatCurrency(filters.min_social_value)
                          : '—'}
                      </Text>
                    </View>
                    <View style={styles.rangeItem}>
                      <Text style={styles.rangeLabel}>Maximum</Text>
                      <Text style={styles.rangeValue}>
                        {typeof filters.max_social_value === 'number'
                          ? formatCurrency(filters.max_social_value)
                          : '∞'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.rangeButtons}>
                    <TouchableOpacity
                      style={styles.rangeButton}
                      onPress={() => applyFilters({ 
                        ...filters, 
                        min_social_value: -5000, 
                        max_social_value: 5000 
                      })}
                    >
                      <Text style={styles.rangeButtonText}>Stable (±5 000 FCFA)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.rangeButton}
                      onPress={() => applyFilters({ 
                        ...filters, 
                        min_social_value: 5000, 
                        max_social_value: undefined 
                      })}
                    >
                      <Text style={styles.rangeButtonText}>Croissant (≥ +5 000)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.rangeButton}
                      onPress={() => applyFilters({ 
                        ...filters, 
                        min_social_value: undefined, 
                        max_social_value: -5000 
                      })}
                    >
                      <Text style={styles.rangeButtonText}>Décroissant (≤ -5 000)</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* FILTRE VOLATILITÉ */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterLabel}>⚡ Volatilité</Text>
                  <View style={styles.volatilityButtons}>
                    <TouchableOpacity
                      style={[styles.volatilityButton, filters.volatility === 'low' && styles.volatilityButtonActive]}
                      onPress={() => applyFilters({ ...filters, volatility: filters.volatility === 'low' ? undefined : 'low' })}
                    >
                      <Text style={[
                        styles.volatilityButtonText,
                        filters.volatility === 'low' && styles.volatilityButtonTextActive
                      ]}>
                        Faible
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.volatilityButton, filters.volatility === 'medium' && styles.volatilityButtonActive]}
                      onPress={() => applyFilters({ ...filters, volatility: filters.volatility === 'medium' ? undefined : 'medium' })}
                    >
                      <Text style={[
                        styles.volatilityButtonText,
                        filters.volatility === 'medium' && styles.volatilityButtonTextActive
                      ]}>
                        Moyenne
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.volatilityButton, filters.volatility === 'high' && styles.volatilityButtonActive]}
                      onPress={() => applyFilters({ ...filters, volatility: filters.volatility === 'high' ? undefined : 'high' })}
                    >
                      <Text style={[
                        styles.volatilityButtonText,
                        filters.volatility === 'high' && styles.volatilityButtonTextActive
                      ]}>
                        Élevée
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>

              {/* BOUTONS ACTION */}
              <View style={[styles.modalActions, { marginBottom: insets.bottom + 10 }]}>
                <TouchableOpacity 
                  style={styles.resetAllButton}
                  onPress={resetFilters}
                >
                  <Text style={styles.resetAllButtonText}>🗑️ Tout effacer</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.applyButton}
                  onPress={() => {
                    applyFilters(filters);
                    setShowFilters(false);
                  }}
                >
                  <Text style={styles.applyButtonText}>✅ Appliquer</Text>
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

// STYLES (inchangés)
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  notification: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: '#FFFFFF',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    zIndex: 1000,
  },
  notificationText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    textAlign: 'center',
  },
  discoverBanner: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  discoverBannerTextWrap: {
    flex: 1,
  },
  discoverBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#065F46',
  },
  discoverBannerSubtitle: {
    fontSize: 12,
    color: '#047857',
    marginTop: 4,
  },
  discoverBannerReset: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#059669',
  },
  discoverBannerResetText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
  },
  refreshText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  wsStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  wsStatusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
  },
  highlight: {
    color: '#667eea',
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    fontSize: 14,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    marginLeft: 8,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  sortContainer: {
    marginBottom: 12,
  },
  sortButton: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sortButtonActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  sortButtonText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  sortButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  filterButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  filterButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  subLoadingText: {
    marginTop: 4,
    fontSize: 12,
    color: '#9CA3AF',
  },
  footerLoader: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    marginTop: 8,
    fontSize: 12,
    color: '#6B7280',
  },
  empty: {
    padding: 40,
    alignItems: 'center',
    marginTop: 50,
  },
  emptyText: {
    fontSize: 18,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  resetButton: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  resetButtonText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '600',
  },
  browseButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 18,
    color: '#6B7280',
    fontWeight: '600',
  },
  filtersContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: 500,
  },
  filterSection: {
    marginBottom: 24,
  },
  filterLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  filterInput: {
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    fontSize: 14,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterOptions: {
    flexDirection: 'row',
    paddingBottom: 8,
  },
  filterOption: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterOptionActive: {
    backgroundColor: '#667eea',
    borderColor: '#667eea',
  },
  filterOptionText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  filterOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  rangeDisplay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  rangeItem: {
    alignItems: 'center',
    flex: 1,
  },
  rangeLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
    fontWeight: '500',
  },
  rangeValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  rangeButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  rangeButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  rangeButtonText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    textAlign: 'center',
  },
  volatilityButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  volatilityButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  volatilityButtonActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  volatilityButtonText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  volatilityButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 30,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  resetAllButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
  },
  resetAllButtonText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '600',
  },
  applyButton: {
    flex: 1,
    backgroundColor: '#667eea',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginLeft: 8,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  applyButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
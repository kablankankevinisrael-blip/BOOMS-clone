import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  ScrollView, 
  StyleSheet,
  Alert,
  Share,
  Dimensions,
  Animated,
  Easing,
  RefreshControl
} from 'react-native';
import { NFTAnimationPlayer } from '../components/VideoPlayer';
import { Boom, boomsService } from '../services/boms'; // Changé: import Boom
import { interactionsService, InteractionStatsSummary } from '../services/interactions';
import { useFocusEffect } from '@react-navigation/native';
import { boomsWebSocket, useWebSocket } from '../services/websocket';
import { useAuth } from '../contexts/AuthContext';

const { width: screenWidth } = Dimensions.get('window');

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'XOF',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0
});

const integerFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0
});

const formatCurrency = (value: number | null | undefined): string => {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number(value) || 0;
  return currencyFormatter.format(Math.abs(numeric));
};

const formatCount = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0';
  }
  return integerFormatter.format(Math.max(0, Math.round(value)));
};

export default function BomDetailScreen({ route, navigation }: any) {
  const { bomId } = route.params;
  const { user } = useAuth();
  const [boom, setBoom] = useState<Boom | null>(null); // Changé: bom → boom
  const [hasLiked, setHasLiked] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [interactionStats, setInteractionStats] = useState<InteractionStatsSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liveDelta, setLiveDelta] = useState<number | null>(null);
  const [liveAction, setLiveAction] = useState<string>('');
  
  const frameAnimation = useRef(new Animated.Value(0)).current;
  const deltaAnimation = useRef(new Animated.Value(0)).current;
  
  const websocket = useWebSocket();

  const fetchInteractionState = useCallback(async (targetBoomId: number) => {
    try {
      const [stats, liked] = await Promise.all([
        interactionsService.getStatsSummary(targetBoomId).catch(() => null),
        user ? interactionsService.hasLiked(targetBoomId).catch(() => false) : Promise.resolve(false)
      ]);

      if (stats) {
        setInteractionStats(stats);
      }
      if (user) {
        setHasLiked(Boolean(liked));
      } else {
        setHasLiked(false);
      }
    } catch (error) {
      console.warn('[BomDetailScreen] Impossible de récupérer les stats d\'interaction', error);
    }
  }, [user?.id]);

  useEffect(() => {
    loadBoomDetails(); // Changé: loadBomDetails → loadBoomDetails
    startFrameAnimation();
    
    if (!websocket.isConnected()) {
      websocket.connect();
    }
    
    const unsubscribeMessage = websocket.onMessage(handleWebSocketMessage);
    const unsubscribeStatus = websocket.onStatusChange(handleWebSocketStatus);
    
    return () => {
      unsubscribeMessage();
      unsubscribeStatus();
      websocket.unsubscribeFromBoom(bomId);
    };
  }, [bomId]);

  useFocusEffect(
    React.useCallback(() => {
      loadBoomDetails();
      
      if (bomId && websocket.isConnected()) {
        websocket.subscribeToBoom(bomId);
        console.log(`📡 Abonné aux mises à jour live du Boom #${bomId}`);
      }
      
      return () => {
        setLiveDelta(null);
        setLiveAction('');
      };
    }, [bomId, websocket.isConnected()])
  );

  const handleWebSocketMessage = (message: any) => {
    switch (message.type) {
      case 'social_update':
        if (message.boom_id === bomId) {
          handleLiveSocialUpdate(message);
        }
        break;
      case 'social_event':
        if (message.boom_id === bomId) {
          handleLiveSocialEvent(message);
        }
        break;
    }
  };

  const handleWebSocketStatus = (status: string) => {
    console.log(`📡 WebSocket status: ${status}`);
    
    if (status === 'connected' || status === 'authenticated') {
      websocket.subscribeToBoom(bomId);
    }
  };

  const handleLiveSocialUpdate = (message: any) => {
    const { delta, action, new_social_value, new_total_value, title } = message;
    
    setLiveDelta(delta);
    setLiveAction(action);
    
    if (boom) {
      setBoom(prev => {
        if (!prev) return prev;
        const baseValue = prev.base_value ?? prev.value ?? 0;
        const microValue = new_social_value ?? prev.current_social_value ?? prev.social_value ?? 0;
        const totalValue = new_total_value ?? prev.total_value ?? (baseValue + microValue);
        return {
          ...prev,
          current_social_value: microValue,
          social_value: totalValue - baseValue,
          social_delta: totalValue - baseValue,
          total_value: totalValue,
          value: totalValue
        };
      });
    }
    
    animateDeltaChange(delta);
    showDeltaNotification(delta, action, title);
    if (action === 'like' || action === 'share' || action === 'share_internal') {
      fetchInteractionState(bomId);
    }
    
    setTimeout(() => {
      setLiveDelta(null);
      setLiveAction('');
    }, 3000);
  };

  const handleLiveSocialEvent = (message: any) => {
    const { event_type, message: eventMessage } = message;
    
    Alert.alert(
      `🎉 Événement ${event_type === 'viral' ? 'VIRAL' : 'TRENDING'}!`,
      eventMessage,
      [{ text: 'Super !' }]
    );
  };

  const animateDeltaChange = (delta: number) => {
    deltaAnimation.setValue(0);
    Animated.sequence([
      Animated.timing(deltaAnimation, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(1500),
      Animated.timing(deltaAnimation, {
        toValue: 0,
        duration: 500,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const showDeltaNotification = (delta: number, action: string, title: string) => {
    const icon = getActionIcon(action);
    const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
    const formatted = formatCurrency(delta);
    console.log(`${icon} ${title}: ${sign}${formatted}`);
  };

  const getActionIcon = (action: string): string => {
    switch (action) {
      case 'buy': return '📈';
      case 'sell': return '📉';
      case 'share': return '🔄';
      case 'gift': return '🎁';
      case 'like': return '❤️';
      case 'comment': return '💬';
      default: return '🔄';
    }
  };

  // CHANGÉ: loadBomDetails → loadBoomDetails
  const loadBoomDetails = async () => {
    try {
      setLoading(true);
      const boomData = await boomsService.getBoomDetails(bomId);
      setBoom(boomData);
      fetchInteractionState(boomData.id);
      
      if (websocket.isConnected()) {
        websocket.subscribeToBoom(bomId);
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de charger les détails du BOOM');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const startFrameAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(frameAnimation, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(frameAnimation, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const handleBuyPress = () => {
    if (boom) {
      navigation.navigate('Purchase', { bom: boom });
    }
  };

  const handleSharePress = async () => {
    if (!boom || shareLoading) {
      return;
    }
    if (!user?.id) {
      Alert.alert('Connexion requise', 'Identifiez-vous pour partager ce BOOM.');
      return;
    }
    
    try {
      setShareLoading(true);
      const result = await Share.share({
        message: `Découvrez "${boom.title}" - Un BOOM unique sur la plateforme`,
        url: boom.animation_url || boom.preview_image,
      });
      
      if (result.action === Share.sharedAction) {
        await interactionsService.recordInteraction(boom.id, 'share', {
          surface: 'bom_detail',
          shared_at: new Date().toISOString()
        });
        fetchInteractionState(boom.id);
        if (websocket.isConnected()) {
          websocket.sendMessage({
            type: 'user_action',
            action: 'share',
            boom_id: boom.id,
            user_id: user.id,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de partager');
    } finally {
      setShareLoading(false);
    }
  };

  const handleLikePress = async () => {
    if (!boom || likeLoading) {
      return;
    }
    if (!user?.id) {
      Alert.alert('Connexion requise', 'Identifiez-vous pour liker ce BOOM.');
      return;
    }

    try {
      setLikeLoading(true);
      const response = await interactionsService.recordInteraction(boom.id, 'like');
      const nextLiked = response.action !== 'unlike';
      setHasLiked(nextLiked);
      fetchInteractionState(boom.id);
      if (websocket.isConnected()) {
        websocket.sendMessage({
          type: 'user_action',
          action: 'like',
          boom_id: boom.id,
          user_id: user.id,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de traiter votre like');
    } finally {
      setLikeLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadBoomDetails();
  };

  if (loading && !boom) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Chargement du BOOM...</Text>
      </View>
    );
  }

  if (!boom) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>BOOM non trouvé</Text>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const getEditionColor = (editionType: string) => {
    switch (editionType) {
      case 'legendary': return '#D4AF37';
      case 'ultra_rare': return '#9B59B6';
      case 'rare': return '#3498DB';
      default: return '#95A5A6';
    }
  };

  const getEditionLabel = (editionType: string) => {
    switch (editionType) {
      case 'legendary': return 'Légendaire';
      case 'ultra_rare': return 'Ultra Rare';
      case 'rare': return 'Rare';
      default: return 'Standard';
    }
  };

  const getSocialEventLabel = (event: string) => {
    switch (event) {
      case 'viral': return 'Tendance';
      case 'trending': return 'Populaire';
      case 'new': return 'Nouveau';
      default: return 'Standard';
    }
  };

  const formatTokenId = (tokenId: string) => {
    if (!tokenId) return 'N/A';
    return tokenId.substring(0, 8).toUpperCase();
  };

  const renderEdition = () => {
    if (boom.max_editions) {
      return `${boom.current_edition || 1}/${boom.max_editions}`;
    }
    return 'Édition unique';
  };

  // CALCULER LA VALEUR TOTALE
  const getBaseValue = () => boom.base_value || boom.value || 0;
  const getSocialDelta = () => {
    if (typeof boom.social_delta === 'number') {
      return boom.social_delta;
    }
    return boom.current_social_value ?? boom.social_value ?? 0;
  };
  const getTotalValue = () => {
    const total = boom.total_value ?? ((boom.base_value || 0) + (boom.current_social_value || 0));
    if (typeof total === 'number') {
      return total;
    }
    return getBaseValue();
  };

  const frameScale = frameAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.01]
  });

  const deltaOpacity = deltaAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1]
  });

  const deltaTranslateY = deltaAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0]
  });

  const totalLikes = interactionStats?.totalLikes ?? 0;
  const socialShares = interactionStats?.totalSocialShares ?? (boom?.share_count || 0);
  const internalShares = interactionStats?.totalInternalShares ?? 0;
  const totalInteractions = interactionStats?.totalInteractions ?? (boom?.interaction_count || 0);
  const last24hSocialShares = interactionStats?.last24hSocialShares ?? 0;
  const last24hInternalShares = interactionStats?.last24hInternalShares ?? 0;
  const last24hInteractions = interactionStats?.last24hInteractions ?? 0;
  const uniqueUsers = interactionStats?.uniqueUsers ?? 0;
  const showEngagementSection = Boolean(interactionStats || boom);

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl 
          refreshing={refreshing} 
          onRefresh={onRefresh}
          colors={['#000000']}
          tintColor="#000000"
        />
      }
    >
      <View style={styles.artContainer}>
        <Animated.View style={[
          styles.artFrame,
          {
            transform: [{ scale: frameScale }],
            borderColor: getEditionColor(boom.edition_type),
          }
        ]}>
          <NFTAnimationPlayer
            animationUrl={boom.animation_url}
            audioUrl={boom.audio_url}
            previewImage={boom.preview_image}
            style={styles.videoPlayer}
            autoPlay={true}
            showControls={true}
            loop={true}
            showNFTBadge={false}
            showTypeIndicator={false}
          />
        </Animated.View>
        
        {/* Animation de delta en direct */}
        {liveDelta !== null && (
          <Animated.View 
            style={[
              styles.deltaIndicator,
              {
                opacity: deltaOpacity,
                transform: [{ translateY: deltaTranslateY }],
                backgroundColor: liveDelta > 0 ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)',
              }
            ]}
          >
            <Text style={styles.deltaText}>
              {getActionIcon(liveAction)}{' '}
              {liveDelta > 0 ? '+' : liveDelta < 0 ? '-' : ''}
              {formatCurrency(liveDelta)}
            </Text>
          </Animated.View>
        )}
      </View>
      
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>{boom.title}</Text>
            <Text style={styles.category}>{boom.category}</Text>
          </View>
          
          <View style={styles.actions}>
            <TouchableOpacity 
              style={[styles.actionButton, hasLiked && styles.favoriteButton]} 
              onPress={handleLikePress}
              disabled={likeLoading}
            >
              <Text style={[styles.actionIcon, hasLiked && styles.favoriteIcon]}>
                {hasLiked ? '♥' : '♡'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={handleSharePress}
              disabled={shareLoading}
            >
              <Text style={styles.actionIcon}>↗</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.badgesRow}>
          <View style={[styles.editionBadge, { backgroundColor: getEditionColor(boom.edition_type) }]}>
            <Text style={styles.editionText}>{getEditionLabel(boom.edition_type)}</Text>
            <Text style={styles.editionCount}>{renderEdition()}</Text>
          </View>
          
          {boom.social_event && (
            <View style={styles.socialEventBadge}>
              <Text style={styles.socialEventText}>
                {getSocialEventLabel(boom.social_event)}
              </Text>
            </View>
          )}
          
          {boom.token_id && (
            <View style={styles.tokenBadge}>
              <Text style={styles.tokenText}>{formatTokenId(boom.token_id)}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>
            {boom.description || 'BOOM - Œuvre numérique unique'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Valeurs</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Valeur base</Text>
              <Text style={styles.statValue}>
                {getBaseValue().toLocaleString()} FCFA
              </Text>
            </View>
            
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Valeur sociale</Text>
              <Text style={[
                styles.statValue,
                getSocialDelta() >= 0 ? styles.profit : styles.loss
              ]}>
                {`${getSocialDelta() >= 0 ? '+' : ''}${Math.abs(getSocialDelta()).toLocaleString()} FCFA`}
              </Text>
            </View>
            
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Valeur totale</Text>
              <Text style={[styles.statValue, styles.totalValue]}>
                {getTotalValue().toLocaleString()} FCFA
              </Text>
            </View>
          </View>
        </View>

        {showEngagementSection && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Engagement communautaire</Text>
            <View style={styles.engagementRow}>
              <View style={styles.engagementStat}>
                <Text style={styles.engagementLabel}>Likes cumulés</Text>
                <Text style={styles.engagementValue}>{formatCount(totalLikes)}</Text>
                {hasLiked && (
                  <Text style={styles.engagementBadge}>Vous aimez déjà</Text>
                )}
              </View>
              <View style={styles.engagementStat}>
                <Text style={styles.engagementLabel}>Partages réseaux sociaux</Text>
                <Text style={styles.engagementValue}>{formatCount(socialShares)}</Text>
                {last24hSocialShares > 0 && (
                  <Text style={styles.engagementBadge}>+{formatCount(last24hSocialShares)} / 24h</Text>
                )}
              </View>
            </View>
            <View style={styles.engagementRow}>
              <View style={styles.engagementStat}>
                <Text style={styles.engagementLabel}>Partages internes (cadeaux)</Text>
                <Text style={styles.engagementValue}>{formatCount(internalShares)}</Text>
                {last24hInternalShares > 0 && (
                  <Text style={styles.engagementBadge}>+{formatCount(last24hInternalShares)} / 24h</Text>
                )}
              </View>
              <View style={styles.engagementStat}>
                <Text style={styles.engagementLabel}>Interactions totales</Text>
                <Text style={styles.engagementValue}>{formatCount(totalInteractions)}</Text>
                {last24hInteractions > 0 && (
                  <Text style={styles.engagementSub}>+{formatCount(last24hInteractions)} sur 24h</Text>
                )}
              </View>
            </View>
            <View style={styles.engagementRow}>
              <View style={styles.engagementStat}>
                <Text style={styles.engagementLabel}>Fans uniques</Text>
                <Text style={styles.engagementValue}>{formatCount(uniqueUsers)}</Text>
                <Text style={styles.engagementSub}>Comptes ayant interagi</Text>
              </View>
              <View style={[styles.engagementStat, styles.engagementStatPlaceholder]} />
            </View>
          </View>
        )}

        {boom.collection_name && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Collection</Text>
            <View style={styles.collectionCard}>
              <Text style={styles.collectionName}>{boom.collection_name}</Text>
              <Text style={styles.collectionDescription}>Série de BOOMS</Text>
            </View>
          </View>
        )}

        <TouchableOpacity 
          style={[styles.actionButtonLarge, !boom.is_active && styles.disabledButton]} 
          onPress={handleBuyPress}
          disabled={!boom.is_active}
        >
          <View style={styles.actionButtonContent}>
            <Text style={styles.actionButtonText}>
              {boom.is_active ? 'Acquérir ce BOOM' : 'Indisponible'}
            </Text>
            {boom.is_active && (
              <Text style={styles.actionButtonPrice}>
                {getTotalValue().toLocaleString()} FCFA
              </Text>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Retour</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// AJOUTER UN STYLE POUR VALEUR TOTALE
const styles = StyleSheet.create({
  // ... Tous les styles existants restent inchangés ...
  
  totalValue: {
    color: '#D4AF37',
    fontWeight: '800',
  },
  
  // Le reste du fichier StyleSheet reste exactement le même
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
  loadingText: {
    fontSize: 16,
    color: '#666666',
  },
  errorText: {
    fontSize: 18,
    color: '#000000',
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: '#000000',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 10,
    marginBottom: 30,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  artContainer: {
    height: 340,
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  artFrame: {
    flex: 1,
    backgroundColor: '#000000',
    borderRadius: 4,
    borderWidth: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  deltaIndicator: {
    position: 'absolute',
    top: 80,
    left: 40,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  deltaText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  content: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleContainer: {
    flex: 1,
    marginRight: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 4,
  },
  category: {
    fontSize: 14,
    color: '#666666',
  },
  actions: {
    flexDirection: 'row',
  },
  actionButton: {
    padding: 10,
    marginLeft: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
  },
  actionIcon: {
    fontSize: 20,
    color: '#666666',
  },
  favoriteIcon: {
    color: '#D4AF37',
  },
  favoriteButton: {
    backgroundColor: '#FFF7E0',
    borderWidth: 1,
    borderColor: '#F7C948'
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  editionBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
    minWidth: 80,
  },
  editionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  editionCount: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  socialEventBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F0F8FF',
    borderWidth: 1,
    borderColor: '#E6F7FF',
  },
  socialEventText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1890FF',
  },
  tokenBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F8F8F8',
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  tokenText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333333',
    fontFamily: 'monospace',
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    color: '#666666',
    lineHeight: 22,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  engagementRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  engagementStat: {
    flex: 1,
    padding: 16,
    backgroundColor: '#F8F9FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7F5',
  },
  engagementStatPlaceholder: {
    backgroundColor: 'transparent',
    borderColor: 'transparent'
  },
  engagementLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  engagementValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  engagementBadge: {
    marginTop: 6,
    fontSize: 12,
    color: '#D97706',
    fontWeight: '600',
  },
  engagementSub: {
    marginTop: 6,
    fontSize: 12,
    color: '#6B7280',
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    padding: 16,
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  statLabel: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  profit: {
    color: '#48BB78',
  },
  loss: {
    color: '#E53E3E',
  },
  collectionCard: {
    padding: 16,
    backgroundColor: '#F0F8FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E6F7FF',
    alignItems: 'center',
  },
  collectionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1890FF',
    marginBottom: 4,
  },
  collectionDescription: {
    fontSize: 14,
    color: '#69C0FF',
  },
  actionButtonLarge: {
    backgroundColor: '#000000',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  disabledButton: {
    backgroundColor: '#A0AEC0',
  },
  actionButtonContent: {
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  actionButtonPrice: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
  },
});
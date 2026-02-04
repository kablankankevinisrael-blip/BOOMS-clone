import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  SafeAreaView,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useWallet } from '../contexts/WalletContext';
import { purchaseService, InventoryItem } from '../services/purchase';
import { boomsWebSocket } from '../services/websocket';
import type { Notification } from '../services/notifications';

const safeNumber = (value: any, fallback: number = 0): number => {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return !isNaN(parsed) ? parsed : fallback;
  }
  return fallback;
};

const safeGet = <T,>(obj: any, path: string, fallback: T): T => {
  const keys = path.split('.');
  let result = obj;
  
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      return fallback;
    }
  }
  return result !== undefined ? result as T : fallback;
};

const pickNumber = (...candidates: Array<number | null | undefined>): number => {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return 0;
};

const deriveInventoryBreakdown = (item: InventoryItem) => {
  const rawBom = item.bom_asset || item.bom || item.boom_data || {};
  const financial = item.financial || {};
  const socialMetrics = item.social_metrics || {};

  const totalCandidate = Math.max(0, pickNumber(
    socialMetrics.total_value,
    rawBom.total_value,
    rawBom.value,
    item.current_value,
    financial.estimated_value,
    (financial.purchase_price ?? 0) + (financial.current_social_value ?? 0)
  ));

  const baseCandidate = Math.max(0, pickNumber(
    socialMetrics.base_value,
    financial.purchase_price,
    rawBom.base_value,
    rawBom.purchase_price,
    item.purchase_price,
    totalCandidate
  ));

  const baseValue = Math.min(baseCandidate, totalCandidate || baseCandidate);

  const microCandidate = Math.max(0, pickNumber(
    socialMetrics.social_value,
    socialMetrics.micro_value,
    rawBom.social_value,
    rawBom.current_social_value,
    totalCandidate - baseValue
  ));

  const microValue = Math.min(
    microCandidate,
    Math.max(0, (totalCandidate || baseValue + microCandidate) - baseValue)
  );

  const totalValue = Math.max(totalCandidate, baseValue + microValue);

  return { baseValue, microValue, totalValue };
};

const summarizeCollection = (items: InventoryItem[]) => {
  const accumulator = items.reduce(
    (acc, item) => {
      const { baseValue, microValue, totalValue } = deriveInventoryBreakdown(item);
      acc.base += baseValue;
      acc.micro += microValue;
      acc.total += totalValue;

      const socialScore = pickNumber(
        safeGet<number | null>(item, 'social_metrics.social_score', null),
        safeGet<number | null>(item, 'bom_asset.social_score', null),
        safeGet<number | null>(item, 'boom_data.social_score', null)
      );
      if (socialScore > 0) {
        acc.scoreSum += socialScore;
        acc.scoreCount += 1;
      }

      return acc;
    },
    { base: 0, micro: 0, total: 0, scoreSum: 0, scoreCount: 0 }
  );

  const averageScore = accumulator.scoreCount > 0
    ? accumulator.scoreSum / accumulator.scoreCount
    : 0;

  const deltaValue = accumulator.total - accumulator.base;
  const deltaPercent = accumulator.base > 0
    ? (deltaValue / accumulator.base) * 100
    : 0;

  return {
    baseSum: accumulator.base,
    microSum: accumulator.micro,
    totalSum: accumulator.total,
    averageScore,
    deltaValue,
    deltaPercent
  };
};

export default function DashboardScreen({ navigation }: any) {
  const { user, logout, isAuthenticated } = useAuth();
  const { notifications, unreadCount } = useNotifications();
  
  const { 
    cashBalance,
    virtualBalance,
    usableBalance,
    loading: walletLoading,
    hasSufficientFunds,
    requestBackendSync
  } = useWallet();
  
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [totalCollectionValue, setTotalCollectionValue] = useState<number>(0);
  const [averageSocialScore, setAverageSocialScore] = useState<number>(0);
  const [collectionBaseValue, setCollectionBaseValue] = useState<number>(0);
  const [collectionDeltaValue, setCollectionDeltaValue] = useState<number>(0);
  const [collectionDeltaPercent, setCollectionDeltaPercent] = useState<number>(0);
  const hasLoadedOnceRef = useRef(false);
  const firstName = useMemo(() => user?.full_name?.split(' ')[0] || 'Boomer', [user?.full_name]);

  const [activeToast, setActiveToast] = useState<Notification | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const bellAnim = useRef(new Animated.Value(0)).current;
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastToastSignatureRef = useRef<string | null>(null);
  const bootstrappedNotificationsRef = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const giftAlertCount = useMemo(
    () =>
      notifications.filter(
        notification =>
          notification.notification_type?.startsWith('gift') && !notification.is_read
      ).length,
    [notifications]
  );

  const describeNotification = useCallback((notification?: Notification | null) => {
    if (!notification) {
      return {
        title: 'Notification',
        message: 'Une nouvelle activité vient d\'être enregistrée.',
        icon: '🔔',
        colors: ['#0f172a', '#1e293b'],
      } as const;
    }

    const data = notification.notification_data || {};
    switch (notification.notification_type) {
      case 'gift_received':
        return {
          title: 'Nouveau cadeau',
          message: `${data.sender_name || 'Un membre'} vous a offert ${data.boom_title || 'un BOOM'}.`,
          icon: '🎁',
          colors: ['#7c3aed', '#a855f7'],
        } as const;
      case 'gift_accepted':
        return {
          title: 'Cadeau accepté',
          message: `${data.receiver_name || 'Votre contact'} vient d'accepter votre cadeau.`,
          icon: '🎉',
          colors: ['#22c55e', '#4ade80'],
        } as const;
      case 'gift_declined':
        return {
          title: 'Cadeau refusé',
          message: `${data.receiver_name || 'Le destinataire'} n'a pas validé le cadeau.`,
          icon: '⚠️',
          colors: ['#f97316', '#fb7185'],
        } as const;
      default:
        return {
          title: notification.title || 'Notification',
          message:
            notification.message ||
            'Une nouvelle activité vient d\'être enregistrée.',
          icon: '🔔',
          colors: ['#0ea5e9', '#6366f1'],
        } as const;
    }
  }, []);

  const toastMeta = useMemo(() => describeNotification(activeToast), [activeToast, describeNotification]);

  const hideToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    Animated.timing(toastAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setActiveToast(null);
    });
  }, [toastAnim]);

  const triggerToast = useCallback(
    (notification: Notification) => {
      setActiveToast(notification);
      requestAnimationFrame(() => {
        toastAnim.stopAnimation();
        toastAnim.setValue(0);
        Animated.spring(toastAnim, {
          toValue: 1,
          damping: 14,
          stiffness: 180,
          mass: 0.6,
          useNativeDriver: true,
        }).start();
      });

      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      toastTimeoutRef.current = setTimeout(() => {
        hideToast();
      }, 4800);
    },
    [hideToast, toastAnim]
  );

  const triggerBellAnimation = useCallback(() => {
    bellAnim.stopAnimation();
    bellAnim.setValue(0);
    Animated.sequence([
      Animated.timing(bellAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(bellAnim, {
        toValue: -1,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.spring(bellAnim, {
        toValue: 0,
        friction: 4,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [bellAnim]);

  const playBellSound = useCallback(async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.replayAsync();
        return;
      }
      const { sound } = await Audio.Sound.createAsync(
        require('../assets/sounds/notification-chime.wav')
      );
      soundRef.current = sound;
      await sound.playAsync();
    } catch (error) {
      console.warn('⚠️ [DASHBOARD] Impossible de jouer le son de notification', error);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => undefined);
        soundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!notifications.length) {
      return;
    }
    const target = notifications.find(notification => !notification.is_read) || notifications[0];
    if (!target) {
      return;
    }
    const signature = `${target.id}-${target.is_read ? 'read' : 'unread'}`;
    if (!bootstrappedNotificationsRef.current) {
      bootstrappedNotificationsRef.current = true;
      lastToastSignatureRef.current = signature;
      return;
    }
    if (signature === lastToastSignatureRef.current) {
      return;
    }
    lastToastSignatureRef.current = signature;
    triggerToast(target);
    triggerBellAnimation();
    playBellSound();
  }, [notifications, playBellSound, triggerBellAnimation, triggerToast]);

  const handleToastPress = useCallback(() => {
    if (!activeToast) {
      return;
    }
    if (activeToast.notification_type?.startsWith('gift')) {
      const targetGiftId = activeToast.related_entity_id || activeToast.notification_data?.gift_id;
      navigation.navigate('GiftInbox', targetGiftId ? { focusOnGiftId: targetGiftId } : undefined);
    }
    hideToast();
  }, [activeToast, hideToast, navigation]);

  // 1. 🔥 CORRECTION du useEffect initial
  useEffect(() => {
    console.log('📊 [DASHBOARD] Effet de chargement déclenché');
    console.log('📊 [DASHBOARD] État auth:', { 
      user: !!user, 
      isAuthenticated,
      userPhone: user?.phone 
    });
    
    // 🔥 CORRECTION: Ne charger QUE si authentifié
    if (user && isAuthenticated) {
      console.log('📊 [DASHBOARD] Chargement des données pour user:', user.id);
      loadDashboardData();
    } else {
      // Réinitialiser si déconnecté
      console.log('📊 [DASHBOARD] Pas d\'utilisateur, reset données');
      setInventory([]);
      setTotalCollectionValue(0);
      setAverageSocialScore(0);
      setCollectionBaseValue(0);
      setCollectionDeltaValue(0);
      setCollectionDeltaPercent(0);
      setLoading(false);
      hasLoadedOnceRef.current = false;
    }
  }, [user?.id, isAuthenticated, loadDashboardData]);

  useFocusEffect(
    useCallback(() => {
      if (!user || !isAuthenticated || !hasLoadedOnceRef.current) {
        return;
      }
      console.log('🔄 [DASHBOARD] Rafraîchissement via focus screen');
      loadDashboardData({ silent: true });
    }, [user?.id, isAuthenticated, loadDashboardData])
  );

  useEffect(() => {
    if (!user || !isAuthenticated) {
      return;
    }

    const shouldRefreshFromReason = (value: unknown) => {
      if (typeof value !== 'string') {
        return false;
      }
      const normalized = value.toLowerCase();
      const keywords = ['gift', 'inventory', 'boom', 'market', 'purchase', 'sell', 'transfer', 'wallet', 'balance'];
      return keywords.some(keyword => normalized.includes(keyword));
    };

    const triggerSilentReload = () => {
      if (!hasLoadedOnceRef.current) {
        return;
      }
      console.log('🔁 [DASHBOARD] Rafraîchissement via WebSocket');
      loadDashboardData({ silent: true });
    };

    const unsubscribe = boomsWebSocket.onUpdate((event: any) => {
      if (!event) {
        return;
      }

      if (event.type === 'state_invalidation' && shouldRefreshFromReason(event.reason)) {
        triggerSilentReload();
        return;
      }

      if (event.type === 'market_update') {
        if (event.buyer_id === user.id || event.seller_id === user.id) {
          triggerSilentReload();
        }
        return;
      }

      if (event.type === 'user_notification') {
        const notifType = event.notification_type || event.data?.notification_type;
        if (shouldRefreshFromReason(notifType)) {
          triggerSilentReload();
        }
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [user?.id, isAuthenticated, loadDashboardData]);

  const loadDashboardData = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    try {
      if (!silent) {
        setLoading(true);
      }
      console.log('📊 [DASHBOARD] Début chargement données');

      const inventoryData = await purchaseService.getInventory().catch(err => {
        console.warn('⚠️ [DASHBOARD] Erreur inventaire:', err);
        return [];
      });

      setInventory(inventoryData || []);

      if (inventoryData && inventoryData.length > 0) {
        const {
          totalSum,
          averageScore,
          baseSum,
          deltaValue,
          deltaPercent
        } = summarizeCollection(inventoryData);

        setTotalCollectionValue(totalSum);
        setAverageSocialScore(averageScore);
        setCollectionBaseValue(baseSum);
        setCollectionDeltaValue(deltaValue);
        setCollectionDeltaPercent(deltaPercent);
      } else {
        setTotalCollectionValue(0);
        setAverageSocialScore(0);
        setCollectionBaseValue(0);
        setCollectionDeltaValue(0);
        setCollectionDeltaPercent(0);
      }

    } catch (error) {
      console.error('❌ [DASHBOARD] Erreur chargement:', error);
      Alert.alert(
        'Erreur',
        'Impossible de charger les données du dashboard. Veuillez réessayer.'
      );
    } finally {
      if (!silent) {
        setLoading(false);
      }
      setRefreshing(false);
      hasLoadedOnceRef.current = true;
      console.log('📊 [DASHBOARD] Chargement terminé');
    }
  }, []);

  // 2. 🔥 CORRECTION de la méthode onRefresh - Supprimer refreshAllBalances
  const onRefresh = async () => {
    console.log('🔄 [DASHBOARD] Rafraîchissement manuel');
    setRefreshing(true);
    
    try {
      // 🔥 CORRECTION: Vérifier l'authentification AVANT refresh
      if (user && isAuthenticated) {
        console.log('🔄 [DASHBOARD] User authentifié, lancement refresh');
        
        // ✅ CORRECTION: NE PAS forcer refresh si WebSocket est actif
        // Le WS enverra les soldes à jour
        await loadDashboardData({ silent: true });
        console.log('✅ [DASHBOARD] Données rafraîchies (sans écraser WS)');
      } else {
        console.warn('⚠️ [DASHBOARD] Refresh ignoré: utilisateur non authentifié');
      }
    } catch (error) {
      console.error('❌ [DASHBOARD] Erreur refresh:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const formatCurrency = (value: any) => {
    const num = safeNumber(value);
    return parseFloat(num.toFixed(4)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  };

  const formatDeltaLabel = (value: number, percent: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(percent)) {
      return 'Aucun historique';
    }
    const valueSign = value >= 0 ? '+' : '−';
    const percentSign = percent >= 0 ? '+' : '−';
    return `${valueSign}${formatCurrency(Math.abs(value))} FCFA (${percentSign}${Math.abs(percent).toFixed(1)}%)`;
  };

  const renderLoading = () => (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#667eea" />
      <Text style={styles.loadingText}>Chargement des données...</Text>
    </View>
  );

  if (loading && !refreshing) {
    return renderLoading();
  }

  const bellRotate = bellAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-18deg', '0deg', '18deg'],
  });
  const bellScale = bellAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [1, 1.05, 1],
  });
  const toastTranslateY = toastAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
  });
  const toastScale = toastAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView 
        style={styles.container}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            colors={['#667eea']}
            tintColor="#667eea"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity 
              style={styles.profileButton}
              onPress={() => navigation.navigate('Profile')}
            >
              <Text style={styles.profileIcon}>👤</Text>
              <View style={styles.profileInfo}>
                <Text style={styles.welcomeTitle}>Salut {firstName}</Text>
                <Text style={styles.welcomeSubtitle}>Bienvenue sur votre tableau de bord</Text>
                <Text style={styles.marketSubtitle}>Le marché financier Booms vous est ouvert.</Text>
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.notificationButton}
              onPress={() => navigation.navigate('GiftInbox')}
              activeOpacity={0.85}
            >
              <Animated.View
                style={[
                  styles.notificationBell,
                  { transform: [{ rotate: bellRotate }, { scale: bellScale }] },
                ]}
              >
                <Text style={styles.notificationIcon}>🔔</Text>
              </Animated.View>
              {unreadCount > 0 && (
                <View style={styles.notificationBadge}>
                  <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
              )}
              {giftAlertCount > 0 && (
                <View style={styles.giftIndicator}>
                  <Text style={styles.giftIndicatorText}>🎁 {giftAlertCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {activeToast && toastMeta && (
          <Animated.View
            style={[
              styles.notificationToast,
              {
                opacity: toastAnim,
                transform: [
                  { translateY: toastTranslateY },
                  { scale: toastScale },
                ],
              },
            ]}
          >
            <TouchableOpacity activeOpacity={0.9} onPress={handleToastPress}>
              <LinearGradient colors={toastMeta.colors as [string, string]} style={styles.toastInner}>
                <View style={styles.toastIconWrap}>
                  <Text style={styles.toastIcon}>{toastMeta.icon}</Text>
                </View>
                <View style={styles.toastTextWrapper}>
                  <Text style={styles.toastTitle}>{toastMeta.title}</Text>
                  <Text style={styles.toastBody}>{toastMeta.message}</Text>
                </View>
                <TouchableOpacity style={styles.toastClose} onPress={hideToast}>
                  <Text style={styles.toastCloseText}>✕</Text>
                </TouchableOpacity>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        )}

        <View style={styles.statsSection}>
          <Text style={styles.statsTitle}>Aperçu financier</Text>
          <View style={styles.statsGrid}>
            
            <TouchableOpacity 
              style={styles.statCard}
              onPress={() => {
                navigation.navigate('Wallet');
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.statIconContainer, { backgroundColor: '#d1fae5' }]}>
                <Text style={styles.statIcon}>💳</Text>
              </View>
              <Text style={styles.statLabel}>Solde réel</Text>
              {walletLoading ? (
                <ActivityIndicator size="small" color="#1A1A1A" />
              ) : (
                // 3. 🔥 CORRECTION d'affichage: utiliser cashBalance au lieu de usableBalance
                <Text style={[styles.statValue, { color: '#059669' }]}>
                  {formatCurrency(cashBalance)} FCFA
                </Text>
              )}
              <Text style={styles.statHint}>Pour achats BOOM</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.statCard}
              onPress={() => navigation.navigate('Inventory')}
              activeOpacity={0.7}
            >
              <View style={[styles.statIconContainer, { backgroundColor: '#fef3c7' }]}>
                <Text style={styles.statIcon}>🖼️</Text>
              </View>
              <Text style={styles.statLabel}>Valeur collection</Text>
              <Text style={[styles.statValue, { color: '#d97706' }]}>
                {formatCurrency(totalCollectionValue)} FCFA
              </Text>
              <Text style={styles.statHint}>{inventory.length} œuvre{inventory.length > 1 ? 's' : ''}</Text>
              {collectionBaseValue > 0 ? (
                <Text
                  style={[
                    styles.statDelta,
                    collectionDeltaValue >= 0 ? styles.gainText : styles.lossText
                  ]}
                >
                  {formatDeltaLabel(collectionDeltaValue, collectionDeltaPercent)}
                </Text>
              ) : (
                <Text style={styles.statHint}>En attente de vos premiers achats</Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.statCard}
              onPress={() => {
                Alert.alert(
                  '🎁 Redistributions',
                  `Vous avez ${formatCurrency(virtualBalance)} FCFA en redistributions.\n\n` +
                  `Ces fonds virtuels proviennent des partages sociaux et seront ` +
                  `activés dans une prochaine version de l'application.\n\n` +
                  `💡 Les achats utilisent uniquement le solde réel.`
                );
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.statIconContainer, { backgroundColor: '#f3e8ff' }]}>
                <Text style={styles.statIcon}>🎁</Text>
              </View>
              <Text style={styles.statLabel}>Redistributions</Text>
              <Text style={[styles.statValue, { color: '#7c3aed' }]}>
                {formatCurrency(virtualBalance)} FCFA
              </Text>
              <Text style={styles.statHint}>Virtuel</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerText}>
              💡 <Text style={{ fontWeight: 'bold' }}>Seul le solde réel</Text> est utilisable pour les achats.
              Les redistributions sont des fonds virtuels.
            </Text>
          </View>
          
          {/* 4. 🔥 CORRECTION du bouton "Voir détails des soldes" */}
          <TouchableOpacity 
            style={styles.checkBalanceButton}
            onPress={async () => {
              console.log('🔍 [DASHBOARD] Vérification détaillée:', {
                cashBalance,
                virtualBalance,
                usableBalance,
                totalBalance: cashBalance + virtualBalance,
                canBuy5000: hasSufficientFunds ? hasSufficientFunds(5000) : false
              });
              
              try {
                await requestBackendSync('dashboard-balance-details');
              } catch (error) {
                console.warn('⚠️ [DASHBOARD] Resync ignorée (balance details):', error);
              }
              
              Alert.alert(
                '💼 Détails des soldes',
                `**Solde Réel (Cash):** ${formatCurrency(cashBalance)} FCFA\n` +
                `**→ Disponible pour achats:** ${formatCurrency(cashBalance)} FCFA\n\n` +
                `**Solde Virtuel:** ${formatCurrency(virtualBalance)} FCFA\n` +
                `_Fonds de redistributions uniquement_\n\n` +
                `**Total:** ${formatCurrency(cashBalance + virtualBalance)} FCFA\n\n` +
                `**Valeur collection:** ${formatCurrency(totalCollectionValue)} FCFA\n\n` +
                `**⚠️ Important:** Seul le solde réel (${formatCurrency(cashBalance)} FCFA) peut être utilisé pour les achats.`
              );
            }}
          >
            <Text style={styles.checkBalanceText}>📊 Voir détails des soldes</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.sectionCard}
          onPress={() => navigation.navigate('Inventory')}
          activeOpacity={0.7}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Collection</Text>
            <Text style={styles.sectionAction}>Voir tout →</Text>
          </View>
          
          {loading ? (
            <ActivityIndicator size="small" color="#666666" />
          ) : (
            <>
              <View style={styles.collectionStats}>
                <View style={styles.collectionStat}>
                  <Text style={styles.collectionStatNumber}>{inventory.length}</Text>
                  <Text style={styles.collectionStatLabel}>Œuvres totales</Text>
                </View>
                <View style={styles.collectionStat}>
                  <Text style={styles.collectionStatNumber}>{formatCurrency(totalCollectionValue)}</Text>
                  <Text style={styles.collectionStatLabel}>Valeur totale</Text>
                  {collectionBaseValue > 0 && (
                    <Text
                      style={[
                        styles.collectionStatDelta,
                        collectionDeltaValue >= 0 ? styles.gainText : styles.lossText
                      ]}
                    >
                      {formatDeltaLabel(collectionDeltaValue, collectionDeltaPercent)}
                    </Text>
                  )}
                </View>
                <View style={styles.collectionStat}>
                  <Text style={styles.collectionStatNumber}>{averageSocialScore.toFixed(2)}</Text>
                  <Text style={styles.collectionStatLabel}>Score moyen</Text>
                </View>
                <View style={styles.collectionStat}>
                  <Text style={styles.collectionStatNumber}>
                    {new Set(inventory.map(item => safeGet(item, 'bom_asset.artist', ''))).size}
                  </Text>
                  <Text style={styles.collectionStatLabel}>Artistes</Text>
                </View>
              </View>
              
              <Text style={styles.sectionSubtitle}>
                {`Dernière acquisition: ${inventory.length > 0 ? 
                  new Date(inventory[0]?.acquired_at).toLocaleDateString('fr-FR') : 
                  'Aucune'}\nPerformance vs achat: ${collectionBaseValue > 0
                  ? formatDeltaLabel(collectionDeltaValue, collectionDeltaPercent)
                  : 'En attente de données'}`}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Actions rapides</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('Deposit')}
              activeOpacity={0.7}
            >
              <Text style={styles.actionIcon}>+</Text>
              <Text style={styles.actionText}>Dépôt</Text>
              <Text style={styles.actionHint}>Remplir solde réel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('Withdrawal')}
              activeOpacity={0.7}
            >
              <Text style={styles.actionIcon}>−</Text>
              <Text style={styles.actionText}>Retrait</Text>
              <Text style={styles.actionHint}>Retirer argent réel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('Catalogue')}
              activeOpacity={0.7}
            >
              <Text style={styles.actionIcon}>⌘</Text>
              <Text style={styles.actionText}>Galerie</Text>
              <Text style={styles.actionHint}>Acheter BOOM</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={async () => {
                try {
                  await requestBackendSync('dashboard-wallet-shortcut');
                } catch (error) {
                  console.warn('⚠️ [DASHBOARD] Resync ignorée (shortcut):', error);
                }
                navigation.navigate('Wallet');
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.actionIcon}>💰</Text>
              <Text style={styles.actionText}>Portefeuille</Text>
              <Text style={styles.actionHint}>Voir soldes</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('SupportCenter')}
              activeOpacity={0.7}
            >
              <Text style={styles.actionIcon}>🛟</Text>
              <Text style={styles.actionText}>Support</Text>
              <Text style={styles.actionHint}>Contacter l'équipe</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Découvrir</Text>
          <View style={styles.discoveryGrid}>
            <TouchableOpacity 
              style={styles.discoveryCard}
              onPress={() => navigation.navigate('Catalogue', { filter: 'ultra_rare' })}
              activeOpacity={0.7}
            >
              <Text style={styles.discoveryIcon}>◆</Text>
              <Text style={styles.discoveryTitle}>Ultra Rare</Text>
              <Text style={styles.discoverySubtitle}>Rareté élite</Text>
              <Text style={styles.discoveryHint}>Rare & Ultra Rare</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.discoveryCard}
              onPress={() => navigation.navigate('Catalogue', { filter: 'viral' })}
              activeOpacity={0.7}
            >
              <Text style={styles.discoveryIcon}>🔥</Text>
              <Text style={styles.discoveryTitle}>Viral</Text>
              <Text style={styles.discoverySubtitle}>Impact social</Text>
              <Text style={styles.discoveryHint}>Valeur sociale élevée</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.discoveryCard}
              onPress={() => navigation.navigate('Catalogue', { filter: 'trending' })}
              activeOpacity={0.7}
            >
              <Text style={styles.discoveryIcon}>📈</Text>
              <Text style={styles.discoveryTitle}>Trending</Text>
              <Text style={styles.discoverySubtitle}>Hausse soutenue</Text>
              <Text style={styles.discoveryHint}>Croissance > 8%</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.discoveryCard}
              onPress={() => navigation.navigate('Catalogue', { filter: 'nouveau' })}
              activeOpacity={0.7}
            >
              <Text style={styles.discoveryIcon}>🆕</Text>
              <Text style={styles.discoveryTitle}>Nouveau</Text>
              <Text style={styles.discoverySubtitle}>Nouvelles sorties</Text>
              <Text style={styles.discoveryHint}>Derniers 15 jours</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Informations compte</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Téléphone:</Text>
            <Text style={styles.infoValue}>{user?.phone || 'Non renseigné'}</Text>
          </View>
          {user?.email && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email:</Text>
              <Text style={styles.infoValue}>{user.email}</Text>
            </View>
          )}
          
          <View style={styles.balanceInfoSection}>
            <Text style={styles.balanceInfoTitle}>Soldes actuels</Text>
            <View style={styles.balanceInfoRow}>
              <Text style={styles.balanceInfoLabel}>Réel:</Text>
              <Text style={[styles.balanceInfoValue, { color: '#059669' }]}>
                {formatCurrency(cashBalance)} FCFA
              </Text>
            </View>
            <View style={styles.balanceInfoRow}>
              <Text style={styles.balanceInfoLabel}>Virtuel:</Text>
              <Text style={[styles.balanceInfoValue, { color: '#7c3aed' }]}>
                {formatCurrency(virtualBalance)} FCFA
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.walletLink}
              onPress={async () => {
                try {
                  await requestBackendSync('dashboard-wallet-link');
                } catch (error) {
                  console.warn('⚠️ [DASHBOARD] Resync ignorée (wallet link):', error);
                }
                navigation.navigate('Wallet');
              }}
            >
              <Text style={styles.walletLinkText}>Gérer mon portefeuille →</Text>
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity 
            style={styles.logoutButton}
            onPress={logout}
          >
            <Text style={styles.logoutText}>Se déconnecter</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Les styles restent exactement les mêmes que dans ton fichier original
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAFAFA' },
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAFAFA' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  header: { backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileButton: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  profileIcon: { fontSize: 26, marginRight: 10 },
  profileInfo: { justifyContent: 'center', flex: 1 },
  welcomeTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  welcomeSubtitle: { fontSize: 12, color: '#4b5563', marginTop: 2 },
  marketSubtitle: { fontSize: 12, color: '#1d4ed8', marginTop: 2, fontWeight: '600' },
  notificationButton: { position: 'relative', padding: 8, alignItems: 'center', justifyContent: 'center' },
  notificationBell: { alignItems: 'center', justifyContent: 'center' },
  notificationIcon: { fontSize: 24 },
  notificationBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#D4AF37', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, minWidth: 20, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  giftIndicator: { position: 'absolute', bottom: -2, right: -8, backgroundColor: '#7c3aed', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#FFFFFF', shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 4 },
  giftIndicatorText: { color: '#FFFFFF', fontSize: 10, fontWeight: '600' },
  notificationToast: { marginHorizontal: 20, marginTop: 8, marginBottom: 8 },
  toastInner: { borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
  toastIconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  toastIcon: { fontSize: 24 },
  toastTextWrapper: { flex: 1 },
  toastTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  toastBody: { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 18 },
  toastClose: { padding: 6, marginLeft: 6 },
  toastCloseText: { color: 'rgba(255,255,255,0.75)', fontSize: 16 },
  statsSection: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
  statsTitle: { fontSize: 18, fontWeight: '600', color: '#1A1A1A', marginBottom: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { flex: 1, minWidth: '30%', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 3, alignItems: 'center', borderWidth: 1, borderColor: '#F0F0F0' },
  statIconContainer: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  statIcon: { fontSize: 24 },
  statLabel: { fontSize: 12, color: '#666666', marginBottom: 8, textAlign: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', textAlign: 'center' },
  statHint: { fontSize: 10, color: '#999999', marginTop: 8, textAlign: 'center' },
  statDelta: { fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  gainText: { color: '#059669' },
  lossText: { color: '#dc2626' },
  infoBanner: { backgroundColor: '#f0f9ff', padding: 12, borderRadius: 8, marginTop: 16, borderWidth: 1, borderColor: '#bae6fd' },
  infoBannerText: { fontSize: 12, color: '#0369a1', textAlign: 'center', lineHeight: 16 },
  checkBalanceButton: { backgroundColor: '#f1f5f9', padding: 12, borderRadius: 8, marginTop: 12, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  checkBalanceText: { color: '#4a5568', fontSize: 13, fontWeight: '500' },
  sectionCard: { backgroundColor: '#FFFFFF', marginHorizontal: 20, marginTop: 16, marginBottom: 16, padding: 20, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1A1A1A' },
  sectionAction: { fontSize: 14, color: '#667eea', fontWeight: '500' },
  sectionSubtitle: { fontSize: 14, color: '#666666', marginTop: 12 },
  collectionStats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  collectionStat: { alignItems: 'center', flex: 1 },
  collectionStatNumber: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', marginBottom: 4 },
  collectionStatLabel: { fontSize: 11, color: '#666666', textAlign: 'center' },
  collectionStatDelta: { fontSize: 11, fontWeight: '600', marginTop: 4, textAlign: 'center' },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  actionButton: { flex: 1, minWidth: '22%', backgroundColor: '#F8F8F8', padding: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#F0F0F0' },
  actionIcon: { fontSize: 24, color: '#667eea', marginBottom: 8 },
  actionText: { fontSize: 12, color: '#666666', textAlign: 'center', fontWeight: '600' },
  actionHint: { fontSize: 10, color: '#999999', marginTop: 4, textAlign: 'center' },
  discoveryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  discoveryCard: { flex: 1, minWidth: '45%', backgroundColor: '#F8F8F8', padding: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#F0F0F0' },
  discoveryIcon: { fontSize: 24, color: '#1A1A1A', marginBottom: 8 },
  discoveryTitle: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', textAlign: 'center', marginBottom: 4 },
  discoverySubtitle: { fontSize: 11, color: '#666666', textAlign: 'center' },
  discoveryHint: { fontSize: 10, color: '#9ca3af', textAlign: 'center', marginTop: 4 },
  infoCard: { backgroundColor: '#FFFFFF', marginHorizontal: 20, marginBottom: 32, marginTop: 16, padding: 20, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  infoTitle: { fontSize: 16, fontWeight: '600', color: '#1A1A1A', marginBottom: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  infoLabel: { fontSize: 14, color: '#666666' },
  infoValue: { fontSize: 14, fontWeight: '500', color: '#1A1A1A' },
  balanceInfoSection: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 12, marginTop: 20, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  balanceInfoTitle: { fontSize: 14, fontWeight: '600', color: '#4a5568', marginBottom: 12 },
  balanceInfoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  balanceInfoLabel: { fontSize: 13, color: '#718096' },
  balanceInfoValue: { fontSize: 13, fontWeight: '600' },
  walletLink: { marginTop: 12, padding: 10, backgroundColor: '#edf2f7', borderRadius: 8, alignItems: 'center' },
  walletLinkText: { color: '#4c51bf', fontSize: 12, fontWeight: '600' },
  logoutButton: { backgroundColor: '#F3F4F6', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20, borderWidth: 1, borderColor: '#E5E7EB' },
  logoutText: { color: '#666666', fontSize: 15, fontWeight: '600' },
});
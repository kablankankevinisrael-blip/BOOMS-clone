import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
  StyleSheet,
  RefreshControl,
  SafeAreaView,
} from 'react-native';

import {
  giftService,
  GiftInboxEntry,
  GiftInboxResponse
} from '../services/gift';
import { boomsWebSocket } from '../services/websocket';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import {
  computeCapProgress,
  describeMicroInfluence,
  formatCompactCurrency,
  getNextMilestone
} from '../utils/stabilization';
import { interactionsService, InteractionStatsSummary } from '../services/interactions';

interface GiftInboxScreenProps {
  navigation: any;
  route?: any;
}

const GiftInboxScreen: React.FC<GiftInboxScreenProps> = ({ navigation, route }) => {
  const { user } = useAuth();
  const { refreshNotifications, markAsRead, notifications } = useNotifications();

  type GiftTab = 'received' | 'sent' | 'pending';

  const [inboxData, setInboxData] = useState<GiftInboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<GiftTab>('received');
  const [selectedGiftId, setSelectedGiftId] = useState<number | null>(null);
  const lastRealtimeSyncRef = useRef<number>(Date.now());
  const refreshNotificationsRef = useRef(refreshNotifications);
  const statsCacheRef = useRef<Record<number, InteractionStatsSummary>>({});
  const [interactionStatsMap, setInteractionStatsMap] = useState<Record<number, InteractionStatsSummary>>({});

  useEffect(() => {
    refreshNotificationsRef.current = refreshNotifications;
  }, [refreshNotifications]);

  const applyInteractionStats = useCallback((statsList: InteractionStatsSummary[]) => {
    if (!statsList.length) {
      return;
    }
    setInteractionStatsMap(prev => {
      const next = { ...prev };
      statsList.forEach(stats => {
        next[stats.boomId] = stats;
      });
      statsCacheRef.current = next;
      return next;
    });
  }, [prefetchGiftStats]);

  const prefetchGiftStats = useCallback(async (payload: GiftInboxResponse | null) => {
    if (!payload?.lists) {
      return;
    }
    const boomIds = new Set<number>();
    (['received', 'sent', 'pending'] as const).forEach(key => {
      const list = payload.lists[key] || [];
      list.forEach(entry => {
        if (entry.boom?.id) {
          boomIds.add(entry.boom.id);
        }
      });
    });
    if (!boomIds.size) {
      return;
    }
    const missingIds = Array.from(boomIds).filter(id => !statsCacheRef.current[id]);
    if (!missingIds.length) {
      return;
    }
    const toFetch = missingIds.slice(0, 10);
    const responses = await Promise.allSettled(
      toFetch.map(id => interactionsService.getStatsSummary(id))
    );
    const resolved = responses
      .filter((res): res is PromiseFulfilledResult<InteractionStatsSummary> => res.status === 'fulfilled')
      .map(res => res.value);
    applyInteractionStats(resolved);
  }, [applyInteractionStats]);

  const loadGifts = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    try {
      if (!silent) {
        setLoading(true);
      }
      const data = await giftService.getGiftInbox();
      setInboxData(data);
      prefetchGiftStats(data);
      if (refreshNotificationsRef.current) {
        await refreshNotificationsRef.current();
      }
      lastRealtimeSyncRef.current = Date.now();
    } catch (error) {
      console.error('Erreur chargement cadeaux:', error);
      Alert.alert('Erreur', error instanceof Error ? error.message : 'Impossible de charger les cadeaux');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadGifts();
  }, [loadGifts]);

  useEffect(() => {
    if (route?.params?.focusOnGiftId) {
      const focusOnGiftId = route.params.focusOnGiftId;
      if (focusOnGiftId) {
        setSelectedGiftId(focusOnGiftId);
        setActiveTab('received');
        
        // Marquer la notification correspondante comme lue
        const giftNotification = notifications.find(n => 
          n.notification_type === 'gift_received' && 
          (n.related_entity_id === focusOnGiftId || n.notification_data?.gift_id === focusOnGiftId)
        );
        if (giftNotification) {
          markAsRead(giftNotification.id);
        }
      }
    }
  }, [route?.params, notifications]);

  useEffect(() => {
    const unsubscribe = boomsWebSocket.onUpdate((event: any) => {
      if (!event) {
        return;
      }
      if (event.type === 'user_notification') {
        const notifType = event.notification_type || event.data?.notification_type;
        if (notifType && notifType.startsWith('gift_')) {
          loadGifts({ silent: true });
        }
      }
      if (event.type === 'state_invalidation' && typeof event.reason === 'string' && event.reason.includes('gift')) {
        loadGifts({ silent: true });
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [loadGifts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadGifts({ silent: true });
    setRefreshing(false);
  };

  const handleAcceptGift = async (giftId: number) => {
    try {
      await giftService.acceptGift(giftId);
      Alert.alert('Succès', 'Cadeau accepté!');
      await loadGifts();
    } catch (error: any) {
      const message = error.response?.data?.detail || error.message || 'Erreur lors de l\'acceptation';
      Alert.alert('Erreur', message);
    }
  };

  const handleDeclineGift = async (giftId: number) => {
    Alert.alert(
      'Confirmer le refus',
      'Êtes-vous sûr de vouloir refuser ce cadeau ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: async () => {
            try {
              await giftService.declineGift(giftId);
              Alert.alert('Succès', 'Cadeau refusé');
              await loadGifts();
            } catch (error: any) {
              const message = error.response?.data?.detail || error.message || 'Erreur lors du refus';
              Alert.alert('Erreur', message);
            }
          },
        },
      ]
    );
  };

  const isGiftActionable = (gift: GiftInboxEntry): boolean => {
    const actionableTab = activeTab === 'received' || activeTab === 'pending';
    return actionableTab && (gift.actions.can_accept || gift.actions.can_decline);
  };

  const getToneColor = (tone: GiftInboxEntry['status_tone']) => {
    switch (tone) {
      case 'success':
        return '#10B981';
      case 'danger':
        return '#EF4444';
      case 'muted':
        return '#6B7280';
      default:
        return '#3B82F6';
    }
  };

  const getStatusIcon = (tone: GiftInboxEntry['status_tone'], status: string) => {
    if (tone === 'success') return '✅';
    if (tone === 'danger') return status === 'FAILED' ? '⚠️' : '❌';
    if (tone === 'muted') return '⏰';
    return status === 'SENT' ? '📨' : 'ℹ️';
  };

  const getStatusDisplay = (gift: GiftInboxEntry) => {
    if (gift.direction === 'outgoing') {
      const receiverName = gift.people.receiver.name;
      if (gift.status === 'DELIVERED' || gift.status === 'ACCEPTED') {
        return {
          label: `Accepté par ${receiverName}`,
          color: '#16A34A'
        };
      }
      if (gift.status === 'DECLINED' || gift.status === 'FAILED') {
        return {
          label: `Refusé par ${receiverName}`,
          color: '#DC2626'
        };
      }
      if (gift.status === 'PAID' || gift.status === 'SENT') {
        return {
          label: 'En attente de réponse',
          color: '#F97316'
        };
      }
    }

    if (gift.direction === 'incoming') {
      if (gift.status === 'DELIVERED' || gift.status === 'ACCEPTED') {
        return { label: 'Cadeau accepté', color: '#16A34A' };
      }
      if (gift.status === 'DECLINED' || gift.status === 'FAILED') {
        return { label: 'Cadeau refusé', color: '#DC2626' };
      }
      if (gift.status === 'PAID' || gift.status === 'SENT') {
        return { label: 'En attente d’action', color: '#F97316' };
      }
    }

    return {
      label: gift.status_label,
      color: getToneColor(gift.status_tone)
    };
  };

  const formatCurrency = (value?: number | null) => {
    if (value === undefined || value === null) {
      return '--';
    }
    const normalized = parseFloat((value).toFixed(4));
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XAF',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(normalized);
  };

  const formatCount = (value?: number | null) => {
    if (value === undefined || value === null) {
      return '0';
    }
    const safeValue = Number.isFinite(value) ? value : Number(value);
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(safeValue || 0)));
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) {
      return '';
    }
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  const toNumber = (value?: number | null): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return 0;
  };

  const preferNumber = (...candidates: Array<number | null | undefined>): number => {
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
    }
    return 0;
  };

  const getGiftValueBreakdown = (gift: GiftInboxEntry) => {
    const baseValue = Math.max(0, preferNumber(
      gift.financial?.estimated_value,
      gift.financial?.net_amount,
      gift.financial?.gross_amount
    ));
    const totalCandidate = Math.max(0, preferNumber(
      gift.social?.current_market_value,
      gift.financial?.net_amount,
      gift.financial?.gross_amount,
      baseValue
    ));
    const microValue = Math.max(0, preferNumber(
      gift.social?.social_value,
      totalCandidate - baseValue
    ));
    const totalValue = Math.max(totalCandidate, baseValue + microValue);
    return { baseValue, microValue, totalValue };
  };

  const getStabilizationSnapshot = (gift: GiftInboxEntry) => {
    const social = gift.social || null;
    const marketCap = toNumber(social?.market_capitalization);
    const effectiveCap = toNumber(social?.effective_capitalization ?? social?.market_capitalization);
    const redistributionPool = toNumber(social?.redistribution_pool);
    const capUnits = toNumber(social?.capitalization_units);
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

  const renderGiftItem = ({ item }: { item: GiftInboxEntry }) => {
    const statusDisplay = getStatusDisplay(item);
    const statusColor = statusDisplay.color;
    const actorLabel = item.direction === 'incoming'
      ? `De : ${item.people.sender.name}`
      : `À : ${item.people.receiver.name}`;
    const feeValue = item.financial.fee_amount ?? null;
    const { baseValue, microValue, totalValue } = getGiftValueBreakdown(item);
    const stabilization = getStabilizationSnapshot(item);
    const showStabilization = stabilization.marketCap > 0 || stabilization.capUnits > 0 || stabilization.redistributionPool > 0;
    const boomId = item.boom?.id ?? null;
    const boomStats = boomId ? interactionStatsMap[boomId] : null;
    const likeCount = boomStats?.totalLikes ?? 0;
    const socialShares = boomStats?.totalSocialShares ?? item.social?.share_count ?? 0;
    const internalShares = boomStats?.totalInternalShares ?? 0;
    const interactionsCount = boomStats?.totalInteractions ?? item.social?.interaction_count ?? 0;
    const last24hSocialShares = boomStats?.last24hSocialShares ?? 0;
    const last24hInternalShares = boomStats?.last24hInternalShares ?? 0;
    const uniqueFans = boomStats?.uniqueUsers ?? 0;

    return (
      <TouchableOpacity
        style={[
          styles.giftCard,
          selectedGiftId === item.id && styles.selectedGiftCard,
          item.highlight_pending && styles.pendingGlow
        ]}
        activeOpacity={0.7}
        onPress={() => {
          setSelectedGiftId(item.id);
          navigation.navigate('GiftDetails', { giftId: item.id });
        }}
      >
        <View style={styles.giftHeader}>
          {item.boom?.preview_image ? (
            <Image source={{ uri: item.boom.preview_image }} style={styles.giftImage} />
          ) : (
            <View style={[styles.giftImage, styles.imagePlaceholder]}>
              <Text style={styles.placeholderIcon}>🎁</Text>
            </View>
          )}

          <View style={styles.giftInfo}>
            <Text style={styles.giftTitle} numberOfLines={2}>
              {item.boom?.title || 'Cadeau sans titre'}
            </Text>
            <Text style={styles.giftPerson}>{actorLabel}</Text>
            <Text style={styles.giftDate}>{formatDate(item.timeline.sent_at)}</Text>
          </View>

          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}> 
            <Text style={[styles.statusIcon, { color: statusColor }]}> 
              {getStatusIcon(item.status_tone, item.status)}
            </Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricPill}>
            <Text style={styles.metricLabel}>Base</Text>
            <Text style={styles.metricValue}>{formatCurrency(baseValue)}</Text>
          </View>
          <View style={styles.metricPill}>
            <Text style={styles.metricLabel}>Bonus social</Text>
            <Text style={styles.metricValue}>{formatCurrency(microValue)}</Text>
          </View>
          <View style={styles.metricPill}>
            <Text style={styles.metricLabel}>Valeur totale</Text>
            <Text style={styles.metricValue}>{formatCurrency(totalValue)}</Text>
          </View>
          {feeValue !== null && (
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Frais</Text>
              <Text style={styles.metricValue}>{formatCurrency(feeValue)}</Text>
            </View>
          )}
        </View>

        {showStabilization && (
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
                ? 'Bouclier complet, influence micro verrouillée'
                : `Palier visé : ${formatCompactCurrency(stabilization.nextMilestone)}`}
            </Text>
            {stabilization.redistributionPool > 0 && (
              <Text style={styles.capShieldSub}>
                Redistribution: {formatCompactCurrency(stabilization.redistributionPool)}
              </Text>
            )}
            <Text style={styles.capShieldMicro}>
              {describeMicroInfluence(stabilization.capUnits)}
            </Text>
          </View>
        )}

        {item.message && (
          <View style={styles.messageContainer}>
            <Text style={styles.messageLabel}>Message :</Text>
            <Text style={styles.giftMessage}>&quot;{item.message}&quot;</Text>
          </View>
        )}

        {(item.social || boomStats) && (
          <View style={styles.socialRow}>
            <Text style={styles.socialText}>
              ❤️ {formatCount(likeCount)} likes · 🔁 {formatCount(socialShares)} partages RS · 🤝 {formatCount(internalShares)} partages internes
            </Text>
            <Text style={styles.socialSubText}>
              👥 {formatCount(uniqueFans)} fans actifs · +{formatCount(last24hSocialShares)} RS / 24h · +{formatCount(last24hInternalShares)} internes / 24h · {formatCount(interactionsCount)} interactions
            </Text>
          </View>
        )}

        {item.timeline.delivered_at && (
          <View style={styles.timelineRow}>
            <Text style={styles.timelineLabel}>Livré</Text>
            <Text style={styles.timelineValue}>{formatDate(item.timeline.delivered_at)}</Text>
          </View>
        )}

        {isGiftActionable(item) && (
          <View style={styles.actionsContainer}>
            {item.actions.can_accept && (
              <TouchableOpacity
                style={[styles.actionButton, styles.acceptButton]}
                onPress={() => handleAcceptGift(item.id)}
              >
                <Text style={styles.actionButtonText}>Accepter</Text>
              </TouchableOpacity>
            )}
            {item.actions.can_decline && (
              <TouchableOpacity
                style={[styles.actionButton, styles.declineButton]}
                onPress={() => handleDeclineGift(item.id)}
              >
                <Text style={styles.actionButtonText}>Refuser</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.giftFooter}>
          <Text style={[styles.statusText, { color: statusColor }]}> 
            {statusDisplay.label}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const summary = inboxData?.summary;
  const receivedTotals = useMemo(() => {
    if (!inboxData?.lists?.received?.length) {
      return { base: 0, micro: 0, total: 0 };
    }
    return inboxData.lists.received.reduce(
      (acc, gift) => {
        const breakdown = getGiftValueBreakdown(gift);
        return {
          base: acc.base + breakdown.baseValue,
          micro: acc.micro + breakdown.microValue,
          total: acc.total + breakdown.totalValue,
        };
      },
      { base: 0, micro: 0, total: 0 }
    );
  }, [inboxData]);
  const pendingCount = summary?.pending_count ?? 0;
  const activeList: GiftInboxEntry[] = inboxData?.lists[activeTab] ?? [];

  if (loading && !refreshing) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Chargement des cadeaux...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderSummary = () => {
    if (!summary) {
      return null;
    }
      const cards = [
      {
        id: 'pending',
        label: 'En attente',
        value: summary.pending_count.toString(),
        accent: summary.needs_attention ? '#F97316' : '#3B82F6'
      },
      {
        id: 'received_today',
        label: 'Reçus aujourd\'hui',
        value: summary.received_today.toString(),
        accent: '#10B981'
      },
      {
          id: 'value',
          label: 'Valeur totale reçue',
          value: formatCurrency(summary.total_value_received ?? receivedTotals.total),
        accent: '#6366F1'
      },
        {
          id: 'social_bonus',
          label: 'Bonus sociaux cumulés',
          value: formatCurrency(receivedTotals.micro),
          accent: '#A855F7'
        },
      {
        id: 'fees',
        label: 'Frais payés',
        value: formatCurrency(summary.total_fees_paid ?? 0),
        accent: '#EF4444'
      }
    ];
    return (
      <View style={styles.summaryGrid}>
        {cards.map((card) => (
          <View key={card.id} style={styles.summaryCard}>
            <Text style={[styles.summaryLabel, { color: card.accent }]}>{card.label}</Text>
            <Text style={styles.summaryValue}>{card.value}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.headerButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.headerButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Boîte aux cadeaux</Text>
        <View style={styles.headerButton} />
      </View>

      {renderSummary()}

      {/* Onglets */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'received' && styles.activeTab]}
          onPress={() => {
            setActiveTab('received');
            setSelectedGiftId(null);
          }}
        >
          <Text style={[styles.tabText, activeTab === 'received' && styles.activeTabText]}>
            Reçus {summary ? `(${summary.delivered_count})` : ''}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'sent' && styles.activeTab]}
          onPress={() => {
            setActiveTab('sent');
            setSelectedGiftId(null);
          }}
        >
          <Text style={[styles.tabText, activeTab === 'sent' && styles.activeTabText]}>
            Envoyés {summary ? `(${summary.sent_today})` : ''}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'pending' && styles.activeTab]}
          onPress={() => {
            setActiveTab('pending');
            setSelectedGiftId(null);
          }}
        >
          <Text style={[styles.tabText, activeTab === 'pending' && styles.activeTabText]}>
            En attente {pendingCount > 0 ? `(${pendingCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Liste des cadeaux */}
      <FlatList
        data={activeList}
        renderItem={renderGiftItem}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            colors={['#667eea']}
            tintColor="#667eea"
          />
        }
        ListEmptyComponent={() => {
          const emptyTitle =
            activeTab === 'received'
              ? 'Aucun cadeau reçu'
              : activeTab === 'sent'
              ? 'Aucun cadeau envoyé'
              : 'Aucun cadeau en attente';
          const emptySubtitle =
            activeTab === 'received'
              ? 'Les cadeaux que vous recevez apparaîtront ici'
              : activeTab === 'sent'
              ? 'Les cadeaux que vous envoyez apparaîtront ici'
              : 'Les cadeaux legacy en attente de réponse arriveront ici';
          return (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🎁</Text>
              <Text style={styles.emptyTitle}>{emptyTitle}</Text>
              <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
            </View>
          );
        }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButtonText: {
    fontSize: 24,
    color: '#333',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 0,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 20,
    marginTop: 16,
    gap: 12,
  },
  summaryCard: {
    flexBasis: '47%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  tab: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: '#667eea',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  activeTabText: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
    paddingBottom: 30,
  },
  giftCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  selectedGiftCard: {
    borderWidth: 2,
    borderColor: '#667eea',
    backgroundColor: '#f0f4ff',
  },
  pendingGlow: {
    borderColor: '#F97316',
  },
  giftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  giftImage: {
    width: 60,
    height: 60,
    borderRadius: 12,
    marginRight: 12,
  },
  imagePlaceholder: {
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    fontSize: 24,
  },
  giftInfo: {
    flex: 1,
  },
  giftTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  giftPerson: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 2,
  },
  giftDate: {
    fontSize: 12,
    color: '#9ca3af',
  },
  statusBadge: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  statusIcon: {
    fontSize: 18,
  },
  messageContainer: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#667eea',
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  metricPill: {
    flexDirection: 'column',
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  metricLabel: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  capShieldCard: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
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
    fontSize: 13,
    fontWeight: '700',
    color: '#312E81',
  },
  capShieldValue: {
    fontSize: 13,
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
    backgroundColor: '#4C1D95',
    borderRadius: 999,
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
  messageLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
    fontWeight: '500',
  },
  giftMessage: {
    fontSize: 14,
    color: '#374151',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  actionsContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: '#10B981',
  },
  declineButton: {
    backgroundColor: '#EF4444',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  giftFooter: {
    alignItems: 'flex-end',
  },
  socialRow: {
    marginTop: 12,
  },
  socialText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '600',
  },
  socialSubText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  timelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  timelineLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  timelineValue: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '500',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#f3f4f6',
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default GiftInboxScreen;
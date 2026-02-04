/**
 * ÉCRAN PROFIL UTILISATEUR - VERSION FINALE & FONCTIONNELLE
 * ✅ Valeurs réelles depuis backend
 * ✅ Suppression des boutons non implémentés
 * ✅ Interface simplifiée et efficace
 * ✅ Gestion d'erreurs robuste
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useWallet } from '../contexts/WalletContext'; // ⬅️ IMPORT useWallet AJOUTÉ
import { purchaseService, InventoryItem } from '../services/purchase';
import { paymentService, DetailedBalance } from '../services/payment';
import {
  CAPITALIZATION_CONSTANTS,
  computeCapProgress,
  formatCompactCurrency,
  getNextMilestone
} from '../utils/stabilization';

const { PALIER_THRESHOLD, MICRO_IMPACT_RATE, PALIER_COUNT } = CAPITALIZATION_CONSTANTS;
const PALIER_THRESHOLD_LABEL = formatCompactCurrency(PALIER_THRESHOLD);
const MICRO_IMPACT_RATE_PERCENT = (MICRO_IMPACT_RATE * 100).toFixed(4);
const MICRO_MULTIPLIER_RANGE = Math.max(1, PALIER_COUNT - 1);

export default function ProfileScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  
  // ✅ MISE À JOUR DU CONTEXTE - RÉCUPÉRATION DES VARIABLES RENOMMÉES
  const { 
    cashBalance,           // Argent réel (pour achats & retraits)
    virtualBalance,        // Argent virtuel (redistributions uniquement)
    usableBalance,         // Solde réel utilisable (cashBalance - locked si nécessaire)
    loading: walletLoading 
  } = useWallet();
  
  const [detailedBalance, setDetailedBalance] = useState<DetailedBalance | null>(null);
  const [inventoryCount, setInventoryCount] = useState<number>(0);
  const [collectionTotals, setCollectionTotals] = useState<{ base: number | null; micro: number | null; total: number | null }>({
    base: null,
    micro: null,
    total: null,
  });
  const [stabilizationTotals, setStabilizationTotals] = useState({
    marketCap: 0,
    effectiveCap: 0,
    redistribution: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preferences, setPreferences] = useState({
    pushAlerts: true,
    activityDigest: false,
    biometricLock: false,
  });

  useEffect(() => {
    loadProfileData();
  }, []);

  const loadProfileData = async () => {
    try {
      setLoading(true);
     
      // Récupération des données ESSENTIELLES seulement
      const [detailedResponse, inventoryResponse] = await Promise.allSettled([
        paymentService.getDetailedBalance(),
        purchaseService.getInventory(),
      ]);
     
      // 1. Solde détaillé (contient les vraies valeurs)
      if (detailedResponse.status === 'fulfilled') {
        const detailed = detailedResponse.value;
        setDetailedBalance(detailed);
        console.log('📊 Solde détaillé reçu:', {
          total: detailed?.total_balance,
          liquid: detailed?.liquid_balance,
          bom: detailed?.bom_value,
          social: detailed?.social_value
        });
      } else {
        console.warn('Erreur chargement solde détaillé:', detailedResponse.reason);
        setDetailedBalance(null);
      }
     
      // 2. Nombre d'œuvres dans l'inventaire
      if (inventoryResponse.status === 'fulfilled') {
        const inventoryList: InventoryItem[] = inventoryResponse.value || [];
        setInventoryCount(inventoryList.length);

        if (inventoryList.length > 0) {
          let baseSum = 0;
          let microSum = 0;
          let totalSum = 0;
          let marketCapTotal = 0;
          let effectiveCapTotal = 0;
          let redistributionTotal = 0;

          inventoryList.forEach(item => {
            const financialBlock = item.financial || {};
            const baseValue = Math.max(0, pickNumber(
              item.social_metrics?.base_value,
              financialBlock.purchase_price,
              financialBlock.estimated_value,
              item.bom_asset?.base_value,
              item.purchase_price,
              item.current_value
            ));

            const preferredTotal = Math.max(0, pickNumber(
              item.social_metrics?.total_value,
              item.bom_asset?.value,
              financialBlock.current_social_value ? baseValue + financialBlock.current_social_value : undefined,
              item.current_value,
              baseValue
            ));

            const socialImpactValue = Math.max(0, pickNumber(
              item.social_metrics?.social_value,
              item.bom_asset?.current_social_value,
              item.bom_asset?.social_value,
              financialBlock.current_social_value,
              preferredTotal - baseValue
            ));

            const totalValue = Math.max(baseValue + socialImpactValue, preferredTotal);

            baseSum += baseValue;
            microSum += socialImpactValue;
            totalSum += totalValue;

            marketCapTotal += pickNumber(
              item.social_metrics?.market_capitalization,
              item.bom_asset?.market_capitalization,
              (item as any)?.market_capitalization
            );

            effectiveCapTotal += pickNumber(
              item.social_metrics?.effective_capitalization,
              (item as any)?.effective_capitalization,
              item.bom_asset?.effective_capitalization
            );

            redistributionTotal += pickNumber(
              item.social_metrics?.redistribution_pool,
              item.bom_asset?.redistribution_pool,
              (item as any)?.redistribution_pool
            );
          });

          setCollectionTotals({ base: baseSum, micro: microSum, total: totalSum });
          setStabilizationTotals({
            marketCap: marketCapTotal,
            effectiveCap: effectiveCapTotal,
            redistribution: redistributionTotal,
          });
        } else {
          setCollectionTotals({ base: 0, micro: 0, total: 0 });
          setStabilizationTotals({ marketCap: 0, effectiveCap: 0, redistribution: 0 });
        }
      } else {
        console.warn('Erreur chargement inventaire:', inventoryResponse.reason);
        setInventoryCount(0);
        setCollectionTotals({ base: null, micro: null, total: null });
        setStabilizationTotals({ marketCap: 0, effectiveCap: 0, redistribution: 0 });
      }
     
    } catch (error) {
      console.error('❌ Erreur chargement profil:', error);
      Alert.alert('Erreur', 'Impossible de charger les données');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadProfileData();
  };

  const togglePreference = (key: keyof typeof preferences) => {
    setPreferences(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const pickNumber = (...candidates: Array<number | null | undefined>): number => {
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
    }
    return 0;
  };

  // ✅ FORMATAGE SÉCURISÉ
  const formatCurrency = (value: number | undefined | null): string => {
    if (value === undefined || value === null || isNaN(value)) {
      return '0 FCFA';
    }
    return parseFloat(value.toFixed(4)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' FCFA';
  };

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return 'Non disponible';
    try {
      return new Date(dateString).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch (error) {
      return 'Date invalide';
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Déconnexion',
      'Êtes-vous sûr de vouloir vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Se déconnecter',
          style: 'destructive',
          onPress: logout
        }
      ]
    );
  };

  // Écran de chargement
  if (loading && !refreshing) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </View>
    );
  }

  // ✅ MISE À JOUR DES CALCULS DE SOLDE
  const liquidBalance = detailedBalance?.liquid_balance ?? cashBalance ?? usableBalance;
  const redistributionsBalance = detailedBalance?.virtual_balance ?? virtualBalance;
  const collectionValue = (collectionTotals.total ?? detailedBalance?.bom_value ?? 0);
  const socialValue = (collectionTotals.micro ?? detailedBalance?.social_value ?? 0);
  const baseCollectionValue = (collectionTotals.base ?? Math.max(0, collectionValue - socialValue));
  const totalBalance = detailedBalance?.total_balance ?? (liquidBalance + redistributionsBalance + collectionValue + socialValue);
  const membershipLabel = user?.is_admin ? 'Administrateur' : 'Membre actif';
  const kycLabel = user?.kyc_status === 'verified' ? 'KYC vérifié' : 'KYC en attente';
  const profileCapProgress = computeCapProgress(stabilizationTotals.effectiveCap);
  const nextCapitalizationMilestone = getNextMilestone(profileCapProgress);
  const profileMultiplier = 1 + (profileCapProgress * MICRO_MULTIPLIER_RANGE);

  const highlightMetrics = [
    {
      label: 'Œuvres détenues',
      value: inventoryCount.toString(),
      hint: 'Collection active',
    },
    {
      label: 'Valeur collection',
      value: formatCurrency(collectionValue),
      hint: 'Estimation courante',
    },
    {
      label: 'Valeur sociale',
      value: formatCurrency(socialValue),
      hint: 'Impact cumulé',
    },
  ];

  const detailBreakdown = [
    { label: 'Solde réel disponible', value: formatCurrency(liquidBalance) },
    { label: 'Redistributions virtuelles', value: formatCurrency(redistributionsBalance) },
    { label: 'Valeur de base collection', value: formatCurrency(baseCollectionValue) },
    { label: 'Bonus social actif', value: formatCurrency(socialValue) },
    { label: 'Valeur totale des œuvres', value: formatCurrency(collectionValue) },
  ];

  const quickActions = [
    {
      icon: '💰',
      title: 'Portefeuille',
      subtitle: 'Consulter vos soldes',
      action: () => navigation.navigate('Wallet'),
    },
    {
      icon: '🖼️',
      title: 'Collection',
      subtitle: `${inventoryCount} œuvre${inventoryCount > 1 ? 's' : ''}`,
      action: () => navigation.navigate('Inventory'),
    },
    {
      icon: '🏪',
      title: 'Marketplace',
      subtitle: 'Acheter ou vendre',
      action: () => navigation.navigate('Catalogue'),
    },
    {
      icon: '🎁',
      title: 'Cadeaux',
      subtitle: 'Gérer vos cadeaux',
      action: () => navigation.navigate('GiftInbox'),
    },
    {
      icon: '🛟',
      title: 'Support',
      subtitle: 'Assistance dédiée',
      action: () => navigation.navigate('SupportCenter'),
    },
  ];

  const preferenceEntries: Array<{ key: keyof typeof preferences; label: string; description: string }> = [
    {
      key: 'pushAlerts',
      label: 'Notifications push',
      description: 'Transactions, partages et cadeaux importants',
    },
    {
      key: 'activityDigest',
      label: 'Résumé quotidien',
      description: 'Recevoir les mouvements clés par email',
    },
    {
      key: 'biometricLock',
      label: 'Verrouillage biométrique',
      description: 'Requis à l’ouverture de l’application',
    },
  ];

  const accountFacts = [
    { label: 'Statut KYC', value: kycLabel },
    { label: 'ID utilisateur', value: user?.id ? `#${user.id}` : 'Non disponible' },
    { label: 'Email', value: user?.email || 'Non renseigné' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#667eea']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroAccent} />
          <View style={styles.heroHeader}>
            <View style={styles.avatarShell}>
              <Text style={styles.avatarText}>{user?.full_name?.charAt(0)?.toUpperCase() || 'U'}</Text>
            </View>
            <View style={styles.heroIdentity}>
              <Text style={styles.userName}>{user?.full_name || 'Utilisateur'}</Text>
              <Text style={styles.userPhone}>{user?.phone || ''}</Text>
              {user?.email ? <Text style={styles.userEmail}>{user.email}</Text> : null}
            </View>
          </View>
          <View style={styles.heroBadges}>
            <Text style={[styles.badge, user?.is_admin ? styles.badgeAdmin : styles.badgeMember]}>
              {membershipLabel}
            </Text>
            <Text style={[styles.badge, styles.badgeMuted]}>{kycLabel}</Text>
          </View>
          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaItem}>
              <Text style={styles.heroMetaLabel}>Membre depuis</Text>
              <Text style={styles.heroMetaValue}>{formatDate(user?.created_at)}</Text>
            </View>
            <View style={styles.heroMetaDivider} />
            <View style={styles.heroMetaItem}>
              <Text style={styles.heroMetaLabel}>Dernière connexion</Text>
              <Text style={styles.heroMetaValue}>{formatDate(user?.last_login)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.metricGrid}>
          {highlightMetrics.map(metric => (
            <View key={metric.label} style={styles.metricCard}>
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={styles.metricHint}>{metric.hint}</Text>
            </View>
          ))}
        </View>

        <View style={styles.walletRow}>
          <View style={[styles.walletCard, styles.walletCardPrimary]}>
            <Text style={styles.walletLabel}>Solde réel</Text>
            <Text style={styles.walletValue}>{formatCurrency(liquidBalance)}</Text>
            <Text style={styles.walletHint}>Disponible immédiatement</Text>
          </View>
          <View style={[styles.walletCard, styles.walletCardSecondary]}>
            <Text style={styles.walletLabel}>Redistributions</Text>
            <Text style={styles.walletValue}>{formatCurrency(redistributionsBalance)}</Text>
            <Text style={styles.walletHint}>Fonds virtuels</Text>
          </View>
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailsHeader}>
            <Text style={styles.sectionTitle}>Structure du patrimoine</Text>
            <Text style={styles.sectionHint}>Actualisé en temps réel</Text>
          </View>
          {detailBreakdown.map(row => (
            <View key={row.label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{row.label}</Text>
              <Text style={styles.detailValue}>{row.value}</Text>
            </View>
          ))}
          <View style={[styles.detailRow, styles.detailRowStrong]}>
            <Text style={styles.totalLabel}>Total consolidé</Text>
            <Text style={styles.totalDetailValue}>{formatCurrency(totalBalance)}</Text>
          </View>
        </View>

        <View style={styles.stabilizationCard}>
          <Text style={styles.stabilizationTitle}>Stabilisation collective</Text>
          <Text style={styles.stabilizationHint}>
            Plus la communauté immobilise, plus vos BOOMs peuvent évoluer.
          </Text>
          <View style={styles.stabilizationRow}>
            <View style={styles.stabilizationMetric}>
              <Text style={styles.stabilizationMetricLabel}>Capitalisation atteinte</Text>
              <Text style={styles.stabilizationMetricValue}>
                {formatCompactCurrency(stabilizationTotals.marketCap)}
              </Text>
            </View>
            <View style={styles.stabilizationMetric}>
              <Text style={styles.stabilizationMetricLabel}>Objectif palier</Text>
              <Text style={styles.stabilizationMetricValue}>
                {formatCompactCurrency(nextCapitalizationMilestone)}
              </Text>
            </View>
            <View style={styles.stabilizationMetric}>
              <Text style={styles.stabilizationMetricLabel}>Multiplicateur futur</Text>
              <Text style={styles.stabilizationMetricValue}>
                {profileMultiplier.toFixed(2)}×
              </Text>
            </View>
          </View>
          <View style={styles.stabilizationProgressHeader}>
            <Text style={styles.stabilizationProgressLabel}>Progression vers le seuil</Text>
            <Text style={styles.stabilizationProgressPercent}>
              {(profileCapProgress * 100).toFixed(1)}%
            </Text>
          </View>
          <View style={styles.stabilizationProgressTrack}>
            <View
              style={[styles.stabilizationProgressFill, {
                width: `${Math.min(profileCapProgress * 100, 100)}%`
              }]}
            />
          </View>
          <Text style={styles.stabilizationFootnote}>
            Pool redistribution : {formatCompactCurrency(stabilizationTotals.redistribution)} • Minimum requis : {PALIER_THRESHOLD_LABEL}
          </Text>
          <Text style={styles.stabilizationFootnote}>
            Tant que ce palier n'est pas atteint, le prix reste verrouillé. Chaque tranche débloque +{MICRO_IMPACT_RATE_PERCENT}% de valeur sociale.
          </Text>
        </View>

        <View style={styles.accountCard}>
          <Text style={styles.sectionTitle}>Identité & statut</Text>
          {accountFacts.map(fact => (
            <View key={fact.label} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{fact.label}</Text>
              <Text style={styles.infoValue}>{fact.value}</Text>
            </View>
          ))}
          <View style={styles.badgeRow}>
            <Text style={[styles.chip, styles.chipPrimary]}>{membershipLabel}</Text>
            <Text style={[styles.chip, styles.chipOutline]}>{kycLabel}</Text>
          </View>
        </View>

        <View style={styles.quickActionCard}>
          <Text style={styles.sectionTitle}>Raccourcis</Text>
          {quickActions.map(action => (
            <TouchableOpacity
              key={action.title}
              style={styles.quickActionRow}
              activeOpacity={0.8}
              onPress={action.action}
            >
              <View style={styles.quickActionIconWrapper}>
                <Text style={styles.quickActionIcon}>{action.icon}</Text>
              </View>
              <View style={styles.quickActionText}>
                <Text style={styles.quickActionTitle}>{action.title}</Text>
                <Text style={styles.quickActionSubtitle}>{action.subtitle}</Text>
              </View>
              <Text style={styles.quickActionArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.preferencesCard}>
          <Text style={styles.sectionTitle}>Préférences</Text>
          {preferenceEntries.map(entry => (
            <View key={entry.key} style={styles.preferenceRow}>
              <View style={styles.preferenceText}>
                <Text style={styles.preferenceLabel}>{entry.label}</Text>
                <Text style={styles.preferenceDescription}>{entry.description}</Text>
              </View>
              <Switch
                value={preferences[entry.key]}
                onValueChange={() => togglePreference(entry.key)}
                trackColor={{ false: '#c7d2fe', true: '#7c3aed' }}
                thumbColor={preferences[entry.key] ? '#f3f4f6' : '#f8fafc'}
              />
            </View>
          ))}
        </View>

        <View style={styles.supportCard}>
          <Text style={styles.sectionTitle}>Assistance</Text>
          <Text style={styles.supportCopy}>
            Notre équipe reste disponible 7j/7 pour débloquer vos transactions, suivre vos tickets et sécuriser vos actifs.
          </Text>
          <View style={styles.supportButtons}>
            <TouchableOpacity
              style={[styles.supportButton, styles.supportButtonPrimary]}
              onPress={() => navigation.navigate('SupportCenter')}
            >
              <Text style={styles.supportButtonText}>Ouvrir le centre</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutIcon}>🚪</Text>
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Booms • v1.0.0</Text>
          <Text style={styles.footerSubtext}>© {new Date().getFullYear()} Tous droits réservés</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fffaf2',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6b7280',
  },
  scrollView: {
    flex: 1,
    paddingBottom: 32,
  },
  heroCard: {
    marginTop: 16,
    marginHorizontal: 16,
    padding: 24,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fbead1',
    shadowColor: '#f2994a',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 6,
    overflow: 'hidden',
  },
  heroAccent: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 180,
    backgroundColor: '#ffe2bf',
    opacity: 0.4,
    top: -140,
    right: -60,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarShell: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff3d6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#b45309',
  },
  heroIdentity: {
    flex: 1,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1f2933',
  },
  userPhone: {
    fontSize: 14,
    color: '#8e6e41',
    marginTop: 2,
  },
  userEmail: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  heroBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 8,
    marginBottom: 6,
  },
  badgeAdmin: {
    backgroundColor: '#fde68a',
    color: '#78350f',
  },
  badgeMember: {
    backgroundColor: '#e0e7ff',
    color: '#4338ca',
  },
  badgeMuted: {
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
  },
  heroMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroMetaItem: {
    flex: 1,
  },
  heroMetaLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  heroMetaValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2933',
  },
  heroMetaDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#f2e5cf',
    marginHorizontal: 16,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 20,
  },
  metricCard: {
    flexBasis: '47%',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f3e8ff',
    shadowColor: '#c4b5fd',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  metricLabel: {
    fontSize: 12,
    color: '#7c3aed',
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2933',
  },
  metricHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  walletRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 16,
  },
  walletCard: {
    width: '48%',
    borderRadius: 20,
    padding: 18,
  },
  walletCardPrimary: {
    backgroundColor: '#fff4e6',
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  walletCardSecondary: {
    backgroundColor: '#edf2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  walletLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#6b7280',
    letterSpacing: 1,
  },
  walletValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f2933',
    marginTop: 6,
  },
  walletHint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
  detailsCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#f4f1eb',
  },
  detailsHeader: {
    flexDirection: 'row',
  stabilizationCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  stabilizationTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 6,
  },
  stabilizationHint: {
    fontSize: 13,
    color: 'rgba(248,250,252,0.75)',
    marginBottom: 14,
  },
  stabilizationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  stabilizationMetric: {
    flex: 1,
  },
  stabilizationMetricLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  stabilizationMetricValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#e0f2fe',
  },
  stabilizationProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  stabilizationProgressLabel: {
    fontSize: 12,
    color: 'rgba(248,250,252,0.75)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stabilizationProgressPercent: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  stabilizationProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(148,163,184,0.4)',
    marginBottom: 12,
  },
  stabilizationProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#38bdf8',
  },
  stabilizationFootnote: {
    fontSize: 12,
    color: 'rgba(226,232,240,0.9)',
    lineHeight: 18,
  },
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1f2933',
  },
  sectionHint: {
    fontSize: 12,
    color: '#9ca3af',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f4f4f5',
  },
  detailLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2933',
  },
  detailRowStrong: {
    borderBottomWidth: 0,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2933',
  },
  totalDetailValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#16a34a',
  },
  accountCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#f4ede4',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2933',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 8,
    marginBottom: 6,
  },
  chipPrimary: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
  },
  chipOutline: {
    borderWidth: 1,
    borderColor: '#fcd34d',
    color: '#b45309',
  },
  quickActionCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 22,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#f2f2f2',
  },
  quickActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  quickActionIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  quickActionIcon: {
    fontSize: 20,
  },
  quickActionText: {
    flex: 1,
  },
  quickActionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2933',
  },
  quickActionSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  quickActionArrow: {
    fontSize: 20,
    color: '#cbd5f5',
  },
  preferencesCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#f3f0ec',
  },
  preferenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f4f4f5',
  },
  preferenceText: {
    flex: 1,
    paddingRight: 12,
  },
  preferenceLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2933',
  },
  preferenceDescription: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  supportCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#f3e8ff',
  },
  supportCopy: {
    fontSize: 13,
    color: '#475569',
    marginTop: 8,
  },
  supportButtons: {
    marginTop: 16,
  },
  supportButton: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportButtonPrimary: {
    backgroundColor: '#f97316',
  },
  supportButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff7ed',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff1f2',
    marginHorizontal: 16,
    marginTop: 24,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  logoutIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#b91c1c',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  footerText: {
    fontSize: 12,
    color: '#94a3af',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 11,
    color: '#9f9487',
  },
});
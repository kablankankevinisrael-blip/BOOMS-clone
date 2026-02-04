import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Animated } from 'react-native';
import { Boom } from '../services/boms'; // Changé: NFT → Boom
import { InteractionStatsSummary } from '../services/interactions';
import { formatCurrencyValue, sanitizeCurrencyInput } from '../utils/currency';
import {
  computeCapProgress,
  describeMicroInfluence,
  formatCompactCurrency,
  getNextMilestone
} from '../utils/stabilization';

interface Boom {
  id: number;
  token_id: string;
  title: string;
  artist: string;
  description?: string;
  category: string;
  tags?: string[];
  preview_image: string;
  animation_url?: string;
  audio_url?: string;
  
  // VALEURS BOOM (AJOUTÉS)
  base_value?: number;
  social_value?: number;
  total_value?: number;
  current_social_value?: number;
  social_score?: number;
  share_count_24h?: number;
  buy_count_24h?: number;
  sell_count_24h?: number;
  social_event?: 'viral' | 'trending' | 'new' | 'stable';
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
  
  // VALEURS EXISTANTES
  value: number;
  purchase_price: number;
  edition_type: 'common' | 'rare' | 'ultra_rare' | 'legendary';
  max_editions?: number;
  current_edition?: number;
  collection_name?: string;
  owner_name?: string;
}


// GARDER LE MÊME NOM D'INTERFACE POUR COMPATIBILITÉ
interface NFTCardProps {
  nft: Boom; // Maintenant un Boom
  onPress: (nft: Boom) => void;
  showCollection?: boolean;
  showOwner?: boolean;
  showSocial?: boolean;
  debugMode?: boolean;
  interactionSnapshot?: InteractionStatsSummary;
}

export const NFTCard: React.FC<NFTCardProps> = ({
  nft,
  onPress,
  showCollection = true,
  showOwner = false,
  showSocial = true,
  debugMode = false,
  interactionSnapshot
}) => {
  // 🔥 CORRECTION: Vérification précoce pour empêcher l'affichage d'un BOOM invalide
  if (!nft || !nft.id) {
    console.warn(`[NFTCard] BOOM invalide ou vendu - ID manquant, rendu annulé`);
    return null;
  }

  const [imageError, setImageError] = useState(false);
  const [pulseAnim] = useState(new Animated.Value(1));
  const [renderCount, setRenderCount] = useState(0);
  const [lastValues, setLastValues] = useState<Record<string, any>>({});

  useEffect(() => {
    setRenderCount(prev => prev + 1);
    
    if (debugMode) {
      console.log(`[NFTCard Debug] Render #${renderCount + 1}`);
      console.log(`[NFTCard Debug] Boom ID: ${nft.id}`);
      console.log(`[NFTCard Debug] Base Value: ${nft.base_value}`);
      console.log(`[NFTCard Debug] Social Value: ${nft.social_value}`);
      console.log(`[NFTCard Debug] Total Value: ${nft.total_value}`);
      
      const currentValues = {
        base: nft.base_value,
        social: nft.social_value,
        total: nft.total_value
      };
      
      Object.keys(currentValues).forEach(key => {
        if (lastValues[key] !== currentValues[key]) {
          console.log(`[NFTCard Debug] ${key} changed: ${lastValues[key]} → ${currentValues[key]}`);
        }
      });
      
      setLastValues(currentValues);
    }
  }, [nft, debugMode]);

  // COULEURS PAR ÉDITION
  const getEditionColor = (editionType: string) => {
    const colorMap: Record<string, string> = {
      'legendary': '#D4AF37',
      'ultra_rare': '#8B7355',
      'rare': '#A9A9A9',
      'common': '#808080'
    };
    
    return colorMap[editionType] || '#808080';
  };

  // FORMATAGE BOOM
  const safeValue = (value: number | string | null | undefined): number => {
    const result = sanitizeCurrencyInput(value);
    
    if (
      debugMode &&
      typeof value === 'string' &&
      /[a-zA-Z]/.test(value)
    ) {
      console.warn(`[NFTCard Debug] safeValue sanitized unexpected value: ${value}`);
    }
    
    return result;
  };

  const getBaseValue = (): number => safeValue(nft.base_value ?? nft.value ?? 0);
  const getMarketValue = (): number => {
    const total = nft.total_value ?? (getBaseValue() + (nft.current_social_value ?? nft.social_value ?? 0));
    return safeValue(total);
  };
  const getSocialDeltaValue = (): number => {
    if (typeof nft.social_delta === 'number') {
      return safeValue(nft.social_delta);
    }
    return getMarketValue() - getBaseValue();
  };

  // ANIMATION PULSE
  const startPulseAnimation = () => {
    if (debugMode) {
      console.log(`[NFTCard Debug] Pulse animation triggered`);
    }
    
    Animated.sequence([
      Animated.timing(pulseAnim, { 
        toValue: 1.05, 
        duration: 150, 
        useNativeDriver: true 
      }),
      Animated.timing(pulseAnim, { 
        toValue: 1, 
        duration: 150, 
        useNativeDriver: true 
      })
    ]).start();
  };

  // COULEUR VALEUR SOCIALE
  const getSocialValueColor = (): string => {
    const delta = getSocialDeltaValue();
    
    if (debugMode) {
      console.log(`[NFTCard Debug] Social delta: ${delta}, color decision`);
    }
    
    if (delta > 1) return '#10B981';
    if (delta < -1) return '#EF4444';
    return '#6B7280';
  };

  // SYMBOLE TENDANCE
  const getSocialTrendIcon = (): string => {
    const delta = getSocialDeltaValue();
    
    if (delta > 1) return '📈';
    if (delta < -1) return '📉';
    if (delta > 0) return '↗️';
    if (delta < 0) return '↘️';
    return '➡️';
  };

  // ÉDITION
  const renderEdition = (): string => {
    if (nft.max_editions) {
      return `${nft.current_edition || 1}/${nft.max_editions}`;
    }
    return 'Édition unique';
  };

  // SYMBOLE ÉDITION
  const getEditionIcon = (): string => {
    const icons: Record<string, string> = {
      'legendary': '★',
      'ultra_rare': '◆',
      'rare': '●',
      'common': '○'
    };
    return icons[nft.edition_type] || '○';
  };

  // DEBUG: Afficher les valeurs brutes
  const DebugInfo = () => {
    if (!debugMode) return null;
    
    return (
      <View style={styles.debugContainer}>
        <Text style={styles.debugTitle}>BOOM INFO</Text>
        <Text style={styles.debugText}>Render: {renderCount}</Text>
        <Text style={styles.debugText}>Base: {nft.base_value}</Text>
        <Text style={styles.debugText}>Social: {nft.social_value}</Text>
        <Text style={styles.debugText}>Total: {nft.total_value}</Text>
        <Text style={styles.debugText}>Social Event: {nft.social_event || 'none'}</Text>
      </View>
    );
  };

  // GESTION ERREUR IMAGE
  const handleImageError = () => {
    if (debugMode) {
      console.error(`[NFTCard Debug] Image failed to load: ${nft.preview_image}`);
    }
    setImageError(true);
  };

  // CALCULER LA VALEUR TOTALE (BOOM)
  const getTotalValue = (): number => getMarketValue();
  const socialMetrics = (nft as any)?.social_metrics || {};
  const palierThreshold = safeValue(
    nft.palier_threshold ??
    socialMetrics.palier_threshold ??
    1_000_000
  );
  const marketCap = safeValue(
    nft.market_capitalization ??
    socialMetrics.market_capitalization ??
    0
  );
  const effectiveCap = safeValue(
    nft.effective_capitalization ??
    socialMetrics.effective_capitalization ??
    marketCap
  );
  const capUnits = safeValue(
    nft.capitalization_units ??
    socialMetrics.capitalization_units ??
    0
  );
  const redistributionPool = safeValue(
    nft.redistribution_pool ??
    socialMetrics.redistribution_pool ??
    0
  );
  const capProgress = computeCapProgress(effectiveCap);
  const nextMilestone = getNextMilestone(capProgress);
  const progressWidth = capProgress > 0 ? Math.min(100, capProgress * 100) : 4;
  const microImpactLabel = describeMicroInfluence(capUnits);
  const likesCount = interactionSnapshot?.totalLikes ?? 0;
  const socialShares = interactionSnapshot?.totalSocialShares ?? nft.share_count ?? nft.share_count_24h ?? 0;
  const internalShares = interactionSnapshot?.totalInternalShares ?? 0;
  const interactionsCount = interactionSnapshot?.totalInteractions ?? nft.interaction_count ?? 0;
  const last24hSocialShares = interactionSnapshot?.last24hSocialShares ?? nft.share_count_24h ?? 0;
  const last24hInternalShares = interactionSnapshot?.last24hInternalShares ?? 0;
  const last24hInteractions = interactionSnapshot?.last24hInteractions ?? 0;
  const uniqueFans = interactionSnapshot?.uniqueUsers ?? nft.unique_holders_count ?? 0;
  const buyCount24h = Number(nft.buy_count_24h ?? socialMetrics.buy_count_24h ?? nft.buy_count ?? 0);
  const sellCount24h = Number(nft.sell_count_24h ?? socialMetrics.sell_count_24h ?? 0);
  const shieldValueCompact = formatCompactCurrency(palierThreshold);
  const marketCapCompact = formatCompactCurrency(marketCap);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        if (debugMode) {
          console.log(`[NFTCard Debug] Card pressed: ${nft.title}`);
        }
        startPulseAnimation();
        onPress(nft);
      }}
      activeOpacity={0.9}
    >
      {/* DEBUG INFO */}
      {debugMode && <DebugInfo />}

      {/* THUMBNAIL */}
      <View style={styles.thumbnailContainer}>
        <Image
          source={{
            uri: imageError
              ? 'https://via.placeholder.com/300/1a1a1a/ffffff?text=BOOM'
              : nft.preview_image || 'https://via.placeholder.com/300/1a1a1a/ffffff?text=BOOM'
          }}
          style={styles.thumbnail}
          onError={handleImageError}
          resizeMode="cover"
        />

        {/* BADGE RARETÉ */}
        <View style={[styles.editionBadge, { backgroundColor: getEditionColor(nft.edition_type) }]}>
          <Text style={styles.editionText}>
            {getEditionIcon()} {nft.edition_type.toUpperCase()}
          </Text>
        </View>

        {/* INDICATEUR MÉDIA */}
        {(nft.animation_url || nft.audio_url) && (
          <View style={styles.mediaIndicator}>
            <Text style={styles.mediaIcon}>
              {nft.animation_url ? '🎬' : ''}
              {nft.audio_url ? '🎵' : ''}
            </Text>
          </View>
        )}

        {/* VALEUR TOTALE BOOM */}
        <View style={styles.boomsOverlay}>
          <Text style={styles.boomsValue}>
            {formatCurrencyValue(getTotalValue())}
          </Text>
        </View>
      </View>

      {/* INFOS BOOM */}
      <View style={styles.info}>
        <Text style={styles.tokenId}>BOOM #{nft.token_id.substring(0, 8)}</Text>
        <Text style={styles.title} numberOfLines={1}>{nft.title}</Text>
        <Text style={styles.artist}>{nft.artist}</Text>

        {/* COLLECTION */}
        {showCollection && nft.collection_name && (
          <View style={styles.collectionContainer}>
            <Text style={styles.collectionText}>{nft.collection_name}</Text>
          </View>
        )}

        {/* VALEURS BOOM */}
        <Animated.View style={[styles.values, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>Base:</Text>
            <Text style={styles.valueAmount}>
              {formatCurrencyValue(getBaseValue())}
            </Text>
          </View>

          <View style={styles.socialValueRow}>
            <Text style={styles.socialValueLabel}>Sociale:</Text>
            <View style={styles.socialValueContainer}>
              {(() => {
                const delta = getSocialDeltaValue();
                const formattedDelta = formatCurrencyValue(Math.abs(delta));
                const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
                return (
                  <>
                    <Text style={[styles.socialValueAmount, { color: getSocialValueColor() }]}>
                      {getSocialTrendIcon()} {formattedDelta}
                    </Text>
                    <Text style={[styles.socialValueChange, { color: getSocialValueColor() }]}>
                      {sign}{formattedDelta}
                    </Text>
                  </>
                );
              })()}
            </View>
          </View>

          <View style={styles.totalValueRow}>
            <Text style={styles.totalValueLabel}>TOTAL:</Text>
            <Text style={styles.totalValueAmount}>
              {formatCurrencyValue(getTotalValue())}
            </Text>
          </View>

          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>Édition:</Text>
            <Text style={styles.editionText}>{renderEdition()}</Text>
          </View>
        </Animated.View>

        <View style={styles.stabilizationCard}>
          <View style={styles.stabilizationHeader}>
            <Text style={styles.stabilizationTitle}>Bouclier de capitalisation</Text>
            <Text style={styles.stabilizationValue}>{shieldValueCompact}</Text>
          </View>
          <Text style={styles.stabilizationSubValue}>
            Cap actuelle : {marketCapCompact}
          </Text>
          <View style={styles.stabilizationBar}>
            <View
              style={[
                styles.stabilizationProgress,
                { width: `${Math.max(4, progressWidth)}%` }
              ]}
            />
          </View>
          <View style={styles.stabilizationFooter}>
            <Text style={styles.stabilizationHint}>
              {capProgress >= 1
                ? 'Palier atteint : influence ultra-diluée'
                : `Prochain palier : ${formatCompactCurrency(nextMilestone)}`}
            </Text>
            {redistributionPool > 0 && (
              <Text style={styles.redistributionHint}>
                Redistribution: {formatCompactCurrency(redistributionPool)}
              </Text>
            )}
          </View>
          <Text style={styles.microImpactText}>{microImpactLabel}</Text>
        </View>

        {/* MÉTRIQUES SOCIALES */}
        {showSocial && (
          <View style={styles.socialMetrics}>
            <View style={styles.socialMetricRow}>
              <View style={styles.socialMetric}>
                <Text style={styles.socialLabel}>Likes</Text>
                <Text style={styles.socialValue}>{likesCount}</Text>
              </View>
              <View style={styles.socialMetric}>
                <Text style={styles.socialLabel}>Partages RS</Text>
                <Text style={styles.socialValue}>{socialShares}</Text>
                {last24hSocialShares > 0 && (
                  <Text style={styles.socialHint}>+{last24hSocialShares} / 24h</Text>
                )}
              </View>
              <View style={styles.socialMetric}>
                <Text style={styles.socialLabel}>Partages internes</Text>
                <Text style={styles.socialValue}>{internalShares}</Text>
                {last24hInternalShares > 0 && (
                  <Text style={styles.socialHint}>+{last24hInternalShares} / 24h</Text>
                )}
              </View>
            </View>
            <View style={styles.socialMetricRow}>
              <View style={styles.socialMetric}>
                <Text style={styles.socialLabel}>Interactions</Text>
                <Text style={styles.socialValue}>{interactionsCount}</Text>
                {last24hInteractions > 0 && (
                  <Text style={styles.socialHint}>+{last24hInteractions} / 24h</Text>
                )}
              </View>
              <View style={styles.socialMetric}>
                <Text style={styles.socialLabel}>Fans actifs</Text>
                <Text style={styles.socialValue}>{uniqueFans}</Text>
                <Text style={styles.socialHint}>Profils uniques</Text>
              </View>
              <View style={styles.socialMetric}>
                <Text style={styles.socialLabel}>Achats 24h</Text>
                <Text style={styles.socialValue}>{buyCount24h}</Text>
              </View>
            </View>
            <View style={styles.socialMetricRow}>
              <View style={styles.socialMetric}>
                <Text style={styles.socialLabel}>Ventes 24h</Text>
                <Text style={styles.socialValue}>{sellCount24h}</Text>
              </View>
              <View style={styles.socialMetric}>
                <Text style={styles.socialLabel}>Cap actuelle</Text>
                <Text style={styles.socialValue}>{marketCapCompact}</Text>
                <Text style={styles.socialHint}>Progression bouclier</Text>
              </View>
              <View style={[styles.socialMetric, styles.socialMetricSpacer]} />
            </View>

            {/* ÉVÉNEMENT SOCIAL */}
            {nft.social_event && (
              <View style={[
                styles.eventBadge,
                nft.social_event === 'viral' ? styles.eventViral :
                nft.social_event === 'trending' ? styles.eventTrending :
                nft.social_event === 'new' ? styles.eventNew :
                styles.eventStable
              ]}>
                <Text style={styles.eventIcon}>
                  {nft.social_event === 'viral' ? '🔥' :
                   nft.social_event === 'trending' ? '📈' :
                   nft.social_event === 'new' ? '🆕' : '⭐'}
                </Text>
                <Text style={styles.eventLabel}>
                  {nft.social_event === 'viral' ? 'VIRAL' : 
                   nft.social_event === 'trending' ? 'TRENDING' : 
                   nft.social_event === 'new' ? 'NOUVEAU' : 'STABLE'}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* VOLATILITÉ */}
        {nft.volatility !== undefined && (
          <View style={styles.volatilityContainer}>
            <Text style={styles.volatilityLabel}>Volatilité: </Text>
            <Text style={[
              styles.volatilityValue,
              nft.volatility > 2 ? styles.volatilityHigh :
              nft.volatility > 1 ? styles.volatilityMedium :
              styles.volatilityLow
            ]}>
              {nft.volatility.toFixed(2)}%
            </Text>
          </View>
        )}

        {/* CATÉGORIE ET HOLDERS */}
        <View style={styles.categoryContainer}>
          <Text style={styles.category}>{nft.category}</Text>
          {nft.unique_holders_count && nft.unique_holders_count > 1 && (
            <Text style={styles.holdersCount}>
              👥 {nft.unique_holders_count}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// STYLES (inchangés)
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    margin: 8,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  thumbnailContainer: {
    position: 'relative',
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    height: 180,
    backgroundColor: '#1A1A1A',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  editionBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    minWidth: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  editionText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  mediaIndicator: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  mediaIcon: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  boomsOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  boomsValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D4AF37',
    textAlign: 'center',
  },
  info: {
    flex: 1,
  },
  tokenId: {
    fontSize: 10,
    color: '#6B7280',
    fontFamily: 'monospace',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  artist: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  collectionContainer: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  collectionText: {
    fontSize: 10,
    color: '#4B5563',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  values: {
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  stabilizationCard: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  stabilizationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stabilizationTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#312E81',
  },
  stabilizationValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338CA',
  },
  stabilizationSubValue: {
    fontSize: 10,
    color: '#4338CA',
    fontWeight: '500',
    textAlign: 'right',
    marginBottom: 6,
  },
  stabilizationBar: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#E0E7FF',
    overflow: 'hidden',
    marginBottom: 8,
  },
  stabilizationProgress: {
    height: '100%',
    backgroundColor: '#4C1D95',
    borderRadius: 999,
  },
  stabilizationFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stabilizationHint: {
    fontSize: 10,
    color: '#4338CA',
    fontWeight: '500',
  },
  redistributionHint: {
    fontSize: 10,
    color: '#1E40AF',
    fontWeight: '500',
  },
  microImpactText: {
    fontSize: 10,
    color: '#312E81',
    fontStyle: 'italic',
  },
  valueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    alignItems: 'center',
  },
  socialValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  totalValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 2,
    borderTopColor: '#D1D5DB',
  },
  valueLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  socialValueLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  totalValueLabel: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '700',
  },
  valueAmount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2937',
  },
  socialValueContainer: {
    alignItems: 'flex-end',
  },
  socialValueAmount: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 1,
  },
  socialValueChange: {
    fontSize: 9,
    fontWeight: '500',
    opacity: 0.8,
  },
  totalValueAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  socialMetrics: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  socialMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  socialMetric: {
    alignItems: 'center',
    flex: 1,
  },
  socialMetricSpacer: {
    flex: 1,
    opacity: 0,
  },
  socialLabel: {
    fontSize: 10,
    color: '#64748B',
    marginBottom: 3,
    fontWeight: '500',
  },
  socialValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
  },
  socialHint: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
  },
  eventBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  eventViral: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FBBF24',
  },
  eventTrending: {
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#60A5FA',
  },
  eventNew: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#34D399',
  },
  eventStable: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  eventIcon: {
    fontSize: 12,
    marginRight: 5,
  },
  eventLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  volatilityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  volatilityLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  volatilityValue: {
    fontSize: 11,
    fontWeight: '700',
  },
  volatilityHigh: {
    color: '#DC2626',
  },
  volatilityMedium: {
    color: '#D97706',
  },
  volatilityLow: {
    color: '#059669',
  },
  categoryContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  category: {
    fontSize: 10,
    backgroundColor: '#F3F4F6',
    color: '#4B5563',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    fontWeight: '500',
  },
  holdersCount: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
  },
  debugContainer: {
    backgroundColor: '#000000',
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FF0000',
  },
  debugTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  debugText: {
    fontSize: 9,
    color: '#FF6B6B',
    fontFamily: 'monospace',
  },
});

// EXPORTER AUSSI SOUS LE NOM BOOMCARD POUR NOUVEAU CODE
export const BoomCard = NFTCard;
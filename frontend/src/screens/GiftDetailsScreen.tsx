import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  Alert,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Image,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { giftService, GiftDetailsResponse } from '../services/gift';
import { useAuth } from '../contexts/AuthContext';
import {
  computeCapProgress,
  describeMicroInfluence,
  formatCompactCurrency,
  getNextMilestone
} from '../utils/stabilization';

const GiftDetailsScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { user } = useAuth();
  
  const { giftId } = route.params as { giftId: number };

  const [gift, setGift] = useState<GiftDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadGiftDetails();
  }, []);

  const loadGiftDetails = async () => {
    try {
      setLoading(true);
      const response = await giftService.getGiftDetails(giftId);
      setGift(response);
    } catch (error) {
      console.error('Erreur chargement détails:', error);
      Alert.alert('Erreur', 'Impossible de charger les détails du cadeau');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!gift) return;
    
    try {
      setProcessing(true);
      await giftService.acceptGift(gift.id);
      Alert.alert('Succès', 'Cadeau accepté avec succès!');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Erreur', error.response?.data?.detail || 'Erreur lors de l\'acceptation');
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!gift) return;
    
    Alert.alert(
      'Confirmer le refus',
      'Êtes-vous sûr de vouloir refuser ce cadeau ? Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Oui, refuser',
          style: 'destructive',
          onPress: async () => {
            try {
              setProcessing(true);
              await giftService.declineGift(gift.id);
              Alert.alert('Succès', 'Cadeau refusé');
              navigation.goBack();
            } catch (error: any) {
              Alert.alert('Erreur', error.response?.data?.detail || 'Erreur lors du refus');
            } finally {
              setProcessing(false);
            }
          },
        },
      ]
    );
  };

  // Vérification complète pour afficher les boutons d'action
  const isActionable = gift && 
                      !gift.is_new_flow && 
                      gift.status.toUpperCase() === 'SENT' &&
                      gift.receiver_id === user.id;

  const formatDate = (dateString?: string | null) => {
    if (!dateString) {
      return '';
    }
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusPresentation = (giftDetails: GiftDetailsResponse) => {
    const viewerId = user?.id;
    const status = (giftDetails.status || '').toUpperCase();
    const receiverName = giftDetails.receiver_name || 'le destinataire';
    const isViewerReceiver = typeof viewerId === 'number' && giftDetails.receiver_id === viewerId;
    const isViewerSender = typeof viewerId === 'number' && giftDetails.sender_id === viewerId;

    const baseFallback = { label: 'Statut indisponible', color: '#6B7280' };

    if (status === 'EXPIRED') {
      return { label: 'Cadeau expiré', color: '#6B7280' };
    }

    if (isViewerSender) {
      if (status === 'DELIVERED' || status === 'ACCEPTED') {
        return { label: `Accepté par ${receiverName}`, color: '#16A34A' };
      }
      if (status === 'DECLINED' || status === 'FAILED') {
        return { label: `Refusé par ${receiverName}`, color: '#DC2626' };
      }
      if (status === 'PAID' || status === 'SENT' || status === 'CREATED') {
        return { label: 'En attente de réponse', color: '#F97316' };
      }
    }

    if (isViewerReceiver) {
      if (status === 'DELIVERED' || status === 'ACCEPTED') {
        return { label: 'Cadeau accepté', color: '#16A34A' };
      }
      if (status === 'DECLINED' || status === 'FAILED') {
        return { label: 'Cadeau refusé', color: '#DC2626' };
      }
      if (status === 'PAID' || status === 'SENT' || status === 'CREATED') {
        return { label: "En attente d'action", color: '#F97316' };
      }
    }

    const dictionary: Record<string, { label: string; color: string }> = {
      SENT: { label: 'En attente', color: '#3B82F6' },
      CREATED: { label: 'Créé', color: '#3B82F6' },
      PAID: { label: 'Payé', color: '#3B82F6' },
      DELIVERED: { label: 'Livré', color: '#16A34A' },
      ACCEPTED: { label: 'Accepté', color: '#16A34A' },
      DECLINED: { label: 'Refusé', color: '#DC2626' },
      FAILED: { label: 'Échec', color: '#DC2626' }
    };

    return dictionary[status] || baseFallback;
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

  const readNumber = (value?: number | null): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return 0;
  };

  // Écran de chargement
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Chargement des détails...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Écran d'erreur si cadeau non trouvé
  if (!gift) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Cadeau non trouvé</Text>
          <TouchableOpacity 
            style={styles.backButtonFull}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonFullText}>Retour</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const timelineEntries = [
    { label: 'Envoyé', value: gift.sent_at },
    { label: 'Payé', value: gift.paid_at },
    { label: 'Livré', value: gift.delivered_at },
    { label: 'Accepté', value: gift.accepted_at },
    { label: 'Refusé', value: gift.failed_at },
    { label: 'Expiration', value: gift.expires_at }
  ].filter(entry => entry.value);

  const financial = gift.financial_details;
  const socialMetrics = gift.social_metrics;
  const statusPresentation = getStatusPresentation(gift);
  const marketCap = readNumber(socialMetrics?.market_capitalization);
  const effectiveCap = readNumber(socialMetrics?.effective_capitalization ?? socialMetrics?.market_capitalization);
  const redistributionPool = readNumber(socialMetrics?.redistribution_pool);
  const capUnits = readNumber(socialMetrics?.capitalization_units);
  const capProgress = computeCapProgress(effectiveCap);
  const nextMilestone = getNextMilestone(capProgress);

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
        <Text style={styles.headerTitle}>Détails du cadeau</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Image du cadeau */}
        <View style={styles.imageContainer}>
          {gift.bom_image_url ? (
            <Image 
              source={{ uri: gift.bom_image_url }} 
              style={styles.giftImage} 
              resizeMode="cover"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderIcon}>🎁</Text>
            </View>
          )}
        </View>

        {/* Titre */}
        <Text style={styles.giftTitle}>
          {gift.boom_title || 'Cadeau sans titre'}
        </Text>

        {/* Carte d'informations principales */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Expéditeur</Text>
            <Text style={styles.infoValue}>{gift.sender_name || 'Anonyme'}</Text>
          </View>

          <View style={styles.separator} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Date d'envoi</Text>
            <Text style={styles.infoValue}>{formatDate(gift.sent_at)}</Text>
          </View>

          <View style={styles.separator} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Statut</Text>
            <View style={styles.statusContainer}>
              <View 
                style={[
                  styles.statusDot, 
                  { backgroundColor: statusPresentation.color }
                ]} 
              />
              <Text style={[styles.statusText, { color: statusPresentation.color }]}>
                {statusPresentation.label}
              </Text>
            </View>
          </View>
        </View>

        {/* Message accompagnant */}
        {gift.message && (
          <View style={[styles.card, styles.messageCard]}>
            <Text style={styles.messageLabel}>Message accompagnant</Text>
            <Text style={styles.messageText}>"{gift.message}"</Text>
          </View>
        )}

        {financial && (
          <View style={[styles.card, styles.financeCard]}>
            <Text style={styles.sectionTitle}>Détails financiers</Text>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Montant payé</Text>
              <Text style={styles.infoValue}>{formatCurrency(financial.gross_amount)}</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Montant net</Text>
              <Text style={styles.infoValue}>{formatCurrency(financial.net_amount ?? financial.estimated_value)}</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Frais plateforme</Text>
              <Text style={styles.infoValue}>{formatCurrency(financial.fee_amount)}</Text>
            </View>

            {financial.transaction_reference && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Référence</Text>
                <Text style={styles.referenceValue}>{financial.transaction_reference}</Text>
              </View>
            )}

            {!!financial.wallet_transaction_ids?.length && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Transactions wallet</Text>
                <Text style={styles.infoValue}>
                  {financial.wallet_transaction_ids.join(', ')}
                </Text>
              </View>
            )}
          </View>
        )}

        {socialMetrics && (
          <View style={[styles.card, styles.socialCard]}>
            <Text style={styles.sectionTitle}>Impact social</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Valeur sociale</Text>
              <Text style={styles.infoValue}>{formatCurrency(socialMetrics.social_value ?? socialMetrics.current_market_value)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Partages totaux</Text>
              <Text style={styles.infoValue}>{socialMetrics.share_count}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Interactions</Text>
              <Text style={styles.infoValue}>{socialMetrics.interaction_count}</Text>
            </View>

            {(marketCap > 0 || capUnits > 0 || redistributionPool > 0) && (
              <View style={styles.stabilizationCard}>
                <View style={styles.stabilizationHeader}>
                  <Text style={styles.stabilizationTitle}>Bouclier de capitalisation</Text>
                  <Text style={styles.stabilizationValue}>{formatCompactCurrency(marketCap)}</Text>
                </View>
                <View style={styles.stabilizationBar}>
                  <View
                    style={[
                      styles.stabilizationProgress,
                      { width: `${Math.max(4, Math.min(100, capProgress * 100))}%` }
                    ]}
                  />
                </View>
                <Text style={styles.stabilizationHint}>
                  {capProgress >= 1
                    ? 'Palier atteint : influence ultra-diluée'
                    : `Palier visé : ${formatCompactCurrency(nextMilestone)}`}
                </Text>
                {redistributionPool > 0 && (
                  <Text style={styles.stabilizationHint}>
                    Redistribution: {formatCompactCurrency(redistributionPool)}
                  </Text>
                )}
                <Text style={styles.stabilizationMicro}>
                  {describeMicroInfluence(capUnits)}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Informations techniques */}
        <View style={[styles.card, styles.techCard]}>
          <Text style={styles.techTitle}>Informations techniques</Text>
          
          <View style={styles.techRow}>
            <Text style={styles.techLabel}>Type de flux</Text>
            <Text style={styles.techValue}>
              {gift.is_new_flow ? 'Nouveau système' : 'Ancien système'}
            </Text>
          </View>

          <View style={styles.techRow}>
            <Text style={styles.techLabel}>ID transaction</Text>
            <Text style={styles.techValue}>{gift.id}</Text>
          </View>
        </View>

        {timelineEntries.length > 0 && (
          <View style={[styles.card, styles.timelineCard]}>
            <Text style={styles.sectionTitle}>Chronologie</Text>
            {timelineEntries.map((event) => (
              <View key={event.label} style={styles.timelineRow}>
                <Text style={styles.timelineLabel}>{event.label}</Text>
                <Text style={styles.timelineValue}>{formatDate(event.value)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Boutons d'action */}
      {isActionable && !processing && (
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[styles.actionButton, styles.acceptButton]}
            onPress={handleAccept}
            disabled={processing}
          >
            <Text style={styles.actionButtonText}>Accepter le cadeau</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.declineButton]}
            onPress={handleDecline}
            disabled={processing}
          >
            <Text style={styles.actionButtonText}>Refuser le cadeau</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Indicateur de traitement */}
      {processing && (
        <View style={styles.processingContainer}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.processingText}>Traitement en cours...</Text>
        </View>
      )}
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
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
  },
  backButtonFull: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#667eea',
    borderRadius: 8,
  },
  backButtonFullText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  container: {
    flex: 1,
  },
  imageContainer: {
    width: '100%',
    height: 220,
    backgroundColor: '#f3f4f6',
  },
  giftImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e5e7eb',
  },
  imagePlaceholderIcon: {
    fontSize: 80,
  },
  giftTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1f2937',
    textAlign: 'center',
    marginTop: 20,
    marginHorizontal: 20,
    lineHeight: 32,
  },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginTop: 20,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  infoRow: {
    marginVertical: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: '#1f2937',
    fontWeight: '600',
  },
  referenceValue: {
    fontSize: 14,
    color: '#1d4ed8',
    fontWeight: '600',
  },
  separator: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 8,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    color: '#1f2937',
    fontWeight: '600',
  },
  messageCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#667eea',
  },
  messageLabel: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
    marginBottom: 8,
  },
  messageText: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 12,
  },
  financeCard: {
    backgroundColor: '#fefce8',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  socialCard: {
    backgroundColor: '#ecfeff',
    borderWidth: 1,
    borderColor: '#a5f3fc',
  },
  stabilizationCard: {
    marginTop: 16,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 12,
    padding: 12,
  },
  stabilizationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stabilizationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#312E81',
  },
  stabilizationValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4338CA',
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
  stabilizationHint: {
    fontSize: 12,
    color: '#4338CA',
    marginBottom: 4,
  },
  stabilizationMicro: {
    fontSize: 12,
    color: '#312E81',
    fontStyle: 'italic',
  },
  timelineCard: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  techCard: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  techTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 16,
  },
  techRow: {
    marginVertical: 6,
  },
  techLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 2,
  },
  techValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
  },
  timelineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  timelineLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  timelineValue: {
    fontSize: 13,
    color: '#1f2937',
    fontWeight: '500',
  },
  actionsContainer: {
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  actionButton: {
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  acceptButton: {
    backgroundColor: '#10B981',
  },
  declineButton: {
    backgroundColor: '#EF4444',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  processingContainer: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  processingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6b7280',
  },
});

export default GiftDetailsScreen;
import React, { useState, useCallback } from 'react';
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
  Modal,
  ScrollView,
  TextInput,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { purchaseService, InventoryItem } from '../services/purchase';
import { withdrawalService, WithdrawalValidation } from '../services/withdrawal';

const WITHDRAWAL_MIN_VALUE = 1000;
const WITHDRAWAL_FEE_RATE = 0.03;
const WITHDRAWAL_FEE_PERCENT = WITHDRAWAL_FEE_RATE * 100;
const WITHDRAWAL_FEE_LABEL = `${Math.round(WITHDRAWAL_FEE_PERCENT)}%`;
const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/300/667eea/ffffff?text=BOOM';
const WITHDRAWAL_MIN_LABEL = `${WITHDRAWAL_MIN_VALUE.toLocaleString('fr-FR')} FCFA`;

const pickNumber = (...candidates: Array<number | null | undefined>): number => {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return 0;
};

const safeNumber = (value: any, fallback: number = 0): number => {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return !isNaN(parsed) ? parsed : fallback;
  }
  return fallback;
};

const deriveValueBreakdown = (item: InventoryItem) => {
  const rawBom = item.bom || item.boom_data || item.bom_asset || {};
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

const normalizeInventoryItem = (item: InventoryItem, index: number): InventoryItem => {
  const rawBom = item.bom || item.boom_data || item.bom_asset || {};
  const { baseValue, microValue, totalValue } = deriveValueBreakdown(item);

  return {
    ...item,
    id: item.id || `temp-${index}-${Date.now()}`,
    bom: {
      ...rawBom,
      id: rawBom.id || item.bom_id || index,
      title: rawBom.title || 'Sans titre',
      artist: rawBom.artist || rawBom.creator_name || 'Artiste inconnu',
      base_value: baseValue,
      social_value: microValue,
      current_social_value: microValue,
      total_value: totalValue,
      value: totalValue,
      preview_image: rawBom.preview_image || rawBom.image_url || rawBom.thumbnail_url || PLACEHOLDER_IMAGE,
      description: rawBom.description || '',
      edition_type: rawBom.edition_type || 'standard',
      category: rawBom.category || 'Général',
      collection_name: rawBom.collection_name || rawBom.collection || 'Non classé',
      is_transferable: item.is_transferable !== false,
      withdrawal_eligible: totalValue >= WITHDRAWAL_MIN_VALUE,
    },
  } as InventoryItem;
};

export default function WithdrawalScreen({ navigation }: any) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [validationData, setValidationData] = useState<WithdrawalValidation | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [currentItemId, setCurrentItemId] = useState<number | null>(null);
  const [stats, setStats] = useState({
    totalValue: 0,
    totalBase: 0,
    totalMicro: 0,
    withdrawableCount: 0,
    totalFees: 0,
    totalNetAmount: 0,
  });

  const loadWithdrawableBooms = async (isRefresh = false) => {
    try {
      if (!isRefresh) {
        setLoading(true);
      }

      console.time('⏱️ [WITHDRAWAL] Temps chargement inventaire');
      console.log('🔄 [WITHDRAWAL] Chargement des BOOMS retirables...');

      const data = await purchaseService.getInventory();

      const normalizedData = (data || []).map((item, index) => normalizeInventoryItem(item, index));

      const withdrawableItems = normalizedData.filter(item => item.bom.withdrawal_eligible);
      const totalValue = withdrawableItems.reduce((sum, item) => sum + safeNumber(item.bom.value), 0);
      const totalBase = withdrawableItems.reduce((sum, item) => sum + safeNumber(item.bom.base_value), 0);
      const totalMicro = withdrawableItems.reduce((sum, item) => sum + safeNumber(item.bom.social_value ?? item.bom.current_social_value), 0);
      const totalFees = totalValue * WITHDRAWAL_FEE_RATE;
      const totalNetAmount = totalValue - totalFees;

      setStats({
        totalValue,
        totalBase,
        totalMicro,
        withdrawableCount: withdrawableItems.length,
        totalFees,
        totalNetAmount
      });

      setInventory(withdrawableItems);

      console.log('✅ [WITHDRAWAL] Inventaire traité:', {
        totalItems: normalizedData.length,
        withdrawableItems: withdrawableItems.length,
        totalValue,
        totalBase,
        totalMicro,
        totalFees,
        totalNetAmount
      });

      console.timeEnd('⏱️ [WITHDRAWAL] Temps chargement inventaire');
    } catch (error: any) {
      console.error('❌ [WITHDRAWAL] Erreur chargement:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      });

      Alert.alert(
        'Erreur de chargement',
        'Impossible de charger vos BOOMS retirables. Veuillez réessayer.'
      );
      setInventory([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      console.log('🎯 [WITHDRAWAL] Écran en focus - Rechargement');
      loadWithdrawableBooms();
    }, [])
  );

  const onRefresh = () => {
    console.log('🔄 [WITHDRAWAL] Rafraîchissement manuel');
    setRefreshing(true);
    loadWithdrawableBooms(true);
  };

  const handleValidateWithdrawal = async (item: InventoryItem) => {
    try {
      console.log('🔍 [WITHDRAWAL] Validation retrait:', {
        itemId: item.id,
        title: item.bom.title,
        value: item.bom.value
      });
      
      setWithdrawing(item.id);
      
      const validation = await withdrawalService.validateBomWithdrawal(item.id);
      
      console.log('✅ [WITHDRAWAL] Validation reçue:', validation);
      
      setValidationData(validation);
      setCurrentItemId(item.id);
      
      if (validation.is_approved) {
        setShowValidationModal(true);
      } else {
        Alert.alert(
          '❌ Retrait non approuvé',
          validation.rejection_reason || 'Cette œuvre ne peut pas être retirée pour le moment.',
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      console.error('❌ [WITHDRAWAL] Erreur validation:', error);
      Alert.alert(
        'Erreur de validation',
        error.message || 'Impossible de valider ce retrait. Veuillez réessayer.'
      );
    } finally {
      setWithdrawing(null);
    }
  };

  const handleExecuteWithdrawal = async () => {
    if (!currentItemId || !phoneNumber) {
      Alert.alert('Erreur', 'Veuillez saisir un numéro de téléphone valide.');
      return;
    }

    try {
      console.log('🚀 [WITHDRAWAL] Exécution retrait:', {
        itemId: currentItemId,
        phoneNumber: phoneNumber
      });
      
      setWithdrawing(currentItemId);
      setShowValidationModal(false);
      
      const result = await withdrawalService.executeBomWithdrawal({
        userBomId: currentItemId,
        phoneNumber,
        provider: 'wave'
      });
      
      console.log('🎉 [WITHDRAWAL] Retrait réussi:', result);
      
      Alert.alert(
        '✅ Retrait effectué !',
        `💵 Montant envoyé: ${formatCurrency(result.net_amount)}\n` +
        `📉 Frais appliqués (${WITHDRAWAL_FEE_LABEL}): ${formatCurrency(result.fees)}\n` +
        `📱 Numéro crédité: ${phoneNumber}\n` +
        (result.payout_reference ? `🔁 Référence: ${result.payout_reference}\n` : '') +
        (result.message ? `ℹ️ ${result.message}` : 'Le transfert est en cours de traitement.'),
        [
          { 
            text: 'OK', 
            onPress: () => {
              loadWithdrawableBooms();
              navigation.goBack();
            }
          }
        ]
      );
      
    } catch (error: any) {
      console.error('❌ [WITHDRAWAL] Erreur exécution:', error);
      Alert.alert(
        'Erreur de retrait',
        error.message || 'Le retrait a échoué. Veuillez réessayer.'
      );
    } finally {
      setWithdrawing(null);
      setPhoneNumber('');
      setCurrentItemId(null);
      setShowPhoneModal(false);
      setValidationData(null);
    }
  };

  const formatCurrency = (amount: number) => {
    return parseFloat(amount.toFixed(4)).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' FCFA';
  };

  const renderInventoryItem = ({ item }: { item: InventoryItem }) => {
    const totalValue = safeNumber(item.bom.value);
    const baseValue = safeNumber(item.bom.base_value ?? totalValue);
    const microValue = Math.max(0, safeNumber(item.bom.social_value ?? item.bom.current_social_value ?? (totalValue - baseValue)));
    const netAmount = totalValue * (1 - WITHDRAWAL_FEE_RATE);
    const fees = totalValue * WITHDRAWAL_FEE_RATE;
    const isWithdrawing = withdrawing === item.id;
    
    return (
      <View style={styles.inventoryItem}>
        <Image 
          source={{ uri: item.bom.preview_image }} 
          style={styles.itemImage}
          defaultSource={{ uri: 'https://via.placeholder.com/300/667eea/ffffff?text=BOOM' }}
          onError={() => console.log('❌ [WITHDRAWAL] Erreur chargement image:', item.bom.title)}
        />
        
        <View style={styles.itemContent}>
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
          
          <View style={styles.valueSection}>
            <Text style={styles.itemValue}>
              💎 Valeur totale: {formatCurrency(totalValue)}
            </Text>

            <View style={styles.valueBreakdownRow}>
              <View style={styles.valueBadge}>
                <Text style={styles.valueBadgeLabel}>Base</Text>
                <Text style={styles.valueBadgeValue}>{formatCurrency(baseValue)}</Text>
              </View>
              <View style={styles.valueBadge}>
                <Text style={styles.valueBadgeLabel}>Bonus social</Text>
                <Text style={styles.valueBadgeValue}>{formatCurrency(microValue)}</Text>
              </View>
            </View>
            
            <View style={styles.feeInfo}>
              <Text style={styles.feeText}>
                📉 Frais ({WITHDRAWAL_FEE_LABEL}): {formatCurrency(fees)}
              </Text>
              <Text style={styles.netValue}>
                💵 Net à recevoir: {formatCurrency(netAmount)}
              </Text>
            </View>
          </View>
          
          <TouchableOpacity
            style={[
              styles.withdrawButton,
              isWithdrawing && styles.buttonDisabled
            ]}
            onPress={() => handleValidateWithdrawal(item)}
            disabled={isWithdrawing}
            activeOpacity={0.7}
          >
            {isWithdrawing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.withdrawButtonText}>
                💰 Retirer {formatCurrency(netAmount)}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderValidationModal = () => {
    if (!validationData || !currentItemId) return null;
    const isProcessing = withdrawing === currentItemId;
    
    return (
      <Modal
        visible={showValidationModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowValidationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Validation réussie ✅</Text>
              <TouchableOpacity 
                onPress={() => setShowValidationModal(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalContent}>
              <View style={styles.validationInfo}>
                <Text style={styles.validationItemTitle}>
                  {validationData.bom_title}
                </Text>
                
                <View style={styles.validationAmounts}>
                  <View style={styles.amountRow}>
                    <Text style={styles.amountLabel}>Valeur de l'œuvre:</Text>
                    <Text style={styles.amountValue}>
                      {formatCurrency(validationData.bom_value)}
                    </Text>
                  </View>
                  
                  <View style={styles.amountRow}>
                    <Text style={styles.amountLabel}>Frais de retrait ({WITHDRAWAL_FEE_LABEL}):</Text>
                    <Text style={[styles.amountValue, styles.feeAmount]}>
                      -{formatCurrency(validationData.fees)}
                    </Text>
                  </View>
                  
                  <View style={styles.separator} />
                  
                  <View style={styles.amountRow}>
                    <Text style={[styles.amountLabel, styles.netAmountLabel]}>Net à recevoir:</Text>
                    <Text style={[styles.amountValue, styles.netAmountValue]}>
                      {formatCurrency(validationData.net_amount)}
                    </Text>
                  </View>
                </View>
                
                <Text style={styles.validationNote}>
                  Les retraits s'effectuent uniquement vers le mobile money (Wave, Orange, Moov...).
                </Text>
              </View>
            </ScrollView>
            
            <View style={styles.actionButtonsWrapper}>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionPrimary, isProcessing && styles.buttonDisabled]}
                onPress={() => {
                  setShowValidationModal(false);
                  setShowPhoneModal(true);
                }}
                disabled={isProcessing}
                activeOpacity={0.85}
              >
                <Text style={styles.actionButtonText}>Retrait mobile money ({WITHDRAWAL_FEE_LABEL})</Text>
                <Text style={styles.actionButtonSubtext}>
                  Montant estimé: {formatCurrency(validationData.net_amount)}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActionsSingle}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowValidationModal(false)}
              >
                <Text style={styles.cancelButtonText}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderPhoneModal = () => (
    <Modal
      visible={showPhoneModal}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowPhoneModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Numéro de téléphone</Text>
            <TouchableOpacity 
              onPress={() => setShowPhoneModal(false)}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.modalContent}>
            <Text style={styles.phoneInputLabel}>
              Entrez votre numéro de téléphone pour recevoir l'argent:
            </Text>
            
            <TextInput
              style={styles.phoneInput}
              placeholder="Ex: 0700000000"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              autoFocus={true}
              maxLength={10}
            />
            
            <Text style={styles.phoneNote}>
              Numéros acceptés: 07 / 05 / 01 / 27 + 8 chiffres (Wave, Orange Money, Moov Money...).
            </Text>
          </View>
          
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => setShowPhoneModal(false)}
            >
              <Text style={styles.cancelButtonText}>Annuler</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.modalButton, 
                styles.confirmButton,
                !phoneNumber && styles.buttonDisabled
              ]}
              onPress={handleExecuteWithdrawal}
              disabled={!phoneNumber || withdrawing !== null}
            >
              {withdrawing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmButtonText}>
                  Confirmer et recevoir {validationData?.net_amount ? formatCurrency(validationData.net_amount) : ''}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#667eea" />
        <Text style={styles.loadingText}>Chargement des BOOMS retirables...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8f9fa" />
      
      {/* En-tête */}
      <View style={styles.header}>
        <Text style={styles.title}>💸 Retrait d'argent</Text>
        <Text style={styles.subtitle}>
          Convertissez vos œuvres en argent liquide
        </Text>
        
        {inventory.length > 0 && (
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Œuvres retirables</Text>
              <Text style={styles.statValue}>{stats.withdrawableCount}</Text>
            </View>
            
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Valeur totale</Text>
              <Text style={[styles.statValue, styles.valueText]}>
                {formatCurrency(stats.totalValue)}
              </Text>
            </View>
            
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Net à recevoir</Text>
              <Text style={[styles.statValue, styles.netText]}>
                {formatCurrency(stats.totalNetAmount)}
              </Text>
            </View>
          </View>
        )}

        {inventory.length > 0 && (
          <View style={styles.statsBreakdownRow}>
            <View style={styles.statsBreakdownCard}>
              <Text style={styles.breakdownLabel}>Base cumulée</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(stats.totalBase)}</Text>
            </View>
            <View style={styles.statsBreakdownCard}>
              <Text style={styles.breakdownLabel}>Bonus sociaux</Text>
              <Text style={styles.breakdownValue}>{formatCurrency(stats.totalMicro)}</Text>
            </View>
          </View>
        )}
        
        <View style={styles.infoContainer}>
          <Text style={styles.infoText}>
            ℹ️ Retrait mobile money: {WITHDRAWAL_FEE_LABEL} • Minimum: {WITHDRAWAL_MIN_LABEL}
          </Text>
        </View>
      </View>

      {/* Contenu principal */}
      {inventory.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Aucun Boom retirable</Text>
          <Text style={styles.emptyText}>
            Vos œuvres doivent avoir une valeur minimale de {WITHDRAWAL_MIN_LABEL} pour être retirées.
          </Text>
          
          <View style={styles.emptyStats}>
            <Text style={styles.emptyStat}>
              💰 Minimum par retrait: {WITHDRAWAL_MIN_LABEL}
            </Text>
            <Text style={styles.emptyStat}>
              📉 Retrait mobile money: {WITHDRAWAL_FEE_LABEL} de frais
            </Text>
            <Text style={styles.emptyStat}>
              📱 Un numéro mobile money valide est requis
            </Text>
            <Text style={styles.emptyStat}>
              ⏱️ Délai de paiement: 24-48h
            </Text>
          </View>
          
          <TouchableOpacity 
            style={styles.browseButton}
            onPress={() => navigation.navigate('Catalogue')}
            activeOpacity={0.7}
          >
            <Text style={styles.browseButtonText}>
              🖼️ Parcourir le catalogue
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={inventory}
          renderItem={renderInventoryItem}
          keyExtractor={(item) => item.id?.toString() || Math.random().toString()}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh}
              colors={['#667eea']}
              tintColor="#667eea"
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.listHeader}>
              Sélectionnez une œuvre à retirer ({inventory.length} disponible{inventory.length > 1 ? 's' : ''})
            </Text>
          }
          ListFooterComponent={<View style={styles.listFooter} />}
        />
      )}

      {/* Modals */}
      {renderValidationModal()}
      {renderPhoneModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  header: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statsBreakdownRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statsBreakdownCard: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  breakdownLabel: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  breakdownValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    marginHorizontal: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#6C757D',
    marginBottom: 4,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  valueText: {
    color: '#28A745',
  },
  netText: {
    color: '#667eea',
  },
  infoContainer: {
    backgroundColor: '#E3F2FD',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BBDEFB',
  },
  infoText: {
    fontSize: 13,
    color: '#1976D2',
    textAlign: 'center',
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#667eea',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyStats: {
    backgroundColor: '#F8F9FA',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    width: '100%',
  },
  emptyStat: {
    fontSize: 14,
    color: '#495057',
    marginBottom: 8,
    textAlign: 'center',
  },
  browseButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: '#667eea',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
  },
  listHeader: {
    fontSize: 14,
    color: '#6C757D',
    marginBottom: 16,
    textAlign: 'center',
  },
  listFooter: {
    height: 30,
  },
  inventoryItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 16,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    overflow: 'hidden',
  },
  itemImage: {
    width: 100,
    height: 120,
    resizeMode: 'cover',
  },
  itemContent: {
    flex: 1,
    padding: 16,
  },
  itemTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  itemArtist: {
    fontSize: 14,
    color: '#667eea',
    marginBottom: 4,
    fontWeight: '500',
  },
  itemCollection: {
    fontSize: 12,
    color: '#666',
    marginBottom: 12,
  },
  valueSection: {
    marginBottom: 16,
  },
  itemValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#28A745',
    marginBottom: 8,
  },
  valueBreakdownRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  valueBadge: {
    flex: 1,
    minWidth: 120,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  valueBadgeLabel: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  valueBadgeValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  feeInfo: {
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  feeText: {
    fontSize: 14,
    color: '#DC3545',
    marginBottom: 4,
    fontWeight: '600',
  },
  netValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#667eea',
  },
  withdrawButton: {
    backgroundColor: '#667eea',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  withdrawButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '90%',
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    color: '#666',
    fontWeight: '500',
  },
  modalContent: {
    maxHeight: 400,
  },
  validationInfo: {
    padding: 20,
  },
  validationItemTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 20,
    textAlign: 'center',
  },
  validationAmounts: {
    backgroundColor: '#F8F9FA',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  amountLabel: {
    fontSize: 16,
    color: '#495057',
    fontWeight: '500',
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  feeAmount: {
    color: '#DC3545',
  },
  separator: {
    height: 1,
    backgroundColor: '#DEE2E6',
    marginVertical: 16,
  },
  netAmountLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  netAmountValue: {
    fontSize: 24,
    color: '#28A745',
    fontWeight: '700',
  },
  validationNote: {
    fontSize: 14,
    color: '#6C757D',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },
  actionButtonsWrapper: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 12,
  },
  actionButton: {
    padding: 16,
    borderRadius: 10,
  },
  actionPrimary: {
    backgroundColor: '#667eea',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionButtonSubtext: {
    fontSize: 13,
    color: '#E0E7FF',
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 12,
  },
  modalActionsSingle: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  modalButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#DEE2E6',
  },
  confirmButton: {
    backgroundColor: '#667eea',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#495057',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  phoneInputLabel: {
    fontSize: 16,
    color: '#495057',
    marginBottom: 16,
    textAlign: 'center',
  },
  phoneInput: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#DEE2E6',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  phoneNote: {
    fontSize: 14,
    color: '#6C757D',
    textAlign: 'center',
    lineHeight: 20,
  },
});
import React, { useState, useEffect, useCallback } from 'react';
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
import { purchaseService, InventoryItem } from '../services/purchase';
import { withdrawalService, WithdrawalValidation, WithdrawalResult } from '../services/withdrawal';
import { useAuth } from '../contexts/AuthContext';
import { useFocusEffect } from '@react-navigation/native';

// Fonction utilitaire pour acc├®der aux propri├®t├®s de mani├¿re s├®curis├®e
const safeGet = <T,>(obj: any, path: string, fallback: T): T => {
  if (!obj || typeof obj !== 'object') return fallback;
  
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

// Fonction utilitaire pour les nombres
const safeNumber = (value: any, fallback: number = 0): number => {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return !isNaN(parsed) ? parsed : fallback;
  }
  return fallback;
};

export default function WithdrawalScreen({ navigation }: any) {
  const { user } = useAuth();
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
    withdrawableCount: 0,
    totalFees: 0,
    totalNetAmount: 0
  });

  const loadWithdrawableBooms = async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      
      console.time('ÔÅ▒´©Å [WITHDRAWAL] Temps chargement inventaire');
      console.log('­ƒöä [WITHDRAWAL] Chargement des BOOMS retirables...');
      
      const data = await purchaseService.getInventory();
      
      console.log('­ƒôè [WITHDRAWAL] Donn├®es re├ºues:', {
        totalItems: data?.length || 0,
        sampleItem: data && data.length > 0 ? {
          id: data[0].id,
          hasBom: 'bom' in data[0],
          hasBoom_data: 'boom_data' in data[0],
          bomKeys: data[0].bom ? Object.keys(data[0].bom) : 'N/A',
          boom_dataKeys: data[0].boom_data ? Object.keys(data[0].boom_data) : 'N/A'
        } : 'Aucune donn├®e'
      });

      // Normalisation et nettoyage des donn├®es
      const normalizedData = (data || []).map((item, index) => {
        const bom = item.bom || item.boom_data || {};
        const value = safeNumber(bom.value);
        
        return {
          ...item,
          id: item.id || `temp-${index}-${Date.now()}`,
          bom: {
            id: bom.id || index,
            title: bom.title || 'Sans titre',
            artist: bom.artist || bom.creator_name || 'Artiste inconnu',
            value: value,
            social_value: safeNumber(bom.social_value),
            preview_image: bom.preview_image || bom.image_url || bom.thumbnail_url || 
                         'https://via.placeholder.com/300/667eea/ffffff?text=BOOM',
            description: bom.description || '',
            edition_type: bom.edition_type || 'standard',
            category: bom.category || 'G├®n├®ral',
            collection_name: bom.collection_name || bom.collection || 'Non class├®',
            is_transferable: item.is_transferable !== false,
            withdrawal_eligible: value >= 1000 // Minimum 1000 FCFA pour retrait
          }
        };
      });

      // Filtrer les items retirables (valeur >= 1000 FCFA)
      const withdrawableItems = normalizedData.filter(item => item.bom.withdrawal_eligible);
      
      // Calculer les statistiques
      const totalValue = withdrawableItems.reduce((sum, item) => sum + safeNumber(item.bom.value), 0);
      const totalFees = totalValue * 0.05; // Frais de 5%
      const totalNetAmount = totalValue - totalFees;
      
      setStats({
        totalValue,
        withdrawableCount: withdrawableItems.length,
        totalFees,
        totalNetAmount
      });
      
      setInventory(withdrawableItems);
      
      console.log('Ô£à [WITHDRAWAL] Inventaire trait├®:', {
        totalItems: normalizedData.length,
        withdrawableItems: withdrawableItems.length,
        totalValue,
        totalFees,
        totalNetAmount
      });
      
      console.timeEnd('ÔÅ▒´©Å [WITHDRAWAL] Temps chargement inventaire');
      
    } catch (error: any) {
      console.error('ÔØî [WITHDRAWAL] Erreur chargement:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data
      });
      
      Alert.alert(
        'Erreur de chargement',
        'Impossible de charger vos BOOMS retirables. Veuillez r├®essayer.'
      );
      setInventory([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      console.log('­ƒÄ» [WITHDRAWAL] ├ëcran en focus - Rechargement');
      loadWithdrawableBooms();
    }, [])
  );

  const onRefresh = () => {
    console.log('­ƒöä [WITHDRAWAL] Rafra├«chissement manuel');
    setRefreshing(true);
    loadWithdrawableBooms(true);
  };

  const handleValidateWithdrawal = async (item: InventoryItem) => {
    try {
      console.log('­ƒöì [WITHDRAWAL] Validation retrait:', {
        itemId: item.id,
        title: item.bom.title,
        value: item.bom.value
      });
      
      setWithdrawing(item.id);
      
      const validation = await withdrawalService.validateBomWithdrawal(item.id);
      
      console.log('Ô£à [WITHDRAWAL] Validation re├ºue:', validation);
      
      setValidationData(validation);
      setCurrentItemId(item.id);
      
      if (validation.is_approved) {
        setShowValidationModal(true);
      } else {
        Alert.alert(
          'ÔØî Retrait non approuv├®',
          validation.rejection_reason || 'Cette ┼ôuvre ne peut pas ├¬tre retir├®e pour le moment.',
          [{ text: 'OK' }]
        );
      }
    } catch (error: any) {
      console.error('ÔØî [WITHDRAWAL] Erreur validation:', error);
      Alert.alert(
        'Erreur de validation',
        error.message || 'Impossible de valider ce retrait. Veuillez r├®essayer.'
      );
    } finally {
      setWithdrawing(null);
    }
  };

  const handleExecuteWithdrawal = async () => {
    if (!currentItemId || !phoneNumber) {
      Alert.alert('Erreur', 'Veuillez saisir un num├®ro de t├®l├®phone valide.');
      return;
    }

    try {
      console.log('­ƒÜÇ [WITHDRAWAL] Ex├®cution retrait:', {
        itemId: currentItemId,
        phoneNumber: phoneNumber
      });
      
      setWithdrawing(currentItemId);
      setShowValidationModal(false);
      
      const result = await withdrawalService.executeBomWithdrawal(currentItemId, phoneNumber);
      
      console.log('­ƒÄë [WITHDRAWAL] Retrait r├®ussi:', result);
      
      Alert.alert(
        'Ô£à Retrait effectu├® !',
        `­ƒÆÁ Montant re├ºu: ${result.net_amount.toLocaleString()} FCFA\n` +
        `­ƒôë Frais appliqu├®s (5%): ${result.fees.toLocaleString()} FCFA\n` +
        `­ƒÆ░ Nouveau solde: ${result.new_liquid_balance.toLocaleString()} FCFA\n\n` +
        `L'argent a ├®t├® envoy├® au: ${phoneNumber}`,
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
      console.error('ÔØî [WITHDRAWAL] Erreur ex├®cution:', error);
      Alert.alert(
        'Erreur de retrait',
        error.message || 'Le retrait a ├®chou├®. Veuillez r├®essayer.'
      );
    } finally {
      setWithdrawing(null);
      setPhoneNumber('');
      setCurrentItemId(null);
      setShowPhoneModal(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }) + ' FCFA';
  };

  const renderInventoryItem = ({ item }: { item: InventoryItem }) => {
    const netAmount = safeNumber(item.bom.value) * 0.95;
    const fees = safeNumber(item.bom.value) * 0.05;
    const isWithdrawing = withdrawing === item.id;
    
    return (
      <View style={styles.inventoryItem}>
        <Image 
          source={{ uri: item.bom.preview_image }} 
          style={styles.itemImage}
          defaultSource={{ uri: 'https://via.placeholder.com/300/667eea/ffffff?text=BOOM' }}
          onError={() => console.log('ÔØî [WITHDRAWAL] Erreur chargement image:', item.bom.title)}
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
              ­ƒÆÄ Valeur: {formatCurrency(item.bom.value)}
            </Text>
            
            <View style={styles.feeInfo}>
              <Text style={styles.feeText}>
                ­ƒôë Frais (5%): {formatCurrency(fees)}
              </Text>
              <Text style={styles.netValue}>
                ­ƒÆÁ Net ├á recevoir: {formatCurrency(netAmount)}
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
                ­ƒÆ░ Retirer {formatCurrency(netAmount)}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderValidationModal = () => {
    if (!validationData || !currentItemId) return null;
    
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
              <Text style={styles.modalTitle}>Validation r├®ussie Ô£à</Text>
              <TouchableOpacity 
                onPress={() => setShowValidationModal(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>Ô£ò</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalContent}>
              <View style={styles.validationInfo}>
                <Text style={styles.validationItemTitle}>
                  {validationData.bom_title}
                </Text>
                
                <View style={styles.validationAmounts}>
                  <View style={styles.amountRow}>
                    <Text style={styles.amountLabel}>Valeur de l'┼ôuvre:</Text>
                    <Text style={styles.amountValue}>
                      {formatCurrency(validationData.bom_value)}
                    </Text>
                  </View>
                  
                  <View style={styles.amountRow}>
                    <Text style={styles.amountLabel}>Frais de retrait (5%):</Text>
                    <Text style={[styles.amountValue, styles.feeAmount]}>
                      -{formatCurrency(validationData.fees)}
                    </Text>
                  </View>
                  
                  <View style={styles.separator} />
                  
                  <View style={styles.amountRow}>
                    <Text style={[styles.amountLabel, styles.netAmountLabel]}>Net ├á recevoir:</Text>
                    <Text style={[styles.amountValue, styles.netAmountValue]}>
                      {formatCurrency(validationData.net_amount)}
                    </Text>
                  </View>
                </View>
                
                <Text style={styles.validationNote}>
                  Le montant net sera envoy├® sur votre compte mobile money.
                </Text>
              </View>
            </ScrollView>
            
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowValidationModal(false)}
              >
                <Text style={styles.cancelButtonText}>Annuler</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={() => {
                  setShowValidationModal(false);
                  setShowPhoneModal(true);
                }}
              >
                <Text style={styles.confirmButtonText}>Confirmer le retrait</Text>
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
            <Text style={styles.modalTitle}>Num├®ro de t├®l├®phone</Text>
            <TouchableOpacity 
              onPress={() => setShowPhoneModal(false)}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>Ô£ò</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.modalContent}>
            <Text style={styles.phoneInputLabel}>
              Entrez votre num├®ro de t├®l├®phone pour recevoir l'argent:
            </Text>
            
            <TextInput
              style={styles.phoneInput}
              placeholder="Ex: 770000000"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              autoFocus={true}
              maxLength={10}
            />
            
            <Text style={styles.phoneNote}>
              Le num├®ro doit ├¬tre associ├® ├á un service mobile money (Orange Money, Moov Money, etc.)
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
      
      {/* En-t├¬te */}
      <View style={styles.header}>
        <Text style={styles.title}>­ƒÆ© Retrait d'argent</Text>
        <Text style={styles.subtitle}>
          Convertissez vos ┼ôuvres en argent liquide
        </Text>
        
        {inventory.length > 0 && (
          <View style={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>┼Æuvres retirables</Text>
              <Text style={styles.statValue}>{stats.withdrawableCount}</Text>
            </View>
            
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Valeur totale</Text>
              <Text style={[styles.statValue, styles.valueText]}>
                {formatCurrency(stats.totalValue)}
              </Text>
            </View>
            
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Net ├á recevoir</Text>
              <Text style={[styles.statValue, styles.netText]}>
                {formatCurrency(stats.totalNetAmount)}
              </Text>
            </View>
          </View>
        )}
        
        <View style={styles.infoContainer}>
          <Text style={styles.infoText}>
            Ôä╣´©Å Frais de retrait: 5% ÔÇó Minimum: 1,000 FCFA ÔÇó Paiement mobile money
          </Text>
        </View>
      </View>

      {/* Contenu principal */}
      {inventory.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Aucun Boom retirable</Text>
          <Text style={styles.emptyText}>
            Vos ┼ôuvres doivent avoir une valeur minimale de 1,000 FCFA pour ├¬tre retir├®es.
          </Text>
          
          <View style={styles.emptyStats}>
            <Text style={styles.emptyStat}>
              ­ƒÆ░ Minimum par retrait: 1,000 FCFA
            </Text>
            <Text style={styles.emptyStat}>
              ­ƒôë Frais appliqu├®s: 5%
            </Text>
            <Text style={styles.emptyStat}>
              ÔÅ▒´©Å D├®lai de paiement: 24-48h
            </Text>
          </View>
          
          <TouchableOpacity 
            style={styles.browseButton}
            onPress={() => navigation.navigate('Catalogue')}
            activeOpacity={0.7}
          >
            <Text style={styles.browseButtonText}>
              ­ƒû╝´©Å Parcourir le catalogue
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
              S├®lectionnez une ┼ôuvre ├á retirer ({inventory.length} disponible{inventory.length > 1 ? 's' : ''})
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
  modalActions: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    gap: 12,
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

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ScrollView
} from 'react-native';
import { useWallet } from '../contexts/WalletContext';
import { walletService, Transaction } from '../services/wallet';

type TransactionWithMeta = Transaction & {
  metadata?: {
    base_value?: number | null;
    micro_value?: number | null;
    total_value?: number | null;
    [key: string]: any;
  };
  financial_details?: {
    base_amount?: number | null;
    social_bonus?: number | null;
    total_amount?: number | null;
    [key: string]: any;
  };
};

const pickNumber = (...candidates: Array<number | null | undefined>): number => {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return 0;
};

const computeTransactionBreakdown = (transaction: TransactionWithMeta) => {
  const absAmount = Math.abs(transaction.amount);
  const totalValue = Math.max(0, pickNumber(
    transaction.metadata?.total_value,
    transaction.financial_details?.total_amount,
    absAmount
  ));
  const baseValue = Math.max(0, pickNumber(
    transaction.metadata?.base_value,
    transaction.financial_details?.base_amount,
    absAmount
  ));
  const microValue = Math.max(0, pickNumber(
    transaction.metadata?.micro_value,
    transaction.financial_details?.social_bonus,
    totalValue - baseValue
  ));
  const normalizedTotal = Math.max(totalValue, baseValue + microValue);
  return {
    baseValue,
    microValue,
    totalValue: normalizedTotal
  };
};

const formatSignedAmount = (value: number, isPositive: boolean) => {
  const sign = isPositive ? '+' : '-';
  return `${sign}${parseFloat(Math.abs(value).toFixed(4)).toLocaleString('fr-FR')} FCFA`;
};

export default function WalletScreen({ navigation }: any) {
  // ✅ CORRECTION: Mise à jour des noms de variables du contexte
  const { 
    cashBalance,            // ✅ Anciennement realBalance
    virtualBalance,         // ✅ Anciennement balance
    usableBalance,          // ✅ NOUVEAU: Solde réel utilisable
    loading: walletLoading,
    getBalanceBreakdown,
    hasSufficientFunds,     // ✅ AMÉLIORATION: Méthode utilitaire
    requestBackendSync
  } = useWallet();
  
  const [transactions, setTransactions] = useState<TransactionWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    console.log('💰 WalletScreen monté');
    console.log('📊 État initial soldes:');
    const breakdown = getBalanceBreakdown();
    console.log('   💳 Solde réel (cash):', breakdown.cash, 'FCFA');
    console.log('   🎁 Solde virtuel:', breakdown.virtual, 'FCFA');
    console.log('   ✅ Solde utilisable:', breakdown.usable, 'FCFA');
    
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    console.log('📋 Chargement transactions...');
    try {
      const transactionsData = await walletService.getTransactions();
      console.log(`✅ ${transactionsData.length} transactions chargées`);
      setTransactions(transactionsData as TransactionWithMeta[]);
    } catch (error: any) {
      console.error('❌ Erreur chargement transactions:', error.message || error);
      Alert.alert('Erreur', 'Impossible de charger les transactions');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    console.log('🔄 Refresh manuel déclenché');
    setRefreshing(true);
    try {
      await loadTransactions();
      await requestBackendSync('wallet-screen-refresh');
    } catch (error) {
      console.warn('⚠️ Impossible de resynchroniser le WalletContext:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.warn('⚠️ Erreur format date:', dateString);
      return 'Date inconnue';
    }
  };

  const isPositiveTransaction = (transaction: Transaction): boolean => {
    const { transaction_type, amount } = transaction;
    
    console.log(`🔍 Transaction ${transaction.id}: type=${transaction_type}, amount=${amount}`);

    // ✅ AMÉLIORATION: Règles métier claires avec séparation réel/virtuel
    const CASH_CREDIT_TYPES = [
      'deposit', 'deposit_real', 'refund', 'boom_sell_real', 'boom_sell',
      'gift_received_real', 'commission_received_real', 'cashback_real'
    ];

    const CASH_DEBIT_TYPES = [
      'withdrawal', 'withdrawal_real', 'boom_purchase_real', 'boom_purchase',
      'purchase', 'fee_real', 'commission_paid_real', 'gift_sent_real'
    ];

    const VIRTUAL_CREDIT_TYPES = [
      'redistribution_received', 'royalties_redistribution',
      'community_bonus', 'system_redistribution',
      'bonus_received', 'royalties_received', 'reward_real'
    ];

    // Vérification par type
    if (CASH_CREDIT_TYPES.includes(transaction_type) || 
        VIRTUAL_CREDIT_TYPES.includes(transaction_type)) {
      return true; // CRÉDIT (réel ou virtuel)
    }
    if (CASH_DEBIT_TYPES.includes(transaction_type)) {
      return false; // DÉBIT RÉEL
    }

    // Fallback par montant
    return amount > 0;
  };

  // ✅ AMÉLIORATION: Fonction pour déterminer la cible de la transaction
  const getTransactionTarget = (type: string): 'real' | 'virtual' | 'neutral' => {
    if (type.includes('real') || 
        type.includes('deposit') || 
        type.includes('withdrawal') ||
        type.includes('purchase') ||
        type.includes('sell') ||
        type.includes('fee') ||
        type.includes('commission')) {
      return 'real'; // Affecte le solde RÉEL
    }
    if (type.includes('redistribution') || 
        type.includes('bonus') || 
        type.includes('royalties')) {
      return 'virtual'; // Affecte le solde VIRTUEL
    }
    return 'neutral'; // Neutre ou système
  };

  const getTransactionIcon = (type: string) => {
    // ✅ AMÉLIORATION: Icônes plus spécifiques
    if (type.includes('deposit')) return '📥';
    if (type.includes('withdrawal')) return '📤';
    if (type.includes('boom_sell')) return '💰';
    if (type.includes('boom_purchase')) return '🛒';
    if (type.includes('redistribution')) return '🔄';
    if (type.includes('bonus')) return '🎁';
    if (type.includes('royalties')) return '👑';
    if (type.includes('fee')) return '💸';
    if (type.includes('gift')) return '🎀';
    return '🔁';
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#667eea" />
        <Text style={styles.loadingText}>Chargement du portefeuille...</Text>
      </View>
    );
  }

  const breakdown = getBalanceBreakdown();

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* ✅ AMÉLIORATION: En-tête plus explicite */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mon Portefeuille</Text>
        <Text style={styles.headerSubtitle}>
          Gestion séparée de vos soldes réel et virtuel
        </Text>
      </View>

      {/* ✅ CORRECTION: Section argent RÉEL avec noms actualisés */}
      <View style={styles.balanceSection}>
        <Text style={styles.sectionTitle}>💳 Argent Réel</Text>
        <Text style={styles.sectionDescription}>
          Utilisable pour les achats BOOM, dépôts et retraits
        </Text>
        
        <View style={styles.realBalanceCard}>
          <View style={styles.balanceMain}>
            <Text style={styles.balanceLabel}>Solde disponible</Text>
            <Text style={styles.realBalanceAmount}>
              {usableBalance.toLocaleString()} FCFA
            </Text>
            <Text style={styles.realBalanceHint}>
              Pour achats, dépôts et retraits
            </Text>
          </View>
          
          <View style={styles.actionButtons}>
            <TouchableOpacity 
              style={styles.primaryButton}
              onPress={() => {
                console.log('📥 Navigation vers Dépôt (argent réel)');
                navigation.navigate('Deposit');
              }}
            >
              <Text style={styles.primaryButtonText}>📥 Dépôt</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.secondaryButton}
              onPress={() => {
                console.log('💰 Navigation vers Retrait (argent réel)');
                navigation.navigate('Withdrawal');
              }}
            >
              <Text style={styles.secondaryButtonText}>📤 Retrait</Text>
            </TouchableOpacity>
          </View>
          
          {/* ✅ AMÉLIORATION: Affichage détaillé au clic */}
          <TouchableOpacity 
            style={styles.infoButton}
            onPress={() => setShowBreakdown(!showBreakdown)}
          >
            <Text style={styles.infoButtonText}>
              {showBreakdown ? '▲' : '▼'} Détails
            </Text>
          </TouchableOpacity>
          
          {showBreakdown && (
            <View style={styles.breakdownCard}>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Total réel:</Text>
                <Text style={styles.breakdownValue}>
                  {breakdown.cash.toLocaleString()} FCFA
                </Text>
              </View>
              {breakdown.locked > 0 && (
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Bloqué:</Text>
                  <Text style={styles.breakdownValue}>
                    -{breakdown.locked.toLocaleString()} FCFA
                  </Text>
                </View>
              )}
              <View style={styles.divider} />
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Disponible:</Text>
                <Text style={[styles.breakdownValue, styles.availableValue]}>
                  {breakdown.usable.toLocaleString()} FCFA
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* ✅ CORRECTION: Section argent VIRTUEL avec noms actualisés */}
      <View style={styles.balanceSection}>
        <Text style={styles.sectionTitle}>🎁 Argent Virtuel</Text>
        <Text style={styles.sectionDescription}>
          Redistributions communautaires - Non utilisable pour les achats
        </Text>
        
        <View style={styles.virtualBalanceCard}>
          <View style={styles.balanceMain}>
            <Text style={styles.balanceLabel}>Redistributions reçues</Text>
            <Text style={styles.virtualBalanceAmount}>
              {virtualBalance.toLocaleString()} FCFA
            </Text>
            <Text style={styles.virtualBalanceHint}>
              Ces fonds seront activés dans une prochaine version
            </Text>
          </View>
          
          {/* ✅ AMÉLIORATION: Information sur l'utilisation */}
          <View style={styles.virtualInfo}>
            <Text style={styles.virtualInfoText}>• Revenus de partage social</Text>
            <Text style={styles.virtualInfoText}>• Redistributions communautaires</Text>
            <Text style={styles.virtualInfoText}>• Bonus de fidélité</Text>
          </View>
        </View>
      </View>

      {/* ✅ AMÉLIORATION: Historique des transactions avec distinction */}
      <View style={styles.transactionsSection}>
        <Text style={styles.sectionTitle}>Historique des transactions</Text>
        
        {transactions.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Aucune transaction</Text>
            <Text style={styles.emptySubtext}>
              Vos transactions apparaîtront ici après vos premiers achats
            </Text>
          </View>
        ) : (
          <FlatList
            data={transactions.slice(0, 15)} // Limité pour la lisibilité
            renderItem={({ item }) => {
              const isPositive = isPositiveTransaction(item);
              const target = getTransactionTarget(item.transaction_type);
              const sign = isPositive ? '+' : '-';
              const color = isPositive ? '#10B981' : '#EF4444';
              const displayAmount = Math.abs(item.amount).toLocaleString();
              const breakdown = computeTransactionBreakdown(item);
              
              return (
                <View style={styles.transactionItem}>
                  <View style={styles.transactionIcon}>
                    <Text style={styles.iconText}>
                      {getTransactionIcon(item.transaction_type)}
                    </Text>
                  </View>
                  
                  <View style={styles.transactionInfo}>
                    <Text style={styles.transactionDescription}>{item.description}</Text>
                    <Text style={styles.transactionDate}>{formatDate(item.created_at)}</Text>
                    <View style={styles.transactionTags}>
                      <Text style={styles.transactionType}>
                        {item.transaction_type.replace(/_/g, ' ')}
                      </Text>
                      <Text style={[
                        styles.transactionTargetTag,
                        target === 'real' ? styles.realTag : 
                        target === 'virtual' ? styles.virtualTag : 
                        styles.neutralTag
                      ]}>
                        {target === 'real' ? 'RÉEL' : 
                         target === 'virtual' ? 'VIRTUEL' : 
                         'SYSTÈME'}
                      </Text>
                    </View>
                    <View style={styles.transactionBreakdown}>
                      <View style={styles.breakdownChip}>
                        <Text style={styles.breakdownLabel}>Base</Text>
                        <Text style={styles.breakdownAmount}>
                          {formatSignedAmount(breakdown.baseValue, isPositive)}
                        </Text>
                      </View>
                      <View style={styles.breakdownChip}>
                        <Text style={styles.breakdownLabel}>Bonus social</Text>
                        <Text style={styles.breakdownAmount}>
                          {formatSignedAmount(breakdown.microValue, isPositive)}
                        </Text>
                      </View>
                      <View style={[styles.breakdownChip, styles.breakdownChipTotal]}>
                        <Text style={styles.breakdownLabel}>Total</Text>
                        <Text style={styles.breakdownAmount}>
                          {formatSignedAmount(breakdown.totalValue, isPositive)}
                        </Text>
                      </View>
                    </View>
                  </View>
                  
                  <Text style={[styles.transactionAmount, { color }]}>
                    {sign}{displayAmount} FCFA
                  </Text>
                </View>
              );
            }}
            keyExtractor={(item) => item.id.toString()}
            scrollEnabled={false} // Désactiver le scroll dans le scroll principal
          />
        )}
      </View>

      {/* ✅ AMÉLIORATION: Bouton d'aide plus informatif */}
      <TouchableOpacity 
        style={styles.helpButton}
        onPress={() => {
          Alert.alert(
            '💡 Comment fonctionnent les soldes ?',
            `💳 **Argent Réel (${usableBalance.toLocaleString()} FCFA)**\n` +
            `• Pour acheter des BOOM\n` +
            `• Pour retirer vers votre compte\n` +
            `• Rechargé via dépôt Mobile Money\n\n` +
            `🎁 **Argent Virtuel (${virtualBalance.toLocaleString()} FCFA)**\n` +
            `• Redistributions communautaires\n` +
            `• Récompenses sociales\n` +
            `• Actuellement non utilisable pour achats\n\n` +
            `_Les deux soldes sont complètement séparés pour plus de sécurité._`
          );
        }}
      >
        <Text style={styles.helpButtonText}>❓ Comprendre mes soldes</Text>
      </TouchableOpacity>

      {/* ✅ AMÉLIORATION: Bouton debug amélioré */}
      <TouchableOpacity 
        style={styles.debugButton}
        onPress={() => {
          console.log('🔍 État détaillé wallet:', {
            cashBalance,
            virtualBalance,
            usableBalance,
            hasFundsFor1000: hasSufficientFunds(1000),
            transactionsCount: transactions.length
          });
          Alert.alert(
            'Debug Info',
            `💳 Réel: ${cashBalance.toLocaleString()} FCFA\n` +
            `✅ Utilisable: ${usableBalance.toLocaleString()} FCFA\n` +
            `🎁 Virtuel: ${virtualBalance.toLocaleString()} FCFA\n` +
            `\nTransactions: ${transactions.length}\n` +
            `\n💡 Seul le solde RÉEL est utilisable pour les achats.`
          );
        }}
      >
        <Text style={styles.debugButtonText}>🐛 Debug Info</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7fafc',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f7fafc',
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#718096',
  },
  balanceSection: {
    padding: 20,
    paddingBottom: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2d3748',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#718096',
    marginBottom: 16,
    lineHeight: 20,
  },
  realBalanceCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  virtualBalanceCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e9ecef',
    marginTop: 8,
  },
  balanceMain: {
    marginBottom: 20,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#718096',
    marginBottom: 8,
  },
  realBalanceAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#059669',
    marginBottom: 4,
  },
  virtualBalanceAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#7c3aed',
    marginBottom: 8,
  },
  realBalanceHint: {
    fontSize: 12,
    color: '#10b981',
    fontStyle: 'italic',
  },
  virtualBalanceHint: {
    fontSize: 12,
    color: '#a78bfa',
    fontStyle: 'italic',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#059669',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#3b82f6',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  infoButton: {
    padding: 10,
    alignItems: 'center',
  },
  infoButtonText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '500',
  },
  breakdownCard: {
    backgroundColor: '#f0fdf4',
    padding: 16,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#374151',
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  availableValue: {
    color: '#059669',
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#d1fae5',
    marginVertical: 8,
  },
  virtualInfo: {
    backgroundColor: '#f5f3ff',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  virtualInfoText: {
    fontSize: 11,
    color: '#7c3aed',
    marginBottom: 4,
  },
  transactionsSection: {
    padding: 20,
    paddingTop: 10,
  },
  transactionItem: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  transactionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#edf2f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 14,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2d3748',
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: 11,
    color: '#a0aec0',
    marginBottom: 4,
  },
  transactionTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  transactionType: {
    fontSize: 10,
    color: '#cbd5e0',
    textTransform: 'capitalize',
  },
  transactionBreakdown: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  breakdownChip: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  breakdownChipTotal: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  breakdownLabel: {
    fontSize: 10,
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  breakdownAmount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
  },
  transactionTargetTag: {
    fontSize: 9,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  realTag: {
    backgroundColor: '#d1fae5',
    color: '#059669',
  },
  virtualTag: {
    backgroundColor: '#f3e8ff',
    color: '#7c3aed',
  },
  neutralTag: {
    backgroundColor: '#f1f5f9',
    color: '#6b7280',
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  empty: {
    padding: 30,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyText: {
    fontSize: 14,
    color: '#a0aec0',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 12,
    color: '#cbd5e0',
    textAlign: 'center',
    lineHeight: 16,
  },
  helpButton: {
    margin: 20,
    marginBottom: 10,
    padding: 12,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bae6fd',
    alignItems: 'center',
  },
  helpButtonText: {
    color: '#0369a1',
    fontSize: 13,
    fontWeight: '600',
  },
  debugButton: {
    margin: 20,
    marginTop: 0,
    padding: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    alignItems: 'center',
  },
  debugButtonText: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '500',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#718096',
  },
});
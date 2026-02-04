import React, { useState, useEffect, useMemo } from 'react';
import AdminLayout from '@/components/Layout/AdminLayout';
import DataTable from '@/components/UI/DataTable';
import Modal from '@/components/UI/Modal';
import { adminService, treasuryService } from '../../services/admin';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import BigNumber from 'bignumber.js';

export default function TreasuryPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<'deposit' | 'withdraw' | 'details' | null>(null);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [balance, setBalance] = useState<{ balance: string; currency: string } | null>(null);
  const [withdrawn, setWithdrawn] = useState<{ withdrawn: string; currency: string; total_entered: string; current_balance: string; calculation: string } | null>(null);
  const [boomSurplus, setBoomSurplus] = useState<{ surplus: string; currency: string; boom_count: number; details: any[]; calculation: string } | null>(null);
  const [userGains, setUserGains] = useState<{ user_gains: string; currency: string; boom_count: number; details: any[]; calculation: string } | null>(null);

  // === FILTRES ===
  const [filters, setFilters] = useState({
    search: '',
    type: '',
    source: '',
    fromDate: '',
    toDate: '',
  });

  // === FORM DATA ===
  const [formData, setFormData] = useState({
    amount: '',
    method: 'wave',
    reference: '',
    recipient_phone: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [txData, balanceData, withdrawnData, boomSurplusData, userGainsData] = await Promise.all([
        adminService.getTreasuryTransactions(),
        adminService.getTreasuryBalance(),
        adminService.getTreasuryWithdrawn(),
        treasuryService.getTreasuryBoomSurplus(),
        treasuryService.getTreasuryUserGains(),
      ]);
      console.log('💰 Treasury Transactions:', txData);
      console.log('💰 Treasury Balance:', balanceData);
      console.log('💸 Treasury Withdrawn:', withdrawnData);
      console.log('💎 Boom Surplus:', boomSurplusData);
      console.log('👥 User Gains:', userGainsData);
      setTransactions(Array.isArray(txData) ? txData : []);
      setBalance(balanceData);
      setWithdrawn(withdrawnData);
      setBoomSurplus(boomSurplusData);
      setUserGains(userGainsData);
    } catch (error) {
      console.error('❌ Erreur chargement treasury:', error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = loadData;

  // === FORMAT MONTANT ===
  const formatAmount = (amount: string | number | undefined | null): string => {
    if (!amount) return '0,00 FCFA';
    const bn = new BigNumber(amount.toString());
    if (bn.isNaN()) return '0,00 FCFA';
    return `${bn.toFormat(2, { decimalSeparator: ',', groupSeparator: ' ' })} FCFA`;
  };

  // === CALCULS ===
  const stats = useMemo(() => {
    const allTransactions = transactions;
    
    // Utiliser le solde de l'API
    const principalBalance = balance ? new BigNumber(balance.balance) : new BigNumber(0);
    
    // Utiliser les dépôts DIRECTS (treasury_deposit) depuis l'API
    const totalDeposited = withdrawn ? new BigNumber(withdrawn.deposited) : new BigNumber(0);
    
    // Utiliser les retraits DIRECTS (treasury_withdrawal) depuis l'API
    const totalWithdrawnDirect = withdrawn ? new BigNumber(withdrawn.withdrawn) : new BigNumber(0);
    
    // ✅ Utiliser le Surplus BOOMs depuis le nouvel endpoint
    const totalSurplusBooms = boomSurplus ? new BigNumber(boomSurplus.surplus) : new BigNumber(0);
    
    // ✅ Utiliser les Gains Utilisateurs depuis le nouvel endpoint
    const totalUserGains = userGains ? new BigNumber(userGains.user_gains) : new BigNumber(0);
    
    // ✅ Calcul des FRAIS UNIQUEMENT
    // Les frais peuvent venir de deux sources:
    // 1. Transactions avec type contenant 'fee'
    // 2. Frais extraits de la description des transactions boom_purchase/boom_sell
    const fees = allTransactions
      .reduce((sum, tx) => {
        // Source 1: Transactions fee explicites
        if (tx.transaction_type?.includes('fee') || tx.type === 'fee') {
          const amount = new BigNumber(Math.abs(parseFloat(tx.amount || '0')).toString());
          return sum.plus(amount);
        }
        
        // Source 2: Extraire les frais depuis la description
        // Format: "Frais: 173.48 FCFA" ou "Frais BOOMS: 173.48"
        if (tx.description) {
          const feeMatch = tx.description.match(/Frais\s*(?:BOOMS)?:?\s*([\d,]+\.?\d*)/i);
          if (feeMatch && feeMatch[1]) {
            const feeAmount = new BigNumber(feeMatch[1]);
            return sum.plus(feeAmount);
          }
        }
        
        return sum;
      }, new BigNumber(0));
    
    // ✅ Calcul du SURPLUS BOOMs (depuis la description)
    // Format: "Gain: -386.69 FCFA" ou "Gain: 386.69"
    // Seulement pour boom_sell/boom_sell_real
    const surplusFromDescription = allTransactions
      .filter(tx => tx.transaction_type?.includes('boom_sell') || tx.transaction_type === 'boom_sell_real')
      .reduce((sum, tx) => {
        if (tx.description) {
          const gainMatch = tx.description.match(/Gain:\s*(-?[\d,]+\.?\d*)/i);
          if (gainMatch && gainMatch[1]) {
            const gainAmount = new BigNumber(gainMatch[1]);
            // Prendre la valeur absolue et seulement si positive (gains plateforme)
            if (gainAmount.isNegative()) {
              return sum.plus(gainAmount.abs());
            }
          }
        }
        return sum;
      }, new BigNumber(0));
    
    // ✅ Calcul des GAINS UTILISATEURS (par matching de BOOM par nom)
    // Chercher pour chaque retrait le dernier achat du même BOOM
    const userGainsFromTransaction = allTransactions
      .filter(tx => {
        const txType = (tx.transaction_type || tx.type || '').toLowerCase();
        return txType === 'bom_withdrawal' || txType === 'boom_withdrawal' || txType.includes('withdrawal');
      })
      .reduce((sum, withdrawal) => {
        // Extraire le nom du BOOM du retrait
        // Formats supportés: "Retrait Bom externe: INAZUMA vers" ou "Retrait: INAZUMA"
        let withdrawalBoomName = null;
        // Cherche n'importe quel texte après "Retrait" jusqu'à ":" puis le nom
        const boomNameMatch = withdrawal.description?.match(/Retrait.*?:\s*([A-Z][A-Z\d]*)/i);
        if (boomNameMatch && boomNameMatch[1]) {
          withdrawalBoomName = boomNameMatch[1].toUpperCase();
          console.log(`🔍 Retrait BOOM trouvé: ${withdrawalBoomName}, montant: ${withdrawal.amount}`);
        }
        
        if (withdrawalBoomName) {
          // Chercher tous les achats du même BOOM
          const withdrawalTime = new Date(withdrawal.created_at || 0).getTime();
          
          const purchases = allTransactions.filter(tx => {
            const purchaseTime = new Date(tx.created_at || 0).getTime();
            return (
              tx.transaction_type === 'boom_purchase' &&
              tx.user_id === withdrawal.user_id &&
              tx.description?.toUpperCase().includes(withdrawalBoomName) &&
              purchaseTime < withdrawalTime  // ✅ ACHAT AVANT LE RETRAIT
            );
          });
          
          console.log(`   📍 Trouvé ${purchases.length} achats pour ${withdrawalBoomName} (avant le retrait)`);
          
          if (purchases.length > 0) {
            // Prendre l'achat le PLUS PROCHE du retrait (le plus récent AVANT le retrait)
            const lastPurchase = purchases.sort((a, b) => {
              const timeA = new Date(a.created_at || 0).getTime();
              const timeB = new Date(b.created_at || 0).getTime();
              return timeB - timeA;  // Ordre décroissant = plus récent d'abord
            })[0];
            
            // Extraire la "Valeur sociale" (le prix réel du BOOM sans frais)
            // Format: "Valeur sociale: 3469.56 FCFA"
            let purchasePrice = new BigNumber(Math.abs(parseFloat(lastPurchase.amount || '0')).toString());
            const socialValueMatch = lastPurchase.description?.match(/Valeur\s*sociale:\s*([\d,]+\.?\d*)/i);
            if (socialValueMatch && socialValueMatch[1]) {
              purchasePrice = new BigNumber(socialValueMatch[1]);
              console.log(`   💰 Prix d'achat (valeur sociale): ${purchasePrice.toString()}`);
            }
            
            const withdrawalAmount = new BigNumber(Math.abs(parseFloat(withdrawal.amount || '0')).toString());
            const userGain = withdrawalAmount.minus(purchasePrice);
            
            console.log(`   📊 Gain: ${withdrawalAmount.toString()} - ${purchasePrice.toString()} = ${userGain.toString()}`);
            
            if (userGain.isGreaterThan(0)) {
              console.log(`   ✅ Gain utilisateur: ${userGain.toString()} FCFA`);
              return sum.plus(userGain);
            }
          }
        }
        return sum;
      }, new BigNumber(0));
    
    // ✅ Utiliser le surplus depuis la description si endpoint ne retourne rien
    const displaySurplus = totalSurplusBooms && !new BigNumber(totalSurplusBooms).isZero() 
      ? new BigNumber(totalSurplusBooms) 
      : surplusFromDescription;
    
    // ✅ Utiliser les gains depuis le calcul local
    const displayUserGains = userGainsFromTransaction.isGreaterThan(0) 
      ? userGainsFromTransaction 
      : totalUserGains;
    
    // ✅ FRAIS + SURPLUS = Section "Frais achat/transfert"
    const feesAndSurplus = fees.plus(displaySurplus);
    
    return {
      totalBalance: principalBalance.toString(),
      totalDeposited: totalDeposited.toString(),
      totalWithdrawn: totalWithdrawnDirect.toString(),
      totalFees: feesAndSurplus.toString(),  // Frais + Surplus combinés
      totalSurplus: displaySurplus.toString(),
      totalUserGains: displayUserGains.toString(),
      transactionCount: allTransactions.length,
      // Valeurs individuelles pour l'affichage séparé
      fees: fees.toString(),
      surplusFromDescription: surplusFromDescription.toString(),
      userGainsFromTransaction: userGainsFromTransaction.toString(),
    };
  }, [transactions, balance, withdrawn, boomSurplus, userGains]);

  // === SOURCES REVENUS ===
  const revenuesBySource = useMemo(() => {
    const sources: { [key: string]: BigNumber } = {};
    
    transactions.forEach(tx => {
      // Identifier la source basée sur transaction_type ou type
      let source = 'autre';
      const txType = tx.transaction_type || tx.type || '';
      
      if (txType.includes('fee')) source = 'fees';
      else if (txType === 'boom_sell') source = 'surplus';
      else if (tx.source) source = tx.source;
      
      if (!sources[source]) sources[source] = new BigNumber(0);
      sources[source] = sources[source].plus(new BigNumber(tx.amount || '0'));
    });
    
    return Object.entries(sources).map(([source, amount]) => ({
      source,
      amount: amount.toString(),
      label: source === 'fees' ? 'Frais achat/transfert' :
             source === 'surplus' ? 'Surplus BOOMs' :
             source === 'penalties' ? 'Pénalités' :
             'Autre',
    }));
  }, [transactions]);

  // === BÉNÉFICIAIRES ===
  const beneficiaries = useMemo(() => {
    const users: { [key: string]: { name: string; total: BigNumber; count: number } } = {};
    
    transactions
      .filter(tx => tx.type === 'withdrawal')
      .forEach(tx => {
        const userId = tx.recipient_id?.toString() || 'unknown';
        if (!users[userId]) {
          users[userId] = {
            name: tx.recipient_name || `Utilisateur ${userId}`,
            total: new BigNumber(0),
            count: 0,
          };
        }
        users[userId].total = users[userId].total.plus(new BigNumber(tx.amount || '0'));
        users[userId].count += 1;
      });
    
    return Object.entries(users)
      .map(([id, data]) => ({
        id,
        name: data.name,
        total: data.total.toString(),
        count: data.count,
      }))
      .sort((a, b) => new BigNumber(b.total).minus(new BigNumber(a.total)).toNumber());
  }, [transactions]);

  // === FILTRES APPLIQUÉS ===
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      // Recherche texte (description, utilisateur, ID)
      const searchLower = filters.search.toLowerCase();
      const matchSearch =
        (tx.description?.toLowerCase().includes(searchLower)) ||
        (tx.user_full_name?.toLowerCase().includes(searchLower)) ||
        (tx.user_phone?.toLowerCase().includes(searchLower)) ||
        (tx.user_id?.toString().includes(searchLower));

      // Type de transaction - ACCEPTER LES VARIANTES
      const txType = tx.transaction_type || '';
      let matchType = true;
      if (filters.type) {
        const filterValue = filters.type.toLowerCase();
        // Accepter les variantes (fee, withdrawal_fee, deposit_fee, etc.)
        matchType = txType.toLowerCase().includes(filterValue) || txType.toLowerCase() === filterValue;
      }

      // Source (catégorie trésorerie)
      let matchSource = true;
      if (filters.source) {
        const txTypeLower = txType.toLowerCase();
        const filterSource = filters.source.toLowerCase();
        
        // Mapper les sources à leurs catégories
        switch (filterSource) {
          case 'fees':
            // Tous les frais
            matchSource = txTypeLower.includes('fee');
            break;
          case 'surplus':
            // Surplus BOOMs (vente)
            matchSource = txTypeLower.includes('boom_sell');
            break;
          case 'usergains':
            // Gains utilisateurs (retraits BOOM)
            matchSource = txTypeLower.includes('boom_withdrawal') || txTypeLower.includes('bom_withdrawal');
            break;
          case 'boom':
            // Toutes les transactions BOOM
            matchSource = txTypeLower.includes('boom') || txTypeLower.includes('bom');
            break;
          default:
            matchSource = true;
        }
      }

      // Dates
      const txDate = new Date(tx.created_at);
      const matchDate = (!filters.fromDate || txDate >= new Date(filters.fromDate)) &&
        (!filters.toDate || txDate <= new Date(filters.toDate));

      return matchSearch && matchType && matchSource && matchDate;
    });
  }, [transactions, filters]);

  // === COLONNES TABLEAU RÉORGANISÉES ===
  const columns = [
    {
      key: 'created_at',
      header: 'Date/Heure',
      render: (value: string) => (
        <div className="text-sm">
          <div className="font-medium text-gray-900">
            {value ? format(new Date(value), 'dd/MM/yyyy', { locale: fr }) : '-'}
          </div>
          <div className="text-xs text-gray-500">
            {value ? format(new Date(value), 'HH:mm:ss', { locale: fr }) : '-'}
          </div>
        </div>
      ),
    },
    {
      key: 'transaction_type',
      header: 'Catégorie',
      render: (value: string, row: any) => {
        const txType = value?.toLowerCase() || '';
        let icon = '📋';
        let color = 'bg-gray-100 text-gray-800';
        let label = value;

        // Catégoriser selon la logique trésorerie
        if (txType.includes('fee')) {
          icon = '📊';
          color = 'bg-purple-100 text-purple-800';
          label = 'Frais';
        } else if (txType.includes('boom_purchase')) {
          icon = '🛒';
          color = 'bg-blue-100 text-blue-800';
          label = 'Achat BOOM';
        } else if (txType.includes('boom_sell')) {
          icon = '💚';
          color = 'bg-green-100 text-green-800';
          label = 'Vente BOOM (Surplus)';
        } else if (txType.includes('boom_withdrawal') || txType.includes('bom_withdrawal')) {
          icon = '💳';
          color = 'bg-orange-100 text-orange-800';
          label = 'Retrait BOOM (Paiement)';
        } else if (txType.includes('deposit') || txType === 'deposit') {
          icon = '💰';
          color = 'bg-green-100 text-green-800';
          label = 'Dépôt';
        } else if (txType.includes('withdrawal') || txType === 'withdrawal') {
          icon = '💸';
          color = 'bg-red-100 text-red-800';
          label = 'Retrait';
        }

        return (
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
            {icon} {label}
          </span>
        );
      },
    },
    {
      key: 'user_id',
      header: 'Utilisateur',
      render: (value: string | number, row: any) => (
        <div className="text-sm">
          <div className="font-medium text-gray-900">
            {row.user_full_name || `Utilisateur #${value}`}
          </div>
          <div className="text-xs text-gray-500">
            {row.user_phone || `ID: ${value}`}
          </div>
        </div>
      ),
    },
    {
      key: 'fees',
      header: 'Frais',
      render: (value: string | number | undefined, row: any) => {
        const txType = row.transaction_type?.toLowerCase() || '';
        
        // Afficher les frais SEULEMENT pour les transactions de frais
        if (txType.includes('fee')) {
          let feeType = 'Frais';
          if (txType.includes('deposit')) feeType = 'Frais Dépôt';
          else if (txType.includes('withdrawal')) feeType = 'Frais Retrait';
          else if (txType.includes('gift')) feeType = 'Frais Cadeau';
          
          return (
            <div className="text-sm">
              <div className="font-semibold text-purple-600">
                {feeType}
              </div>
              <div className="font-bold text-purple-700">
                {formatAmount(row.amount)}
              </div>
            </div>
          );
        }
        
        // Pas de frais pour les autres types
        return <span className="text-gray-400">-</span>;
      },
    },
    {
      key: 'amount',
      header: 'Montant Affecté',
      render: (value: string | number | undefined, row: any) => {
        const txType = row.transaction_type?.toLowerCase() || '';
        let displayValue = value;
        let colorClass = 'text-gray-600';
        let prefix = '';

        // NE PAS afficher les frais dans cette colonne (ils ont leur colonne dédiée)
        if (txType.includes('fee')) {
          return <span className="text-gray-400">-</span>;
        }

        // Déterminer la couleur et le préfixe selon le type
        if (txType.includes('boom_sell')) {
          // Vente BOOM (Surplus): plateforme gagne (+)
          colorClass = 'text-green-600 font-semibold';
          prefix = '+';
        } else if (txType.includes('boom_purchase')) {
          // Achat BOOM: afficher le prix d'achat sans frais
          colorClass = 'text-blue-600 font-semibold';
          prefix = '';
        } else if (txType.includes('boom_withdrawal') || txType.includes('bom_withdrawal')) {
          // Paiement utilisateur: plateforme paie (-)
          colorClass = 'text-red-600 font-semibold';
          prefix = '-';
        } else if (txType.includes('deposit') && !txType.includes('fee')) {
          colorClass = 'text-green-600';
          prefix = '+';
        } else if (txType.includes('withdrawal') && !txType.includes('fee')) {
          colorClass = 'text-red-600';
          prefix = '-';
        }

        return (
          <div className={`font-semibold ${colorClass}`}>
            {prefix}{formatAmount(displayValue)}
          </div>
        );
      },
    },
    {
      key: 'description',
      header: 'Détails',
      render: (value: string, row: any) => {
        const txType = row.transaction_type?.toLowerCase() || '';
        let detailText = value || '-';

        // Enrichir les détails selon le type
        if (txType.includes('boom_purchase')) {
          detailText = `Achat + Frais associés${value ? ': ' + value : ''}`;
        } else if (txType.includes('boom_sell')) {
          detailText = `Surplus encaissé (BOOM déprécié)${value ? ': ' + value : ''}`;
        } else if (txType.includes('boom_withdrawal') || txType.includes('bom_withdrawal')) {
          detailText = `Paiement utilisateur (BOOM apprécié)${value ? ': ' + value : ''}`;
        } else if (txType.includes('fee')) {
          detailText = `Frais prélevés${value ? ': ' + value : ''}`;
        }

        return (
          <div className="text-sm text-gray-700 max-w-md">
            {detailText}
          </div>
        );
      },
    },
  ];

  const columns_detailed = [
    ...columns,
    {
      key: 'id',
      header: 'ID',
      render: (value: string | number) => (
        <div className="font-mono text-xs text-gray-500">#{value}</div>
      ),
    },
  ];

  const handleDeposit = async () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      alert('❌ Montant invalide');
      return;
    }
    
    try {
      setLoading(true);
      const amount = parseFloat(formData.amount);
      
      const result = await treasuryService.depositToTreasury({
        amount,
        method: formData.method,
        reference: formData.reference || undefined,
      });
      
      if (result && result.success) {
        alert('✅ Dépôt effectué avec succès');
        setActiveModal(null);
        setFormData({ amount: '', method: 'wave', reference: '', recipient_phone: '' });
        await loadTransactions();
      } else {
        alert('❌ Erreur lors du dépôt');
      }
    } catch (error) {
      console.error('❌ Erreur dépôt:', error);
      alert(`❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      alert('❌ Montant invalide');
      return;
    }
    
    if (formData.method === 'wave' && !formData.recipient_phone) {
      alert('❌ Numéro de téléphone requis pour Wave');
      return;
    }
    
    try {
      setLoading(true);
      const amount = parseFloat(formData.amount);
      
      const result = await treasuryService.withdrawFromTreasury({
        amount,
        method: formData.method,
        recipient_phone: formData.method === 'wave' ? formData.recipient_phone : undefined,
        reference: formData.reference || undefined,
      });
      
      if (result && result.success) {
        alert('✅ Retrait effectué avec succès');
        setActiveModal(null);
        setFormData({ amount: '', method: 'wave', reference: '', recipient_phone: '' });
        await loadTransactions();
      } else {
        alert('❌ Erreur lors du retrait');
      }
    } catch (error) {
      console.error('❌ Erreur retrait:', error);
      alert(`❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* === HEADER === */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">💰 Trésorerie</h1>
            <p className="text-gray-600 mt-1">
              Gestion des revenus, distributions et audit financier
            </p>
          </div>
          <button
            onClick={loadTransactions}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            🔄 Actualiser
          </button>
        </div>

        {/* === SOLDE PRINCIPAL === */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg p-6 text-white shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <p className="text-blue-100 text-sm font-semibold uppercase mb-2">Solde Principal</p>
              <p className="text-4xl font-bold">{formatAmount(stats.totalBalance)}</p>
              <p className="text-blue-200 text-sm mt-2">Trésorerie disponible</p>
            </div>
            <div>
              <p className="text-blue-100 text-sm font-semibold uppercase mb-2">Total Déposé</p>
              <p className="text-4xl font-bold">{formatAmount(stats.totalDeposited)}</p>
              <p className="text-blue-200 text-sm mt-2">Revenus cumulés</p>
            </div>
            <div>
              <p className="text-blue-100 text-sm font-semibold uppercase mb-2">Total Retiré</p>
              <p className="text-4xl font-bold text-red-200">{formatAmount(stats.totalWithdrawn)}</p>
              <p className="text-blue-200 text-sm mt-2">Distributions utilisateurs</p>
            </div>
          </div>
        </div>

        {/* === ACTIONS RAPIDES === */}
        <div className="flex gap-3">
          <button
            onClick={() => {
              setActiveModal('deposit');
              setFormData({ amount: '', method: 'wave', reference: '', recipient_phone: '' });
            }}
            className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
          >
            ➕ Déposer des fonds
          </button>
          <button
            onClick={() => {
              setActiveModal('withdraw');
              setFormData({ amount: '', method: 'wave', reference: '', recipient_phone: '' });
            }}
            className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            ➖ Retirer des fonds
          </button>
        </div>

        {/* === REVENUS PAR SOURCE === */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">📊 Revenus par Source</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <p className="text-sm text-gray-600">Frais achat/transfert</p>
              <p className="text-2xl font-bold text-purple-600 mt-2">
                {formatAmount(stats.fees)}
              </p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-sm text-gray-600">Surplus BOOMs</p>
              <p className="text-2xl font-bold text-green-600 mt-2">
                {new BigNumber(stats.surplusFromDescription).isGreaterThan(0) ? formatAmount(stats.surplusFromDescription) : "0,00 FCFA"}
              </p>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <p className="text-sm text-gray-600">Gains aux Utilisateurs</p>
              <p className="text-2xl font-bold text-orange-600 mt-2">
                {new BigNumber(stats.userGainsFromTransaction).isGreaterThan(0) ? formatAmount(stats.userGainsFromTransaction) : "0,00 FCFA"}
              </p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-sm text-gray-600">Transactions</p>
              <p className="text-2xl font-bold text-blue-600 mt-2">{stats.transactionCount}</p>
            </div>
          </div>
        </div>

        {/* === BÉNÉFICIAIRES TOP === */}
        {beneficiaries.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">👥 Top Bénéficiaires</h2>
            <div className="space-y-3">
              {beneficiaries.slice(0, 5).map((user, idx) => (
                <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-medium text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.count} retrait(s)</p>
                    </div>
                  </div>
                  <p className="font-bold text-gray-900">{formatAmount(user.total)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === FILTRES === */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-4">🔍 Filtres</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3">
            <input
              type="text"
              placeholder="Rechercher (utilisateur, description)..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="">Tous les types</option>
              <option value="fee">📊 Frais (Tous)</option>
              <option value="deposit_fee">📊 Frais Dépôt</option>
              <option value="withdrawal_fee">📊 Frais Retrait</option>
              <option value="boom_purchase">🛒 Achat BOOM</option>
              <option value="boom_sell">💚 Vente BOOM (Surplus)</option>
              <option value="boom_withdrawal">💳 Retrait BOOM (Paiement)</option>
              <option value="bom_withdrawal">💳 Retrait BOM (Paiement)</option>
              <option value="deposit">💰 Dépôt</option>
              <option value="withdrawal">💸 Retrait</option>
            </select>
            <select
              value={filters.source}
              onChange={(e) => setFilters({ ...filters, source: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="">Toutes les catégories</option>
              <option value="fees">📊 Frais (Plateforme gagne)</option>
              <option value="surplus">💚 Surplus BOOM (Plateforme gagne)</option>
              <option value="usergains">💳 Gains Utilisateurs (Plateforme paie)</option>
              <option value="boom">🎯 Transactions BOOM</option>
            </select>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            <button
              onClick={() => setFilters({
                search: '',
                type: '',
                source: '',
                fromDate: '',
                toDate: '',
              })}
              className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium text-sm"
            >
              ✕ Réinitialiser
            </button>
            <div className="text-sm text-gray-600 flex items-center">
              {filteredTransactions.length} / {transactions.length} transactions
            </div>
          </div>
        </div>

        {/* === TABLEAU TRANSACTIONS === */}
        <DataTable
          columns={columns}
          data={filteredTransactions}
          loading={loading}
          emptyMessage="Aucune transaction trouvée"
          rowOnClick={(row) => {
            setSelectedTx(row);
            setActiveModal('details');
          }}
        />

        {/* === MODAL: DÉPÔT === */}
        <Modal
          isOpen={activeModal === 'deposit'}
          onClose={() => setActiveModal(null)}
          title="💰 Déposer des fonds"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 uppercase mb-2">Montant (FCFA)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 uppercase mb-2">Méthode</label>
              <select
                value={formData.method}
                onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="wave">🌊 Wave</option>
                <option value="orange">🟠 Orange Money</option>
                <option value="stripe">💳 Stripe</option>
                <option value="manual">✋ Manuel</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 uppercase mb-2">Référence (optionnel)</label>
              <input
                type="text"
                value={formData.reference}
                onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="Réf. transaction"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setActiveModal(null)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                Annuler
              </button>
              <button
                onClick={handleDeposit}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50"
                disabled={!formData.amount || parseFloat(formData.amount) <= 0}
              >
                ✓ Déposer
              </button>
            </div>
          </div>
        </Modal>

        {/* === MODAL: RETRAIT === */}
        <Modal
          isOpen={activeModal === 'withdraw'}
          onClose={() => setActiveModal(null)}
          title="💸 Retirer des fonds"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 uppercase mb-2">Montant (FCFA)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="0.00"
              />
              <p className="text-xs text-gray-500 mt-1">Disponible: {formatAmount(stats.totalBalance)}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 uppercase mb-2">Méthode</label>
              <select
                value={formData.method}
                onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                <option value="wave">🌊 Wave</option>
                <option value="orange">🟠 Orange Money</option>
                <option value="bank">🏦 Virement bancaire</option>
              </select>
            </div>
            {formData.method === 'wave' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 uppercase mb-2">N° téléphone Wave</label>
                <input
                  type="tel"
                  value={formData.recipient_phone}
                  onChange={(e) => setFormData({ ...formData, recipient_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="07xxxxxxxx"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 uppercase mb-2">Référence (optionnel)</label>
              <input
                type="text"
                value={formData.reference}
                onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                placeholder="Réf. paiement"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setActiveModal(null)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                Annuler
              </button>
              <button
                onClick={handleWithdraw}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50"
                disabled={!formData.amount || parseFloat(formData.amount) <= 0}
              >
                ✓ Retirer
              </button>
            </div>
          </div>
        </Modal>

        {/* === MODAL: DÉTAILS TRANSACTION === */}
        <Modal
          isOpen={activeModal === 'details' && selectedTx !== null}
          onClose={() => setActiveModal(null)}
          title="📋 Détails de la transaction"
          size="lg"
        >
          {selectedTx && (
            <div className="space-y-6">
              {/* Transaction Info */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-4">📝 Informations générales</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 uppercase">ID</label>
                    <p className="mt-1 font-mono text-sm text-gray-900">#{selectedTx.id}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 uppercase">Date/Heure</label>
                    <p className="mt-1 text-gray-900">
                      {format(new Date(selectedTx.created_at), 'dd MMMM yyyy à HH:mm:ss', { locale: fr })}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 uppercase">Type</label>
                    <p className="mt-1 text-gray-900 capitalize">{selectedTx.transaction_type}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 uppercase">Montant</label>
                    <p className="mt-1 text-2xl font-bold text-blue-600">{formatAmount(selectedTx.amount)}</p>
                  </div>
                </div>
              </div>

              {/* User Info */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-gray-900 mb-4">👤 Utilisateur</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 uppercase">ID Utilisateur</label>
                    <p className="mt-1 text-gray-900">#{selectedTx.user_id}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 uppercase">Nom</label>
                    <p className="mt-1 text-gray-900">{selectedTx.user_full_name || '-'}</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-600 uppercase">Téléphone</label>
                    <p className="mt-1 text-gray-900 font-mono">{selectedTx.user_phone || '-'}</p>
                  </div>
                </div>
              </div>

              {/* Description */}
              {selectedTx.description && (
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <h3 className="font-semibold text-gray-900 mb-2">📄 Description</h3>
                  <p className="text-gray-900 whitespace-pre-wrap">{selectedTx.description}</p>
                </div>
              )}

              {/* Additional Info */}
              <div className="text-xs text-gray-500 pt-2 border-t border-gray-200">
                <p>Créé: {format(new Date(selectedTx.created_at), 'dd/MM/yyyy HH:mm:ss', { locale: fr })}</p>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AdminLayout>
  );
}
import React, { useState, useEffect, useMemo } from 'react';
import AdminLayout from '@/components/Layout/AdminLayout';
import DataTable from '@/components/UI/DataTable';
import Modal from '@/components/UI/Modal';
import { adminService } from '../../services/admin';
import { Transaction, PaymentTransaction } from '../../types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import BigNumber from 'bignumber.js';

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'wallet' | 'payments'>('wallet');
  const [activeModal, setActiveModal] = useState<'details' | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | PaymentTransaction | null>(null);

  // === FILTRES ===
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    type: '',
    provider: '',
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    try {
      setLoading(true);
      const [walletTx, paymentTx] = await Promise.all([
        adminService.getTransactions(),
        adminService.getPaymentTransactions(),
      ]);
      console.log('🔍 Transactions Wallet:', walletTx); // DEBUG
      console.log('🔍 Transactions Paiements:', paymentTx); // DEBUG
      setTransactions(Array.isArray(walletTx) ? walletTx : []);
      setPaymentTransactions(Array.isArray(paymentTx) ? (Array.isArray(paymentTx) ? paymentTx : paymentTx?.transactions || []) : []);
    } catch (error) {
      console.error('❌ Erreur chargement transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fonction de formatage sécurisée pour les montants
  const formatAmount = (value: string | number | undefined | null): string => {
    if (!value) return '0,00 FCFA';
    const bn = new BigNumber(value.toString());
    if (bn.isNaN()) return '0,00 FCFA';
    return `${bn.toFormat(2, { decimalSeparator: ',', groupSeparator: ' ' })} FCFA`;
  };

  // === FILTRES PORTEFEUILLE ===
  const filteredWallet = useMemo(() => {
    return transactions.filter(tx => {
      const matchSearch = 
        (tx.user_phone?.toLowerCase().includes(filters.search.toLowerCase())) ||
        (tx.user_full_name?.toLowerCase().includes(filters.search.toLowerCase())) ||
        (tx.description?.toLowerCase().includes(filters.search.toLowerCase()));
      const matchStatus = !filters.status || tx.status === filters.status;
      const matchType = !filters.type || tx.transaction_type === filters.type;
      const matchDate = (!filters.startDate || new Date(tx.created_at) >= new Date(filters.startDate)) &&
        (!filters.endDate || new Date(tx.created_at) <= new Date(filters.endDate));
      return matchSearch && matchStatus && matchType && matchDate;
    });
  }, [transactions, filters]);

  // === FILTRES PAIEMENTS ===
  const filteredPayments = useMemo(() => {
    return paymentTransactions.filter(tx => {
      const matchSearch = 
        (tx.user_id?.toString().includes(filters.search)) ||
        (tx.description?.toLowerCase().includes(filters.search.toLowerCase())) ||
        (tx.provider_reference?.toLowerCase().includes(filters.search.toLowerCase()));
      const matchStatus = !filters.status || tx.status === filters.status;
      const matchType = !filters.type || tx.type === filters.type;
      const matchProvider = !filters.provider || tx.provider === filters.provider;
      const matchDate = (!filters.startDate || new Date(tx.created_at) >= new Date(filters.startDate)) &&
        (!filters.endDate || new Date(tx.created_at) <= new Date(filters.endDate));
      return matchSearch && matchStatus && matchType && matchProvider && matchDate;
    });
  }, [paymentTransactions, filters]);


  // === COLONNES PORTEFEUILLE AMÉLIORÉES ===
  const walletColumns = [
    {
      key: 'user_phone',
      header: 'Utilisateur',
      render: (value: string, row: Transaction) => (
        <div
          className="cursor-pointer hover:text-blue-600"
          onClick={() => {
            setSelectedTx(row);
            setActiveModal('details');
          }}
        >
          <div className="font-medium text-gray-900">
            {value || row.user_full_name || `ID: ${row.user_id}`}
          </div>
          <div className="text-xs text-gray-500 font-mono">
            {row.user_id ? `ID: ${row.user_id}` : 'Pas d\'ID'}
          </div>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Montant',
      render: (value: string | number | undefined) => (
        <div className="font-semibold text-gray-900">
          {formatAmount(value)}
        </div>
      ),
    },
    {
      key: 'transaction_type',
      header: 'Type',
      render: (value: string) => {
        let label = value || 'Inconnu';
        let icon = '📋';
        let color = 'bg-blue-100 text-blue-800';

        if (value === 'deposit') {
          label = 'Dépôt';
          icon = '💰';
          color = 'bg-green-100 text-green-800';
        } else if (value === 'withdrawal') {
          label = 'Retrait';
          icon = '🔴';
          color = 'bg-red-100 text-red-800';
        } else if (value === 'purchase') {
          label = 'Achat BOM';
          icon = '🎨';
          color = 'bg-purple-100 text-purple-800';
        }

        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
            {icon} {label}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Statut',
      render: (value: string) => {
        let label = value || 'inconnu';
        let color = 'bg-gray-100 text-gray-800';

        if (value === 'completed') {
          label = '✅ Complété';
          color = 'bg-green-100 text-green-800';
        } else if (value === 'pending') {
          label = '⏳ En attente';
          color = 'bg-yellow-100 text-yellow-800';
        } else if (value === 'failed') {
          label = '❌ Échoué';
          color = 'bg-red-100 text-red-800';
        }

        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
            {label}
          </span>
        );
      },
    },
    {
      key: 'description',
      header: 'Description',
      render: (value: string) => (
        <div className="text-sm text-gray-600 max-w-xs truncate" title={value || ''}>
          {value || '-'}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: 'Date',
      render: (value: string) => (
        <div className="text-sm text-gray-500">
          {value ? format(new Date(value), 'dd/MM/yyyy HH:mm', { locale: fr }) : '-'}
        </div>
      ),
    },
  ];

  // === COLONNES PAIEMENTS AMÉLIORÉES ===
  const paymentColumns = [
    {
      key: 'user_id',
      header: 'Utilisateur',
      render: (value: number, row: PaymentTransaction) => (
        <div
          className="cursor-pointer hover:text-blue-600"
          onClick={() => {
            setSelectedTx(row);
            setActiveModal('details');
          }}
        >
          <div className="font-medium text-gray-900">
            {value ? `ID: ${value}` : 'ID Manquant'}
          </div>
          <div className="text-xs text-gray-500 font-mono truncate">
            {row.id?.slice(0, 16) || 'Pas de transaction ID'}
          </div>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Montant',
      render: (value: string | number | undefined, row: PaymentTransaction) => (
        <div>
          <div className="font-semibold text-gray-900">{formatAmount(value)}</div>
          <div className="text-xs text-gray-500">Frais: {formatAmount(row.fees)}</div>
        </div>
      ),
    },
    {
      key: 'net_amount',
      header: 'Net',
      render: (value: string | number | undefined) => (
        <div className="font-semibold text-green-600">
          {formatAmount(value)}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (value: string) => {
        let label = value || 'Inconnu';
        let icon = '📋';
        let color = 'text-gray-600';

        if (value === 'deposit') {
          label = 'Dépôt';
          icon = '💰';
          color = 'text-green-600';
        } else if (value === 'withdrawal') {
          label = 'Retrait';
          icon = '🔴';
          color = 'text-red-600';
        }

        return (
          <span className={`inline-flex items-center gap-1 font-medium ${color}`}>
            {icon} {label}
          </span>
        );
      },
    },
    {
      key: 'provider',
      header: 'Provider',
      render: (value: string) => {
        let icon = '🔗';
        let color = 'bg-gray-100 text-gray-800';

        if (value === 'wave') {
          icon = '🌊';
          color = 'bg-purple-100 text-purple-800';
        } else if (value === 'stripe') {
          icon = '💳';
          color = 'bg-blue-100 text-blue-800';
        } else if (value === 'system') {
          icon = '⚙️';
          color = 'bg-green-100 text-green-800';
        } else if (value === 'orange_money') {
          icon = '🟠';
          color = 'bg-orange-100 text-orange-800';
        } else if (value === 'mtn_momo') {
          icon = '📱';
          color = 'bg-yellow-100 text-yellow-800';
        }

        return (
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
            {icon} {value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Inconnu'}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Statut',
      render: (value: string) => {
        let label = value || 'inconnu';
        let color = 'bg-gray-100 text-gray-800';

        if (value === 'completed') {
          label = '✅ Complété';
          color = 'bg-green-100 text-green-800';
        } else if (value === 'pending') {
          label = '⏳ En attente';
          color = 'bg-yellow-100 text-yellow-800';
        } else if (value === 'failed') {
          label = '❌ Échoué';
          color = 'bg-red-100 text-red-800';
        } else if (value === 'cancelled') {
          label = '⛔ Annulé';
          color = 'bg-red-100 text-red-800';
        }

        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
            {label}
          </span>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Date',
      render: (value: string) => (
        <div className="text-sm text-gray-500">
          {value ? format(new Date(value), 'dd/MM/yyyy HH:mm', { locale: fr }) : '-'}
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* === HEADER === */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">💰 Transactions</h1>
            <p className="text-gray-600 mt-1">
              Historique complet des transactions portefeuille et paiements externes
            </p>
          </div>
          <button
            onClick={loadTransactions}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            🔄 Actualiser
          </button>
        </div>

        {/* === STATS SUMMARY === */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">Total</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {transactions.length + paymentTransactions.length}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              transactions
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">Portefeuille</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">
              {transactions.length}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              {transactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0).toLocaleString()} FCFA
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">Paiements</div>
            <div className="text-2xl font-bold text-purple-600 mt-1">
              {paymentTransactions.length}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              {formatAmount(
                paymentTransactions.reduce((sum, tx) => sum.plus(new BigNumber(tx.amount || '0')), new BigNumber(0)).toString()
              )}
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">Complétés</div>
            <div className="text-2xl font-bold text-green-600 mt-1">
              {transactions.filter(t => t.status === 'completed').length + 
               paymentTransactions.filter(t => t.status === 'completed').length}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              succès
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">En attente</div>
            <div className="text-2xl font-bold text-yellow-600 mt-1">
              {transactions.filter(t => t.status === 'pending').length + 
               paymentTransactions.filter(t => t.status === 'pending').length}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              à traiter
            </div>
          </div>
        </div>

        {/* === TABS === */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('wallet')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'wallet'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              💼 Portefeuille ({filteredWallet.length})
            </button>
            <button
              onClick={() => setActiveTab('payments')}
              className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'payments'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              💳 Paiements ({filteredPayments.length})
            </button>
          </nav>
        </div>

        {/* === FILTRES === */}
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-4">🔍 Filtres</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Recherche */}
            <input
              type="text"
              placeholder={activeTab === 'wallet' ? "Téléphone, nom..." : "ID, description..."}
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />

            {/* Statut */}
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Tous les statuts</option>
              <option value="pending">⏳ En attente</option>
              <option value="completed">✅ Complété</option>
              <option value="failed">❌ Échoué</option>
              {activeTab === 'payments' && <option value="cancelled">⛔ Annulé</option>}
            </select>

            {/* Type */}
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Tous les types</option>
              {activeTab === 'wallet' ? (
                <>
                  <option value="deposit">💰 Dépôt</option>
                  <option value="withdrawal">🔴 Retrait</option>
                  <option value="purchase">🎨 Achat BOM</option>
                </>
              ) : (
                <>
                  <option value="deposit">💰 Dépôt</option>
                  <option value="withdrawal">🔴 Retrait</option>
                </>
              )}
            </select>

            {/* Provider (seulement pour paiements) */}
            {activeTab === 'payments' && (
              <select
                value={filters.provider}
                onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Tous les providers</option>
                <option value="stripe">💳 Stripe</option>
                <option value="wave">🌊 Wave</option>
                <option value="orange_money">🟠 Orange Money</option>
                <option value="mtn_momo">📱 MTN Mobile Money</option>
                <option value="system">⚙️ Système</option>
              </select>
            )}

            {/* Bouton Reset */}
            <button
              onClick={() => setFilters({
                search: '',
                status: '',
                type: '',
                provider: '',
                startDate: '',
                endDate: '',
              })}
              className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
            >
              ✕ Réinitialiser
            </button>
          </div>
        </div>

        {/* === DATA TABLE === */}
        {activeTab === 'wallet' ? (
          <DataTable
            columns={walletColumns}
            data={filteredWallet}
            loading={loading}
            emptyMessage="Aucune transaction portefeuille trouvée"
          />
        ) : (
          <DataTable
            columns={paymentColumns}
            data={filteredPayments}
            loading={loading}
            emptyMessage="Aucune transaction de paiement trouvée"
          />
        )}

        {/* === MODAL: DÉTAILS === */}
        <Modal
          isOpen={activeModal === 'details' && selectedTx !== null}
          onClose={() => {
            setActiveModal(null);
            setSelectedTx(null);
          }}
          title="📋 Détails de la transaction"
          size="lg"
        >
          {selectedTx && (
            <div className="space-y-6">
              {/* Check si c'est une Transaction Portefeuille (a user_phone) */}
              {'user_phone' in selectedTx ? (
                // === TRANSACTION PORTEFEUILLE ===
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Utilisateur</label>
                      <p className="mt-2 text-lg font-semibold text-gray-900">
                        {(selectedTx as Transaction).user_phone || `ID: ${(selectedTx as Transaction).user_id}`}
                      </p>
                      <p className="text-sm text-gray-600">
                        {(selectedTx as Transaction).user_full_name || '-'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">ID Utilisateur</label>
                      <p className="mt-2 font-mono text-gray-900">{(selectedTx as Transaction).user_id}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Montant</label>
                      <p className="mt-2 text-2xl font-bold text-green-600">{formatAmount((selectedTx as Transaction).amount)}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Type</label>
                      <p className="mt-2 capitalize text-gray-900">{(selectedTx as Transaction).transaction_type}</p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Statut</label>
                      <p className="mt-2">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
                          (selectedTx as Transaction).status === 'completed' ? 'bg-green-100 text-green-800' :
                          (selectedTx as Transaction).status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {(selectedTx as Transaction).status === 'completed' ? '✅ Complété' :
                           (selectedTx as Transaction).status === 'pending' ? '⏳ En attente' :
                           '❌ Échoué'}
                        </span>
                      </p>
                    </div>
                    {(selectedTx as Transaction).description && (
                      <div className="md:col-span-2">
                        <label className="block text-sm font-semibold text-gray-600 uppercase">Description</label>
                        <p className="mt-2 text-gray-900">{(selectedTx as Transaction).description}</p>
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Date</label>
                      <p className="mt-2 text-gray-900">
                        {format(new Date((selectedTx as Transaction).created_at), 'dd MMMM yyyy à HH:mm:ss', { locale: fr })}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                // === TRANSACTION PAIEMENT ===
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">ID Utilisateur</label>
                      <p className="mt-2 text-lg font-semibold text-gray-900">{(selectedTx as PaymentTransaction).user_id}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Transaction ID</label>
                      <p className="mt-2 font-mono text-sm text-gray-900 break-all">{(selectedTx as PaymentTransaction).id}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Montant</label>
                      <p className="mt-2 text-2xl font-bold text-green-600">{formatAmount((selectedTx as PaymentTransaction).amount)}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Frais</label>
                      <p className="mt-2 text-lg font-semibold text-red-600">{formatAmount((selectedTx as PaymentTransaction).fees)}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Montant Net</label>
                      <p className="mt-2 text-xl font-bold text-blue-600">{formatAmount((selectedTx as PaymentTransaction).net_amount)}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Provider</label>
                      <p className="mt-2 capitalize text-gray-900">{(selectedTx as PaymentTransaction).provider}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Type</label>
                      <p className="mt-2 capitalize text-gray-900">{(selectedTx as PaymentTransaction).type}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Statut</label>
                      <p className="mt-2">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
                          (selectedTx as PaymentTransaction).status === 'completed' ? 'bg-green-100 text-green-800' :
                          (selectedTx as PaymentTransaction).status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          (selectedTx as PaymentTransaction).status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {(selectedTx as PaymentTransaction).status === 'completed' ? '✅ Complété' :
                           (selectedTx as PaymentTransaction).status === 'pending' ? '⏳ En attente' :
                           (selectedTx as PaymentTransaction).status === 'cancelled' ? '⛔ Annulé' :
                           '❌ Échoué'}
                        </span>
                      </p>
                    </div>
                    {(selectedTx as PaymentTransaction).provider_reference && (
                      <div>
                        <label className="block text-sm font-semibold text-gray-600 uppercase">Référence Provider</label>
                        <p className="mt-2 font-mono text-sm text-gray-900 break-all">{(selectedTx as PaymentTransaction).provider_reference}</p>
                      </div>
                    )}
                    {(selectedTx as PaymentTransaction).description && (
                      <div className="md:col-span-2">
                        <label className="block text-sm font-semibold text-gray-600 uppercase">Description</label>
                        <p className="mt-2 text-gray-900">{(selectedTx as PaymentTransaction).description}</p>
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-gray-600 uppercase">Date</label>
                      <p className="mt-2 text-gray-900">
                        {format(new Date((selectedTx as PaymentTransaction).created_at), 'dd MMMM yyyy à HH:mm:ss', { locale: fr })}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      </div>
    </AdminLayout>
  );
}
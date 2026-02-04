import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '@/components/Layout/AdminLayout';
import DataTable from '@/components/UI/DataTable';
import Modal from '@/components/UI/Modal';
import { adminService } from '../../services/admin';
import BigNumber from 'bignumber.js';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function FundsManagement() {
  const router = useRouter();
  const [commissions, setCommissions] = useState<any[]>([]);
  const [userFunds, setUserFunds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'commissions'>('users');
  const [activeModal, setActiveModal] = useState<'user_details' | null>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  // FILTRES
  const [filters, setFilters] = useState({
    search: '',
    status: '',
  });

  useEffect(() => {
    loadAllData();
    const interval = setInterval(loadAllData, 30000); // Actualiser toutes les 30s
    return () => clearInterval(interval);
  }, []);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const [commissionsData, fundsData] = await Promise.all([
        adminService.getCommissions(),
        adminService.getAllUserFunds(),
      ]);

      console.log('🎯 FUNDS DATA:', fundsData);
      console.log('🎯 COMMISSIONS DATA:', commissionsData);

      setCommissions(Array.isArray(commissionsData) ? commissionsData : []);
      setUserFunds(Array.isArray(fundsData) ? fundsData : []);
    } catch (error) {
      console.error('❌ Erreur chargement:', error);
    } finally {
      setLoading(false);
    }
  };

  // FORMAT MONTANT
  const formatAmount = (val: any): string => {
    if (!val && val !== 0) return '0,00 FCFA';
    const num = parseFloat(val.toString());
    if (isNaN(num)) return '0,00 FCFA';
    const bn = new BigNumber(Math.abs(num).toString());
    return `${bn.toFormat(2, { decimalSeparator: ',', groupSeparator: ' ' })} FCFA`;
  };

  // STATS UTILISATEURS
  const userStats = useMemo(() => {
    const totalCash = userFunds.reduce((sum, u) => {
      return sum.plus(new BigNumber(u.cash_balance || 0));
    }, new BigNumber(0));

    const totalWallet = userFunds.reduce((sum, u) => {
      return sum.plus(new BigNumber(u.wallet_balance || 0));
    }, new BigNumber(0));

    const usersWithCash = userFunds.filter(u => 
      new BigNumber(u.cash_balance || 0).isGreaterThan(0)
    ).length;

    const usersWithWallet = userFunds.filter(u => 
      new BigNumber(u.wallet_balance || 0).isGreaterThan(0)
    ).length;

    return {
      totalCash: totalCash.toString(),
      totalWallet: totalWallet.toString(),
      usersCount: userFunds.length,
      usersWithCash,
      usersWithWallet,
      totalCombined: totalCash.plus(totalWallet).toString(),
    };
  }, [userFunds]);

  // STATS COMMISSIONS
  const commissionsStats = useMemo(() => {
    const total = commissions.reduce((sum, c) => {
      return sum.plus(new BigNumber(c.amount || 0));
    }, new BigNumber(0));

    return {
      total: total.toString(),
      count: commissions.length,
      average: commissions.length > 0 
        ? total.dividedBy(commissions.length).toString()
        : '0',
    };
  }, [commissions]);

  // FILTRAGE UTILISATEURS
  const filteredUserFunds = useMemo(() => {
    return userFunds.filter(user => {
      const searchLower = filters.search.toLowerCase();
      const matchSearch = 
        (user.full_name?.toLowerCase().includes(searchLower)) ||
        (user.phone?.includes(filters.search)) ||
        (user.user_id?.toString().includes(filters.search));

      let matchStatus = true;
      if (filters.status === 'with_cash') {
        matchStatus = new BigNumber(user.cash_balance || 0).isGreaterThan(0);
      } else if (filters.status === 'with_wallet') {
        matchStatus = new BigNumber(user.wallet_balance || 0).isGreaterThan(0);
      } else if (filters.status === 'both') {
        matchStatus = new BigNumber(user.cash_balance || 0).isGreaterThan(0) &&
                     new BigNumber(user.wallet_balance || 0).isGreaterThan(0);
      }

      return matchSearch && matchStatus;
    });
  }, [userFunds, filters]);

  // FILTRAGE COMMISSIONS
  const filteredCommissions = useMemo(() => {
    return commissions.filter(commission => {
      const searchLower = filters.search.toLowerCase();
      return (commission.user_name?.toLowerCase().includes(searchLower)) ||
             (commission.phone?.includes(filters.search)) ||
             (commission.user_id?.toString().includes(filters.search)) ||
             (commission.commission_type?.toLowerCase().includes(searchLower));
    });
  }, [commissions, filters]);

  // COLONNES UTILISATEURS
  const userColumns = [
    {
      key: 'user_id',
      header: 'Utilisateur',
      width: '200px',
      render: (_: any, row: any) => (
        <div className="text-sm">
          <div className="font-semibold text-gray-900">{row.full_name || `User #${row.user_id}`}</div>
          <div className="text-xs text-gray-500">{row.phone || '-'}</div>
        </div>
      ),
    },
    {
      key: 'cash_balance',
      header: '💰 Solde Liquide',
      width: '150px',
      render: (value: any) => {
        const isZero = new BigNumber(value || 0).isEqualTo(0);
        return (
          <div className={`font-semibold ${isZero ? 'text-gray-500' : 'text-blue-600'}`}>
            {formatAmount(value)}
          </div>
        );
      },
    },
    {
      key: 'wallet_balance',
      header: '👛 Portefeuille',
      width: '150px',
      render: (value: any) => {
        const isZero = new BigNumber(value || 0).isEqualTo(0);
        return (
          <div className={`font-semibold ${isZero ? 'text-gray-500' : 'text-purple-600'}`}>
            {formatAmount(value)}
          </div>
        );
      },
    },
    {
      key: 'total_commissions_earned',
      header: '🎁 Commissions',
      width: '140px',
      render: (value: any) => (
        <div className="font-semibold text-green-600">{formatAmount(value)}</div>
      ),
    },
    {
      key: 'pending_withdrawals',
      header: '⏳ En Attente',
      width: '130px',
      render: (value: any) => {
        const isZero = new BigNumber(value || 0).isEqualTo(0);
        return (
          <div className={`font-semibold ${isZero ? 'text-gray-500' : 'text-orange-600'}`}>
            {formatAmount(value)}
          </div>
        );
      },
    },
  ];

  // COLONNES COMMISSIONS
  const commissionColumns = [
    {
      key: 'created_at',
      header: 'Date',
      width: '160px',
      render: (value: any) => (
        <div className="text-sm text-gray-600">
          {value ? format(new Date(value), 'dd/MM/yyyy HH:mm', { locale: fr }) : '-'}
        </div>
      ),
    },
    {
      key: 'user_id',
      header: 'Utilisateur',
      width: '200px',
      render: (_: any, row: any) => (
        <div className="text-sm">
          <div className="font-semibold text-gray-900">{row.user_name || `User #${row.user_id}`}</div>
          <div className="text-xs text-gray-500">{row.phone || '-'}</div>
        </div>
      ),
    },
    {
      key: 'commission_type',
      header: 'Type',
      width: '140px',
      render: (value: any) => {
        const typeLabel: { [key: string]: { color: string; icon: string } } = {
          'deposit': { color: 'bg-green-100 text-green-800', icon: '💰' },
          'withdrawal': { color: 'bg-red-100 text-red-800', icon: '💸' },
          'boom_purchase': { color: 'bg-blue-100 text-blue-800', icon: '🎯' },
          'transfer': { color: 'bg-purple-100 text-purple-800', icon: '↔️' },
        };
        const type = typeLabel[value] || { color: 'bg-gray-100 text-gray-800', icon: '📊' };
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${type.color}`}>
            {type.icon} {value || 'Autre'}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: 'Montant',
      width: '130px',
      render: (value: any) => (
        <div className="font-semibold text-green-600">{formatAmount(value)}</div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      width: '200px',
      render: (value: any) => (
        <div className="text-sm text-gray-600 truncate max-w-xs" title={value}>
          {value || '-'}
        </div>
      ),
    },
  ];

  const handleOpenUserDetails = (user: any) => {
    setSelectedUser(user);
    setActiveModal('user_details');
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* HEADER */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">💰 Fonds & Commissions</h1>
            <p className="text-gray-600 mt-1">Gestion des soldes utilisateurs et des frais collectés</p>
          </div>
          <button
            onClick={loadAllData}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
          >
            🔄 Actualiser
          </button>
        </div>

        {/* STATS UTILISATEURS */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">👥 Total Utilisateurs</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{userStats.usersCount}</p>
          </div>
          <div className="bg-blue-50 rounded-lg shadow-sm border border-blue-200 p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">💰 Soldes Liquides</p>
            <p className="text-3xl font-bold text-blue-600 mt-2">{formatAmount(userStats.totalCash)}</p>
            <p className="text-xs text-gray-500 mt-1">{userStats.usersWithCash} utilisateurs</p>
          </div>
          <div className="bg-purple-50 rounded-lg shadow-sm border border-purple-200 p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">👛 Portefeuilles</p>
            <p className="text-3xl font-bold text-purple-600 mt-2">{formatAmount(userStats.totalWallet)}</p>
            <p className="text-xs text-gray-500 mt-1">{userStats.usersWithWallet} utilisateurs</p>
          </div>
          <div className="bg-green-50 rounded-lg shadow-sm border border-green-200 p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">🎁 Commissions</p>
            <p className="text-3xl font-bold text-green-600 mt-2">{commissionsStats.count}</p>
            <p className="text-xs text-gray-500 mt-1">{formatAmount(commissionsStats.total)}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg shadow-sm border border-indigo-200 p-4">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">💎 Total Combiné</p>
            <p className="text-3xl font-bold text-indigo-600 mt-2">{formatAmount(userStats.totalCombined)}</p>
          </div>
        </div>

        {/* ONGLETS */}
        <div className="flex gap-0 border-b border-gray-200 bg-white rounded-t-lg">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-6 py-3 font-semibold transition-colors border-b-2 ${
              activeTab === 'users'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            👥 Utilisateurs ({userStats.usersCount})
          </button>
          <button
            onClick={() => setActiveTab('commissions')}
            className={`px-6 py-3 font-semibold transition-colors border-b-2 ${
              activeTab === 'commissions'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            🎁 Commissions ({commissionsStats.count})
          </button>
        </div>

        {/* FILTRES */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Rechercher par nom, téléphone ou ID..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
            {activeTab === 'users' && (
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              >
                <option value="">Tous les utilisateurs</option>
                <option value="with_cash">Avec solde liquide</option>
                <option value="with_wallet">Avec portefeuille</option>
                <option value="both">Avec les deux</option>
              </select>
            )}
            <button
              onClick={() => setFilters({ search: '', status: '' })}
              className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium text-sm"
            >
              ✕ Réinitialiser
            </button>
          </div>
          <div className="mt-3 text-sm text-gray-600">
            {activeTab === 'users' 
              ? `${filteredUserFunds.length} / ${userFunds.length} utilisateurs`
              : `${filteredCommissions.length} / ${commissions.length} commissions`
            }
          </div>
        </div>

        {/* TABLEAU UTILISATEURS */}
        {activeTab === 'users' && (
          <DataTable
            columns={userColumns}
            data={filteredUserFunds}
            loading={loading}
            emptyMessage="Aucun utilisateur trouvé"
            rowOnClick={(row) => handleOpenUserDetails(row)}
          />
        )}

        {/* TABLEAU COMMISSIONS */}
        {activeTab === 'commissions' && (
          <DataTable
            columns={commissionColumns}
            data={filteredCommissions}
            loading={loading}
            emptyMessage="Aucune commission trouvée"
          />
        )}

        {/* MODAL: DÉTAILS UTILISATEUR */}
        <Modal
          isOpen={activeModal === 'user_details' && selectedUser !== null}
          onClose={() => setActiveModal(null)}
          title={`👤 ${selectedUser?.full_name || `User #${selectedUser?.user_id}`}`}
          size="lg"
        >
          {selectedUser && (
            <div className="space-y-6">
              {/* INFO GÉNÉRALE */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h3 className="font-semibold text-gray-900 mb-4">Informations</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase">ID</label>
                    <p className="text-lg font-medium text-gray-900 mt-1">#{selectedUser.user_id}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 uppercase">Téléphone</label>
                    <p className="text-lg font-mono text-gray-900 mt-1">{selectedUser.phone || '-'}</p>
                  </div>
                </div>
              </div>

              {/* SOLDES */}
              <div className="grid grid-cols-2 gap-4">
                {/* SOLDE LIQUIDE */}
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <div className="text-xs font-semibold text-gray-600 uppercase mb-2">💰 Solde Liquide</div>
                  <div className="text-3xl font-bold text-blue-600 mb-2">
                    {formatAmount(selectedUser.cash_balance)}
                  </div>
                  <p className="text-xs text-gray-600">
                    Argent réel déposé et disponible
                  </p>
                </div>

                {/* PORTEFEUILLE */}
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                  <div className="text-xs font-semibold text-gray-600 uppercase mb-2">👛 Portefeuille</div>
                  <div className="text-3xl font-bold text-purple-600 mb-2">
                    {formatAmount(selectedUser.wallet_balance)}
                  </div>
                  <p className="text-xs text-gray-600">
                    Monnaie virtuelle redistribuée
                  </p>
                </div>
              </div>

              {/* AUTRES INFOS */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                  <div className="text-xs font-semibold text-gray-600 uppercase mb-2">⏳ Retraits en Attente</div>
                  <div className="text-2xl font-bold text-orange-600">
                    {formatAmount(selectedUser.pending_withdrawals)}
                  </div>
                </div>
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <div className="text-xs font-semibold text-gray-600 uppercase mb-2">🎁 Commissions Gagnées</div>
                  <div className="text-2xl font-bold text-green-600">
                    {formatAmount(selectedUser.total_commissions_earned)}
                  </div>
                </div>
              </div>

              {/* ÉCART */}
              {selectedUser.has_discrepancy && (
                <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                  <h3 className="font-semibold text-red-900 mb-2">⚠️ Écart Détecté</h3>
                  <p className="text-sm text-red-800">
                    Écart entre solde liquide et portefeuille: <strong>{formatAmount(selectedUser.discrepancy)}</strong>
                  </p>
                </div>
              )}

              {/* BOUTONS */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setActiveModal(null)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Fermer
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AdminLayout>
  );
}
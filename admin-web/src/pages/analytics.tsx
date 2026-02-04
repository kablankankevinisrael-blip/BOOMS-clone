import React, { useState, useEffect, useMemo } from 'react';
import AdminLayout from '../components/Layout/AdminLayout';
import DataTable from '../components/UI/DataTable';
import { adminService } from '../services/admin';
import BigNumber from 'bignumber.js';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function Analytics() {
  const [stats, setStats] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [userFunds, setUserFunds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month' | 'all'>('month');

  useEffect(() => {
    loadAllData();
  }, [timeRange]);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const [statsData, transactionsData, fundsData] = await Promise.all([
        adminService.getStats(),
        adminService.getTreasuryTransactions(100),
        adminService.getAllUserFunds(),
      ]);

      setStats(statsData);
      setTransactions(Array.isArray(transactionsData) ? transactionsData : []);
      setUserFunds(Array.isArray(fundsData) ? fundsData : []);
    } catch (error) {
      console.error('❌ Erreur chargement analytics:', error);
      setStats(null);
      setTransactions([]);
      setUserFunds([]);
    } finally {
      setLoading(false);
    }
  };

  // === FORMAT MONTANT ===
  const formatAmount = (amount: string | number | undefined | null): string => {
    if (!amount) return '0,00 FCFA';
    const bn = new BigNumber(Math.abs(parseFloat(amount.toString())).toString());
    if (bn.isNaN()) return '0,00 FCFA';
    return `${bn.toFormat(2, { decimalSeparator: ',', groupSeparator: ' ' })} FCFA`;
  };

  // === FILTRAGE PAR DATE ===
  const getDateRange = () => {
    const now = new Date();
    let start = startOfDay(now);

    if (timeRange === 'week') {
      start = startOfDay(subDays(now, 7));
    } else if (timeRange === 'month') {
      start = startOfDay(subDays(now, 30));
    } else if (timeRange === 'all') {
      start = new Date('2000-01-01');
    }

    return { start, end: endOfDay(now) };
  };

  const { start: dateStart, end: dateEnd } = getDateRange();

  // === DONNÉES FILTRÉES ===
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const txDate = new Date(tx.created_at);
      return txDate >= dateStart && txDate <= dateEnd;
    });
  }, [transactions, dateStart, dateEnd]);

  // === STATS PRINCIPALES ===
  const mainStats = useMemo(() => {
    return {
      totalUsers: stats?.total_users || 0,
      activeBoms: stats?.active_boms || 0,
      totalBoms: stats?.total_boms || 0,
      platformValue: new BigNumber(stats?.total_platform_value || 0),
      dailyActiveUsers: stats?.daily_active_users || 0,

      totalTransactions: filteredTransactions.length,
      totalVolume: filteredTransactions.reduce((sum, tx) => {
        const amount = new BigNumber(Math.abs(parseFloat(tx.amount || '0')).toString());
        return sum.plus(amount);
      }, new BigNumber(0)).toString(),

      avgTransaction: filteredTransactions.length > 0
        ? new BigNumber(filteredTransactions.reduce((sum, tx) => {
            const amount = new BigNumber(Math.abs(parseFloat(tx.amount || '0')).toString());
            return sum.plus(amount);
          }, new BigNumber(0))).dividedBy(filteredTransactions.length).toString()
        : '0',

      usersWithFunds: userFunds.filter(u => 
        new BigNumber(u.cash_balance || 0).isGreaterThan(0) || 
        new BigNumber(u.wallet_balance || 0).isGreaterThan(0)
      ).length,
    };
  }, [stats, filteredTransactions, userFunds]);

  // === STATS PAR TYPE DE TRANSACTION ===
  const transactionsByType = useMemo(() => {
    const types: Record<string, { count: number; volume: BigNumber }> = {};

    filteredTransactions.forEach(tx => {
      const txType = tx.transaction_type?.toLowerCase() || 'autre';
      if (!types[txType]) {
        types[txType] = { count: 0, volume: new BigNumber(0) };
      }
      types[txType].count += 1;
      const amount = new BigNumber(Math.abs(parseFloat(tx.amount || '0')).toString());
      types[txType].volume = types[txType].volume.plus(amount);
    });

    return Object.entries(types).map(([type, data]) => ({
      type,
      count: data.count,
      volume: data.volume.toString(),
      percentage: filteredTransactions.length > 0 ? (data.count / filteredTransactions.length * 100) : 0,
    }));
  }, [filteredTransactions]);

  // === TOP UTILISATEURS PAR ACTIVITÉ ===
  const topUsers = useMemo(() => {
    const userActivity: Record<number, { count: number; volume: BigNumber; name: string; phone: string }> = {};

    filteredTransactions.forEach(tx => {
      const userId = tx.user_id || 0;
      if (!userActivity[userId]) {
        userActivity[userId] = {
          count: 0,
          volume: new BigNumber(0),
          name: tx.user_full_name || 'Utilisateur',
          phone: tx.user_phone || '-',
        };
      }
      userActivity[userId].count += 1;
      const amount = new BigNumber(Math.abs(parseFloat(tx.amount || '0')).toString());
      userActivity[userId].volume = userActivity[userId].volume.plus(amount);
    });

    return Object.entries(userActivity)
      .map(([userId, data]) => ({
        userId: parseInt(userId),
        name: data.name,
        phone: data.phone,
        transactions: data.count,
        volume: data.volume.toString(),
      }))
      .sort((a, b) => new BigNumber(b.volume).minus(new BigNumber(a.volume)).toNumber())
      .slice(0, 10);
  }, [filteredTransactions]);

  // === COLONNES TOP UTILISATEURS ===
  const topUsersColumns = [
    {
      key: 'userId',
      header: '#',
      render: (value: number) => (
        <div className="font-semibold text-gray-900">#{value}</div>
      ),
    },
    {
      key: 'name',
      header: 'Utilisateur',
      render: (value: string, row: any) => (
        <div className="text-sm">
          <div className="font-medium text-gray-900">{value}</div>
          <div className="text-xs text-gray-500">{row.phone}</div>
        </div>
      ),
    },
    {
      key: 'transactions',
      header: 'Transactions',
      render: (value: number) => (
        <div className="font-semibold text-blue-600">{value}</div>
      ),
    },
    {
      key: 'volume',
      header: 'Volume',
      render: (value: string) => (
        <div className="font-semibold text-green-600">{formatAmount(value)}</div>
      ),
    },
  ];

  // === COLONNES TRANSACTIONS ===
  const transactionColumns = [
    {
      key: 'created_at',
      header: 'Date',
      render: (value: string) => (
        <div className="text-sm text-gray-600">
          {format(new Date(value), 'dd/MM/yyyy HH:mm', { locale: fr })}
        </div>
      ),
    },
    {
      key: 'transaction_type',
      header: 'Type',
      render: (value: string) => {
        let icon = '📋';
        let color = 'bg-gray-100 text-gray-800';

        if (value?.toLowerCase().includes('deposit')) {
          icon = '💰';
          color = 'bg-green-100 text-green-800';
        } else if (value?.toLowerCase().includes('withdrawal')) {
          icon = '💸';
          color = 'bg-red-100 text-red-800';
        }

        return (
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
            {icon} {value || 'Autre'}
          </span>
        );
      },
    },
    {
      key: 'user_full_name',
      header: 'Utilisateur',
      render: (value: string, row: any) => (
        <div className="text-sm">
          <div className="font-medium text-gray-900">{value || `ID #${row.user_id}`}</div>
          <div className="text-xs text-gray-500">{row.user_phone || '-'}</div>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Montant',
      render: (value: string | number | undefined) => (
        <div className="font-semibold text-blue-600">{formatAmount(value)}</div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (value: string) => (
        <div className="text-sm text-gray-700 max-w-xs truncate" title={value}>{value || '-'}</div>
      ),
    },
  ];

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement des analytiques...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="📊 Analytique">
      <div className="space-y-6">
        {/* === BOUTONS PLAGE TEMPS === */}
        <div className="flex gap-2 border-b border-gray-200 pb-4">
          <button
            onClick={() => setTimeRange('today')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              timeRange === 'today'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Aujourd'hui
          </button>
          <button
            onClick={() => setTimeRange('week')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              timeRange === 'week'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            7 jours
          </button>
          <button
            onClick={() => setTimeRange('month')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              timeRange === 'month'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            30 jours
          </button>
          <button
            onClick={() => setTimeRange('all')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              timeRange === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Tout
          </button>
        </div>

        {/* === STATS PRINCIPALES === */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Utilisateurs */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-blue-900">Utilisateurs</div>
                <div className="text-2xl font-bold text-blue-700 mt-1">{mainStats.totalUsers}</div>
              </div>
              <div className="text-4xl">👥</div>
            </div>
            <div className="mt-2 text-xs text-blue-600">
              {mainStats.dailyActiveUsers} actifs aujourd'hui
            </div>
          </div>

          {/* Total BOOMs */}
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-purple-900">BOOMs</div>
                <div className="text-2xl font-bold text-purple-700 mt-1">{mainStats.totalBoms}</div>
              </div>
              <div className="text-4xl">🎁</div>
            </div>
            <div className="mt-2 text-xs text-purple-600">
              {mainStats.activeBoms} actifs
            </div>
          </div>

          {/* Valeur Plateforme */}
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-green-900">Valeur Plateforme</div>
                <div className="text-2xl font-bold text-green-700 mt-1">
                  {formatAmount(mainStats.platformValue.toString())}
                </div>
              </div>
              <div className="text-4xl">💎</div>
            </div>
            <div className="mt-2 text-xs text-green-600">
              Fonds utilisateurs
            </div>
          </div>

          {/* Utilisateurs avec Fonds */}
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-orange-900">Avec Fonds</div>
                <div className="text-2xl font-bold text-orange-700 mt-1">{mainStats.usersWithFunds}</div>
              </div>
              <div className="text-4xl">💰</div>
            </div>
            <div className="mt-2 text-xs text-orange-600">
              Solde > 0
            </div>
          </div>
        </div>

        {/* === STATS TRANSACTIONS === */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-4 border border-indigo-200">
            <div className="text-sm font-medium text-indigo-900">Total Transactions</div>
            <div className="text-3xl font-bold text-indigo-700 mt-2">{mainStats.totalTransactions}</div>
            <div className="mt-2 text-xs text-indigo-600">Période sélectionnée</div>
          </div>

          <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-lg p-4 border border-cyan-200">
            <div className="text-sm font-medium text-cyan-900">Volume Total</div>
            <div className="text-2xl font-bold text-cyan-700 mt-2">{formatAmount(mainStats.totalVolume)}</div>
            <div className="mt-2 text-xs text-cyan-600">Montant total transféré</div>
          </div>

          <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-lg p-4 border border-rose-200">
            <div className="text-sm font-medium text-rose-900">Moyenne / Transaction</div>
            <div className="text-2xl font-bold text-rose-700 mt-2">{formatAmount(mainStats.avgTransaction)}</div>
            <div className="mt-2 text-xs text-rose-600">Montant moyen par transaction</div>
          </div>
        </div>

        {/* === DISTRIBUTION PAR TYPE === */}
        {transactionsByType.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Distribution par Type</h3>
            <div className="space-y-3">
              {transactionsByType.map((type) => (
                <div key={type.type}>
                  <div className="flex justify-between items-center text-sm mb-1">
                    <span className="font-medium text-gray-700 capitalize">{type.type}</span>
                    <span className="text-gray-600">{type.count} transactions ({type.percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${type.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === TOP UTILISATEURS === */}
        {topUsers.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">🏆 Top 10 Utilisateurs</h3>
            <DataTable columns={topUsersColumns} data={topUsers} />
          </div>
        )}

        {/* === TRANSACTIONS RÉCENTES === */}
        {filteredTransactions.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              📋 Transactions ({filteredTransactions.slice(0, 50).length} affichées)
            </h3>
            <DataTable columns={transactionColumns} data={filteredTransactions.slice(0, 50)} />
          </div>
        )}

        {/* === MESSAGE VIDE === */}
        {loading ? (
          <div className="text-center py-12">
            <div className="text-gray-500">⏳ Chargement des données...</div>
          </div>
        ) : mainStats.totalTransactions === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
            <div className="text-gray-500 text-sm">📭 Aucune donnée disponible pour cette période</div>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
import React, { useState, useEffect } from 'react';
import AdminLayout from '@/components/Layout/AdminLayout';
import { adminService } from '../services/admin';
import { AdminStats, User, NFT, PaymentTransaction } from '../types';
import { format } from 'date-fns';

type DataStatus = 'pending' | 'connected' | 'empty' | 'error';
type DataDomain = 'stats' | 'users' | 'boms' | 'transactions';

const STATUS_META: Record<DataStatus, { label: string; badge: string; helper: string }> = {
  pending: {
    label: 'En attente',
    badge: 'bg-gray-100 text-gray-700',
    helper: 'Synchronisation en cours'
  },
  connected: {
    label: 'Connecté',
    badge: 'bg-green-100 text-green-800',
    helper: 'Flux aligné avec le backend'
  },
  empty: {
    label: 'Aucune donnée',
    badge: 'bg-yellow-100 text-yellow-800',
    helper: 'Section disponible mais sans contenu réel'
  },
  error: {
    label: 'Erreur',
    badge: 'bg-red-100 text-red-700',
    helper: 'Impossible de joindre l’API'
  }
};

const DATA_SECTIONS: Array<{ key: DataDomain; title: string; description: string }> = [
  {
    key: 'stats',
    title: 'Statistiques globales',
    description: 'Volumes consolidés: utilisateurs, boms actifs, valeur plateforme.'
  },
  {
    key: 'users',
    title: 'Utilisateurs',
    description: 'Liste et profils côté /admin/users.'
  },
  {
    key: 'boms',
    title: 'BOMs & collections',
    description: 'Collections et actifs NFT côté /boms.'
  },
  {
    key: 'transactions',
    title: 'Transactions',
    description: 'Mouvements financiers et historiques récents.'
  }
];

export default function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [boms, setBoms] = useState<NFT[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<Record<DataDomain, DataStatus>>({
    stats: 'pending',
    users: 'pending',
    boms: 'pending',
    transactions: 'pending'
  });
  const [resourceCounts, setResourceCounts] = useState({
    users: 0,
    boms: 0,
    transactions: 0
  });
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setErrorMessage(null);
    setLoading(true);
    setDataStatus({
      stats: 'pending',
      users: 'pending',
      boms: 'pending',
      transactions: 'pending'
    });
    
    try {
      const startTime = performance.now();
      console.log('📊 [ADMIN-DASHBOARD] ▶️ Chargement des données...');
      
      let statsStatus: DataStatus = 'pending';
      let usersStatus: DataStatus = 'pending';
      let bomsStatus: DataStatus = 'pending';
      let transactionsStatus: DataStatus = 'pending';

      const [statsData, usersData, bomsData, transactionsResponse] = await Promise.all([
        adminService.getStats().catch(err => {
          statsStatus = 'error';
          console.error('🔴 [ADMIN-DASHBOARD] Erreur stats:', err.message);
          return null;
        }),
        adminService.getUsers().catch(err => {
          usersStatus = 'error';
          console.error('🔴 [ADMIN-DASHBOARD] Erreur utilisateurs:', err.message);
          return [];
        }),
        adminService.getNFTs().catch(err => {
          bomsStatus = 'error';
          console.error('🔴 [ADMIN-DASHBOARD] Erreur NFTs/BOMs:', err.message);
          return [];
        }),
        adminService.getTransactionsPaginated({ limit: 100 }).catch(err => {
          transactionsStatus = 'error';
          console.error('🔴 [ADMIN-DASHBOARD] Erreur transactions:', err.message);
          return { transactions: [], total: 0, page: 1, pages: 1 };
        })
      ]);

      const transactionsData = transactionsResponse?.transactions || [];

      const cleanStats: AdminStats = {
        total_users: statsData?.total_users || 0,
        total_boms: statsData?.total_boms || 0,
        active_boms: statsData?.active_boms || 0,
        total_platform_value: statsData?.total_platform_value || 0,
        total_transactions: statsData?.total_transactions || 0,
        daily_active_users: statsData?.daily_active_users || 0
      };
      
      console.log('📈 [ADMIN-DASHBOARD] Données brutes reçues du backend:', {
        stats: cleanStats,
        users: usersData.slice(0, 2),
        usersCount: usersData.length,
        boms: bomsData.slice(0, 2),
        bomsCount: bomsData.length,
        transactions: transactionsData.slice(0, 2),
        transactionsCount: transactionsData.length
      });
      
      setStats(cleanStats);
      setUsers(usersData);
      setBoms(bomsData);
      setTransactions(transactionsData);
      setResourceCounts({
        users: usersData.length || 0,
        boms: bomsData.length || 0,
        transactions: transactionsData.length || 0
      });

      const hasStatsData = Object.values(cleanStats).some(value => value && value > 0);

      setDataStatus({
        stats: statsStatus === 'error'
          ? 'error'
          : hasStatsData
            ? 'connected'
            : 'empty',
        users: usersStatus === 'error'
          ? 'error'
          : usersData.length > 0
            ? 'connected'
            : 'empty',
        boms: bomsStatus === 'error'
          ? 'error'
          : bomsData.length > 0
            ? 'connected'
            : 'empty',
        transactions: transactionsStatus === 'error'
          ? 'error'
          : transactionsData.length > 0
            ? 'connected'
            : 'empty'
      });

      setLastUpdated(new Date().toISOString());
      
      const endTime = performance.now();
      console.log(`✅ [ADMIN-DASHBOARD] Données chargées avec succès (${(endTime - startTime).toFixed(2)}ms)`);
      
    } catch (error: any) {
      console.error('❌ [ADMIN-DASHBOARD] Erreur chargement:', error);
      setErrorMessage('Impossible de charger les données. Vérifiez la connexion au serveur.');
      
      setStats({
        total_users: 0,
        total_boms: 0,
        active_boms: 0,
        total_platform_value: 0,
        total_transactions: 0,
        daily_active_users: 0
      });
      setDataStatus({
        stats: 'error',
        users: 'error',
        boms: 'error',
        transactions: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshDashboard = () => {
    console.log('🔄 [ADMIN-DASHBOARD] Actualisation manuelle demandée');
    loadDashboardData();
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center h-96 space-y-4">
          <div className="w-12 h-12 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div>
            <p className="text-gray-700 font-medium">Chargement du tableau de bord...</p>
            <p className="text-sm text-gray-500">Récupération des données en cours</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Tableau de bord</h1>
            <p className="text-gray-600 mt-1">
              Refonte en cours — cette page met en avant l'état réel des connexions au backend • Mise à jour à {format(new Date(), 'HH:mm')}
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={refreshDashboard}
              disabled={loading}
              className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="font-medium">Actualiser</span>
            </button>
            
          </div>
        </div>

        {errorMessage && (
          <div className="bg-gradient-to-r from-red-50 to-red-100 border border-red-200 text-red-700 px-6 py-4 rounded-xl shadow-sm">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <p className="font-medium">Connexion au serveur limitée</p>
                <p className="text-sm mt-1">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-5 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">État des connexions</h2>
            <p className="text-sm text-gray-600 mt-1">
              Chaque carte indique si la section correspondante est réellement synchronisée avec les données FastAPI.
            </p>
            {lastUpdated && (
              <p className="text-xs text-gray-400 mt-2">Dernière vérification: {format(new Date(lastUpdated), 'dd/MM/yyyy HH:mm:ss')}</p>
            )}
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {DATA_SECTIONS.map(section => {
              const currentStatus = dataStatus[section.key];
              const meta = STATUS_META[currentStatus];

              const detail = (() => {
                if (section.key === 'stats' && stats) {
                  return `${stats.total_users.toLocaleString()} utilisateurs • ${stats.active_boms.toLocaleString()} boms actifs`;
                }
                if (section.key === 'users') {
                  return `${resourceCounts.users} profils`;
                }
                if (section.key === 'boms') {
                  return `${resourceCounts.boms} actifs référencés`;
                }
                if (section.key === 'transactions') {
                  return `${resourceCounts.transactions} mouvements analysés`;
                }
                return meta.helper;
              })();

              return (
                <div key={section.key} className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{section.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{section.description}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${meta.badge}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-4">{detail}</p>
                  <p className="text-xs text-gray-500 mt-1">{meta.helper}</p>
                </div>
              );
            })}
          </div>
        </div>

        {stats && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Chiffres à jour</h2>
              <p className="text-sm text-gray-600 mt-1">
                Données brutes renvoyées par l'API sans extrapolation.
              </p>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-500">Utilisateurs totaux</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.total_users.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">BOMs enregistrés</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.total_boms.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">BOMs actifs</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.active_boms.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Valeur plateforme</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.total_platform_value.toLocaleString()} FCFA</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Transactions cumulées</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.total_transactions.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Utilisateurs actifs (24h)</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.daily_active_users.toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* TABLEAU UTILISATEURS */}
        {users.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">👥 Utilisateurs ({users.length})</h2>
              <p className="text-sm text-gray-600 mt-1">Données en direct du backend - GET /users/</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">ID</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Téléphone</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Nom</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Actif</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Admin</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Créé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {users.slice(0, 20).map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium">{user.id}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{user.phone || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{user.full_name || '-'}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {user.is_active ? 'Oui' : 'Non'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${user.is_admin ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                          {user.is_admin ? 'Oui' : 'Non'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{format(new Date(user.created_at), 'dd/MM/yyyy')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {users.length > 20 && (
              <div className="px-6 py-4 text-center text-sm text-gray-600 border-t border-gray-200">
                Affichage de 20 sur {users.length} utilisateurs
              </div>
            )}
          </div>
        )}

        {/* TABLEAU BOMs */}
        {boms.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">🎨 BOMs/NFTs ({boms.length})</h2>
              <p className="text-sm text-gray-600 mt-1">Données en direct du backend - GET /admin/nfts</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">ID</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Titre</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Catégorie</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Valeur</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Type</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Actif</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Créé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {boms.slice(0, 20).map((bom) => (
                    <tr key={bom.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium">{bom.id}</td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">{bom.title || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{bom.category || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium">{(bom.value || 0).toLocaleString()} FCFA</td>
                      <td className="px-6 py-4 text-sm">
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                          {bom.edition_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${bom.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {bom.is_active ? 'Oui' : 'Non'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{format(new Date(bom.created_at), 'dd/MM/yyyy')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {boms.length > 20 && (
              <div className="px-6 py-4 text-center text-sm text-gray-600 border-t border-gray-200">
                Affichage de 20 sur {boms.length} BOMs/NFTs
              </div>
            )}
          </div>
        )}

        {/* TABLEAU TRANSACTIONS */}
        {transactions.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">💳 Toutes les Transactions ({transactions.length})</h2>
              <p className="text-sm text-gray-600 mt-1">Données en direct du backend - GET /admin/payments (tous les utilisateurs)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">ID</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Type</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Montant</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Statut</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Utilisateur</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transactions.slice(0, 20).map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium">{tx.id}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                          {tx.type || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                        {typeof tx.amount === 'number' ? (tx.amount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : tx.amount || '0'}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          tx.status === 'completed' ? 'bg-green-100 text-green-800' :
                          tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{tx.user_phone || '-'}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{tx.created_at ? format(new Date(tx.created_at), 'dd/MM/yyyy HH:mm') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {transactions.length > 20 && (
              <div className="px-6 py-4 text-center text-sm text-gray-600 border-t border-gray-200">
                Affichage de 20 sur {transactions.length} transactions
              </div>
            )}
          </div>
        )}

        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-green-900">✅ Vérification des données</h2>
          <p className="text-sm text-green-700 mt-1">Les tableaux ci-dessus affichent les données réelles reçues du backend.</p>
          <ul className="mt-4 space-y-2 text-sm text-green-900">
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-3"></span>
              <strong>Utilisateurs:</strong> Données en direct de GET /users/ - {users.length} utilisateurs trouvés
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-3"></span>
              <strong>BOMs/NFTs:</strong> Données en direct de GET /admin/nfts - {boms.length} BOMs trouvés
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-3"></span>
              <strong>Transactions:</strong> Données en direct de GET /admin/payments - {transactions.length} transactions trouvées
            </li>
          </ul>
          <p className="text-xs text-green-600 mt-4">🔍 Ouvrez la console (F12) pour voir les logs détaillés avec timestamps et données brutes.</p>
        </div>

        <div className="text-center text-sm text-gray-500 pt-4 border-t border-gray-200">
          <p>Dashboard simplifié pour refléter fidèlement l'état actuel des données.</p>
          {/* 🔐 API URL lue depuis .env - pas de hardcoded fallback */}
          <p className="mt-1">Serveur API: {process.env.NEXT_PUBLIC_API_BASE_URL || 'Non configuré'}</p>
        </div>
      </div>
    </AdminLayout>
  );
}
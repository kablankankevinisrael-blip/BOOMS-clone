import React, { useState } from 'react';
import AdminLayout from '../../components/Layout/AdminLayout';
import DataTable from '../../components/UI/DataTable';
import Modal from '../../components/UI/Modal';
import { adminService } from '../../services/admin';
import { User } from '../../types';
import { useAdminResource } from '@/hooks/useAdminResource';
import { X, AlertTriangle } from 'lucide-react';

type ActionType = 'ban' | 'delete' | null;

export default function Users() {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: ActionType; user: User } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionReason, setActionReason] = useState('');

  const {
    data: users,
    loading,
    error,
    refresh,
  } = useAdminResource<User[]>({
    fetcher: () => adminService.getUsers(),
  });

  const getAccountStatusMeta = (user: User) => {
    const status = user.account_status || (user.is_active ? 'active' : 'inactive');

    if (status === 'inactive') {
      return {
        label: '⏸️ Désactivé',
        classes: 'bg-amber-100 text-amber-800',
        description: 'Temporaire, réactivable à tout moment.',
        locked: false,
      };
    }

    if (status === 'banned') {
      return {
        label: '🚫 Banni (72h)',
        classes: 'bg-orange-100 text-orange-800',
        description: 'Auto‑suppression après 72h sans réactivation.',
        locked: true,
      };
    }

    if (status === 'deleted') {
      return {
        label: '💀 Supprimé',
        classes: 'bg-red-100 text-red-800',
        description: 'Suppression définitive de la base de données.',
        locked: true,
      };
    }

    return {
      label: '✅ Actif',
      classes: 'bg-green-100 text-green-800',
      description: 'Compte opérationnel.',
      locked: false,
    };
  };

  const handleToggleStatus = async (user: User) => {
    try {
      await adminService.toggleUserStatus(user.id, !user.is_active);
      setSelectedUser(null);
      setIsModalOpen(false);
      await refresh();
    } catch (error) {
      console.error('❌ Erreur changement statut:', error);
    }
  };

  const handleToggleAdmin = async (user: User) => {
    try {
      await adminService.toggleUserAdmin(user.id, !user.is_admin);
      setSelectedUser(null);
      setIsModalOpen(false);
      await refresh();
    } catch (error) {
      console.error('❌ Erreur changement admin:', error);
    }
  };

  const handleBanUser = async () => {
    if (!confirmAction || !actionReason.trim()) {
      return;
    }
    setActionLoading(true);
    try {
      await adminService.banUser(confirmAction.user.id, actionReason);
      console.log(`🚫 Utilisateur ${confirmAction.user.phone} banni`);
      setConfirmAction(null);
      setSelectedUser(null);
      setIsModalOpen(false);
      setActionReason('');
      await refresh();
    } catch (error) {
      console.error('❌ Erreur bannissement:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!confirmAction || !actionReason.trim()) {
      return;
    }
    setActionLoading(true);
    try {
      await adminService.deleteUser(confirmAction.user.id, actionReason);
      console.log(`💀 Utilisateur ${confirmAction.user.phone} supprimé complètement`);
      setConfirmAction(null);
      setSelectedUser(null);
      setIsModalOpen(false);
      setActionReason('');
      await refresh();
    } catch (error) {
      console.error('❌ Erreur suppression:', error);
    } finally {
      setActionLoading(false);
    }
  };

  const list = users || [];
  const activeCount = list.filter((user) => user.is_active).length;
  const adminCount = list.filter((user) => user.is_admin).length;

  const columns = [
    {
      key: 'full_name',
      header: 'Utilisateur',
      render: (value: string, row: User) => (
        <div>
          <div className="font-medium text-gray-900">
            {value || 'Non renseigné'}
          </div>
          <div className="text-sm text-gray-500">{row.phone}</div>
          {row.email && (
            <div className="text-sm text-gray-500">{row.email}</div>
          )}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: 'Inscription',
      render: (value: string) => (
        <div>
          <div className="text-sm text-gray-900">
            {new Date(value).toLocaleDateString('fr-FR')}
          </div>
          <div className="text-xs text-gray-500">
            {new Date(value).toLocaleTimeString('fr-FR')}
          </div>
        </div>
      ),
    },
    {
      key: 'is_active',
      header: 'Statut',
      render: (value: boolean, row: User) => {
        const statusMeta = getAccountStatusMeta(row);
        return (
        <div className="space-y-2">
          <button
            onClick={() => handleToggleStatus(row)}
            disabled={statusMeta.locked}
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              statusMeta.classes
            } ${statusMeta.locked ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'}`}
          >
            {statusMeta.label}
          </button>

          <div className="text-xs text-gray-500">
            {statusMeta.description}
          </div>
          
          {row.is_admin && (
            <div className="inline-flex items-center px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">
              👑 Admin
            </div>
          )}
        </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (value: any, row: User) => (
        <div className="space-x-2 flex">
          <button
            onClick={() => {
              setSelectedUser(row);
              setIsModalOpen(true);
            }}
            className="text-blue-600 hover:text-blue-700 font-medium text-sm"
          >
            Détails
          </button>
          
          <button
            onClick={() => handleToggleAdmin(row)}
            className={`font-medium text-sm ${
              row.is_admin
                ? 'text-orange-600 hover:text-orange-700'
                : 'text-purple-600 hover:text-purple-700'
            }`}
          >
            {row.is_admin ? 'Rétrograder' : 'Promouvoir'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Utilisateurs</h1>
            <p className="text-gray-600 mt-1">
              {list.length} comptes • {activeCount} actifs • {adminCount} administrateurs
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              disabled={loading}
            >
              Actualiser
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
            Impossible de charger les utilisateurs. {error.message}
          </div>
        )}

        {/* Users Table */}
        <DataTable
          columns={columns}
          data={list}
          loading={loading}
          emptyMessage="Aucun utilisateur trouvé"
        />

        {/* User Details Modal */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedUser(null);
          }}
          title="Détails utilisateur"
          size="md"
        >
          {selectedUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    ID
                  </label>
                  <p className="mt-1 text-sm font-mono text-gray-900">
                    {selectedUser.id}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Téléphone
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {selectedUser.phone}
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Nom complet
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {selectedUser.full_name || 'Non renseigné'}
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {selectedUser.email || 'Non renseigné'}
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Statut KYC
                  </label>
                  <p className="mt-1 text-sm">
                    <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                      {selectedUser.kyc_status}
                    </span>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Statut Compte
                  </label>
                  {(() => {
                    const statusMeta = getAccountStatusMeta(selectedUser);
                    return (
                  <p className="mt-1 text-sm">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusMeta.classes}`}>
                      {statusMeta.label}
                    </span>
                    <span className="block text-xs text-gray-500 mt-1">
                      {statusMeta.description}
                    </span>
                  </p>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Rôle
                  </label>
                  <p className="mt-1 text-sm">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                      selectedUser.is_admin
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {selectedUser.is_admin ? '👑 Administrateur' : '👤 Utilisateur'}
                    </span>
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Inscrit le
                  </label>
                  <p className="mt-1 text-sm text-gray-900">
                    {new Date(selectedUser.created_at).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {new Date(selectedUser.created_at).toLocaleTimeString('fr-FR')}
                  </p>
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-200 space-y-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleToggleStatus(selectedUser)}
                    className={`flex-1 px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
                      selectedUser.is_active
                        ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                        : 'bg-green-100 text-green-800 hover:bg-green-200'
                    }`}
                  >
                    {selectedUser.is_active ? '⏸️ Désactiver' : '▶️ Activer'}
                  </button>
                  
                  <button
                    onClick={() => handleToggleAdmin(selectedUser)}
                    className={`flex-1 px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
                      selectedUser.is_admin
                        ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                        : 'bg-purple-100 text-purple-800 hover:bg-purple-200'
                    }`}
                  >
                    {selectedUser.is_admin ? '⬇️ Rétrograder' : '⬆️ Promouvoir Admin'}
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmAction({ type: 'ban', user: selectedUser })}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium text-sm transition-colors"
                  >
                    🚫 Bannir
                  </button>
                  
                  <button
                    onClick={() => setConfirmAction({ type: 'delete', user: selectedUser })}
                    className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm transition-colors"
                  >
                    💀 Supprimer
                  </button>
                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* Confirmation Modal */}
        <Modal
          isOpen={!!confirmAction}
          onClose={() => {
            setConfirmAction(null);
            setActionReason('');
          }}
          title={confirmAction?.type === 'ban' ? '⚠️ Bannir utilisateur' : '⚠️ Supprimer définitivement'}
          size="md"
        >
          {confirmAction && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-lg whitespace-pre-wrap ${
                  confirmAction.type === 'ban'
                    ? 'bg-orange-50 border border-orange-200'
                    : 'bg-red-50 border border-red-200'
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    confirmAction.type === 'ban' ? 'text-orange-800' : 'text-red-800'
                  }`}
                >
                  {confirmAction.type === 'ban'
                    ? `🚫 Bannissement pour 72h\n(Auto-suppression après ce délai)`
                    : `💀 Cette action est IRRÉVERSIBLE!\n\nSuppression complète de:\n✗ ${confirmAction.user.full_name || confirmAction.user.phone}\n✗ Toutes ses données\n✗ Tous ses actifs\n✗ Traces complètes`}
                </p>
              </div>

              <p className="text-sm text-gray-600">
                <strong>Téléphone:</strong> {confirmAction.user.phone}
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Raison de cette action *
                </label>
                <textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Expliquez clairement la raison..."
                  className="w-full min-h-[100px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>

              <div className="flex gap-2 pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setConfirmAction(null);
                    setActionReason('');
                  }}
                  className="flex-1 px-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-sm"
                  disabled={actionLoading}
                >
                  Annuler
                </button>

                <button
                  onClick={() => {
                    if (confirmAction.type === 'ban') {
                      handleBanUser();
                    } else {
                      handleDeleteUser();
                    }
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg font-medium text-sm transition-colors text-white flex items-center justify-center gap-2 ${
                    confirmAction.type === 'ban'
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : 'bg-red-600 hover:bg-red-700'
                  } disabled:opacity-50`}
                  disabled={actionLoading || !actionReason.trim()}
                >
                  {actionLoading && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {confirmAction.type === 'ban' ? '🚫 Bannir' : '💀 Supprimer'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AdminLayout>
  );
}
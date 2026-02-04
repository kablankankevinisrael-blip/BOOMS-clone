import React, { useState, useEffect, useMemo } from 'react';
import AdminLayout from '@/components/Layout/AdminLayout';
import DataTable from '@/components/UI/DataTable';
import Modal from '@/components/UI/Modal';
import { adminService } from '../../services/admin';
import { Gift } from '../../types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function Gifts() {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<'details' | null>(null);
  const [selectedGift, setSelectedGift] = useState<Gift | null>(null);

  // === FILTRES ===
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    fromDate: '',
    toDate: '',
  });

  useEffect(() => {
    loadGifts();
  }, []);

  const loadGifts = async () => {
    try {
      setLoading(true);
      const data = await adminService.getGifts();
      console.log('🎁 Gifts chargés:', data); // DEBUG
      setGifts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('❌ Erreur chargement gifts:', error);
    } finally {
      setLoading(false);
    }
  };

  // === FILTRES APPLIQUÉS ===
  const filteredGifts = useMemo(() => {
    return gifts.filter(gift => {
      const matchSearch =
        (gift.sender_name?.toLowerCase().includes(filters.search.toLowerCase())) ||
        (gift.receiver_name?.toLowerCase().includes(filters.search.toLowerCase())) ||
        (gift.bom_title?.toLowerCase().includes(filters.search.toLowerCase())) ||
        (gift.message?.toLowerCase().includes(filters.search.toLowerCase()));
      const matchStatus = !filters.status || gift.status === filters.status;
      const matchDate = (!filters.fromDate || new Date(gift.sent_at) >= new Date(filters.fromDate)) &&
        (!filters.toDate || new Date(gift.sent_at) <= new Date(filters.toDate));
      return matchSearch && matchStatus && matchDate;
    });
  }, [gifts, filters]);

  // === STATS ===
  const stats = {
    total: gifts.length,
    sent: gifts.filter(g => g.status === 'sent').length,
    accepted: gifts.filter(g => g.status === 'accepted').length,
    expired: gifts.filter(g => g.status === 'expired').length,
  };

  // === COLONNES ===
  const columns = [
    {
      key: 'sender_name',
      header: 'Expéditeur',
      render: (value: string, row: Gift) => (
        <div
          className="cursor-pointer hover:text-blue-600"
          onClick={() => {
            setSelectedGift(row);
            setActiveModal('details');
          }}
        >
          <div className="font-medium text-gray-900">{value || 'Inconnu'}</div>
          <div className="text-xs text-gray-500">ID: {row.sender_id}</div>
        </div>
      ),
    },
    {
      key: 'receiver_name',
      header: 'Destinataire',
      render: (value: string, row: Gift) => (
        <div>
          <div className="font-medium text-gray-900">{value || 'Inconnu'}</div>
          <div className="text-xs text-gray-500">ID: {row.receiver_id}</div>
        </div>
      ),
    },
    {
      key: 'bom_title',
      header: 'BOM/NFT',
      render: (value: string) => (
        <div className="text-sm text-gray-900 font-medium max-w-xs truncate" title={value || ''}>
          {value || '-'}
        </div>
      ),
    },
    {
      key: 'message',
      header: 'Message',
      render: (value: string) => (
        <div className="text-sm text-gray-600 max-w-xs truncate" title={value || ''}>
          {value ? `"${value}"` : '-'}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      render: (value: string) => {
        let label = value || 'inconnu';
        let icon = '❓';
        let color = 'bg-gray-100 text-gray-800';

        if (value === 'sent') {
          label = 'Envoyé';
          icon = '📤';
          color = 'bg-blue-100 text-blue-800';
        } else if (value === 'accepted') {
          label = 'Accepté';
          icon = '✅';
          color = 'bg-green-100 text-green-800';
        } else if (value === 'expired') {
          label = 'Expiré';
          icon = '⏰';
          color = 'bg-red-100 text-red-800';
        } else if (value === 'rejected') {
          label = 'Rejeté';
          icon = '❌';
          color = 'bg-red-100 text-red-800';
        }

        return (
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
            {icon} {label}
          </span>
        );
      },
    },
    {
      key: 'sent_at',
      header: 'Envoyé',
      render: (value: string) => (
        <div className="text-sm text-gray-500">
          {value ? format(new Date(value), 'dd/MM/yyyy HH:mm', { locale: fr }) : '-'}
        </div>
      ),
    },
    {
      key: 'accepted_at',
      header: 'Accepté',
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
            <h1 className="text-3xl font-bold text-gray-900">🎁 Cadeaux BOOMs</h1>
            <p className="text-gray-600 mt-1">
              Gestion des cadeaux échangés entre utilisateurs
            </p>
          </div>
          <button
            onClick={loadGifts}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            🔄 Actualiser
          </button>
        </div>

        {/* === STATS === */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">Total</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</div>
            <div className="text-xs text-gray-500 mt-2">cadeaux</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">Envoyés</div>
            <div className="text-2xl font-bold text-blue-600 mt-1">{stats.sent}</div>
            <div className="text-xs text-gray-500 mt-2">en attente</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">Acceptés</div>
            <div className="text-2xl font-bold text-green-600 mt-1">{stats.accepted}</div>
            <div className="text-xs text-gray-500 mt-2">
              {stats.total > 0 ? `${Math.round((stats.accepted / stats.total) * 100)}%` : '0%'}
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="text-sm text-gray-600 font-semibold">Expirés</div>
            <div className="text-2xl font-bold text-red-600 mt-1">{stats.expired}</div>
            <div className="text-xs text-gray-500 mt-2">non réclamés</div>
          </div>
        </div>

        {/* === FILTRES === */}
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-4">🔍 Filtres</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Recherche */}
            <input
              type="text"
              placeholder="Expéditeur, destinataire, BOM..."
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
              <option value="sent">📤 Envoyé</option>
              <option value="accepted">✅ Accepté</option>
              <option value="expired">⏰ Expiré</option>
              <option value="rejected">❌ Rejeté</option>
            </select>

            {/* Date du */}
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />

            {/* Date au */}
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />

            {/* Réinitialiser */}
            <button
              onClick={() => setFilters({
                search: '',
                status: '',
                fromDate: '',
                toDate: '',
              })}
              className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
            >
              ✕ Réinitialiser
            </button>
          </div>
        </div>

        {/* === DATA TABLE === */}
        <DataTable
          columns={columns}
          data={filteredGifts}
          loading={loading}
          emptyMessage="Aucun cadeau trouvé"
        />

        {/* === MODAL: DÉTAILS === */}
        <Modal
          isOpen={activeModal === 'details' && selectedGift !== null}
          onClose={() => {
            setActiveModal(null);
            setSelectedGift(null);
          }}
          title="🎁 Détails du cadeau"
          size="lg"
        >
          {selectedGift && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Expéditeur */}
                <div>
                  <label className="block text-sm font-semibold text-gray-600 uppercase">Expéditeur</label>
                  <p className="mt-2 text-lg font-semibold text-gray-900">{selectedGift.sender_name || 'Inconnu'}</p>
                  <p className="text-sm text-gray-500">ID: {selectedGift.sender_id}</p>
                </div>

                {/* Destinataire */}
                <div>
                  <label className="block text-sm font-semibold text-gray-600 uppercase">Destinataire</label>
                  <p className="mt-2 text-lg font-semibold text-gray-900">{selectedGift.receiver_name || 'Inconnu'}</p>
                  <p className="text-sm text-gray-500">ID: {selectedGift.receiver_id}</p>
                </div>

                {/* BOM/NFT */}
                <div>
                  <label className="block text-sm font-semibold text-gray-600 uppercase">BOM/NFT</label>
                  <p className="mt-2 text-gray-900">{selectedGift.bom_title || '-'}</p>
                  <p className="text-sm text-gray-500">ID: {selectedGift.user_bom_id}</p>
                </div>

                {/* Statut */}
                <div>
                  <label className="block text-sm font-semibold text-gray-600 uppercase">Statut</label>
                  <p className="mt-2">
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold ${
                      selectedGift.status === 'accepted' ? 'bg-green-100 text-green-800' :
                      selectedGift.status === 'sent' ? 'bg-blue-100 text-blue-800' :
                      selectedGift.status === 'expired' ? 'bg-red-100 text-red-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {selectedGift.status === 'accepted' ? '✅ Accepté' :
                       selectedGift.status === 'sent' ? '📤 Envoyé' :
                       selectedGift.status === 'expired' ? '⏰ Expiré' :
                       '❌ Rejeté'}
                    </span>
                  </p>
                </div>

                {/* Message */}
                {selectedGift.message && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-600 uppercase">Message</label>
                    <p className="mt-2 text-gray-900 italic">"{selectedGift.message}"</p>
                  </div>
                )}

                {/* Dates */}
                <div>
                  <label className="block text-sm font-semibold text-gray-600 uppercase">Envoyé le</label>
                  <p className="mt-2 text-gray-900">
                    {format(new Date(selectedGift.sent_at), 'dd MMMM yyyy à HH:mm:ss', { locale: fr })}
                  </p>
                </div>

                {selectedGift.accepted_at && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 uppercase">Accepté le</label>
                    <p className="mt-2 text-gray-900">
                      {format(new Date(selectedGift.accepted_at), 'dd MMMM yyyy à HH:mm:ss', { locale: fr })}
                    </p>
                  </div>
                )}

                {selectedGift.expires_at && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-600 uppercase">Expire le</label>
                    <p className="mt-2 text-gray-900">
                      {format(new Date(selectedGift.expires_at), 'dd MMMM yyyy à HH:mm:ss', { locale: fr })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AdminLayout>
  );
}

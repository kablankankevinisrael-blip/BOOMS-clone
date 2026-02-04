import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/Layout/AdminLayout';
import DataTable from '../../components/UI/DataTable';
import Modal from '../../components/UI/Modal';
import { adminService } from '../../services/admin';
import { NFT, NFTAuditLog } from '../../types';
import { useAdminResource } from '@/hooks/useAdminResource';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function Boms() {
  const [selectedNft, setSelectedNft] = useState<NFT | null>(null);
  const [activeModal, setActiveModal] = useState<
    'details' | 'edit' | 'transfer' | 'editions' | 'delete' | 'audit' | 'createCollection' | null
  >(null);
  
  // States pour les modals avec actions
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [isTransfering, setIsTransfering] = useState(false);
  const [transferToUserId, setTransferToUserId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [auditLog, setAuditLog] = useState<NFTAuditLog[]>([]);
  
  // States pour la création de collection
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [collections, setCollections] = useState<Array<{id: number, name: string}>>([]);
  const [collectionData, setCollectionData] = useState({
    name: '',
    description: '',
    image_url: ''
  });
  
  // Filtres avancés
  const [filters, setFilters] = useState({
    search: '',
    status: 'all' as 'all' | 'active' | 'inactive',
    edition_type: 'all',
    category: 'all',
    collection_id: 'all'
  });
  
  const router = useRouter();

  // Charger les collections
  useEffect(() => {
    loadCollections();
  }, []);

  const loadCollections = async () => {
    try {
      const collectionsData = await adminService.getCollections();
      setCollections(collectionsData.map(col => ({
        id: col.id,
        name: col.name
      })));
    } catch (error) {
      console.error('Erreur chargement collections:', error);
    }
  };

  const {
    data: nfts,
    loading,
    error,
    refresh,
  } = useAdminResource<NFT[]>({
    fetcher: () => adminService.getNFTs(filters.status !== 'all'),
  });

  // Appliquer les filtres localement
  const filteredNfts = useMemo(() => {
    let result = nfts || [];
    
    if (filters.search) {
      const search = filters.search.toLowerCase();
      result = result.filter(nft => 
        nft.title.toLowerCase().includes(search) ||
        nft.artist.toLowerCase().includes(search) ||
        nft.category.toLowerCase().includes(search)
      );
    }
    
    if (filters.status === 'active') {
      result = result.filter(nft => nft.is_active);
    } else if (filters.status === 'inactive') {
      result = result.filter(nft => !nft.is_active);
    }
    
    if (filters.edition_type !== 'all') {
      result = result.filter(nft => nft.edition_type === filters.edition_type);
    }
    
    if (filters.category !== 'all') {
      result = result.filter(nft => nft.category === filters.category);
    }
    
    if (filters.collection_id !== 'all') {
      const collectionId = parseInt(filters.collection_id);
      result = result.filter(nft => nft.collection_id === collectionId);
    }
    
    return result;
  }, [nfts, filters]);

  // Stats du dashboard
  const stats = useMemo(() => {
    const allBoms = nfts || [];
    return {
      total: allBoms.length,
      active: allBoms.filter(b => b.is_active).length,
      inactive: allBoms.filter(b => !b.is_active).length,
      unique: allBoms.filter(b => !b.max_editions || b.max_editions === 1).length,
      editions: allBoms.filter(b => b.max_editions && b.max_editions > 1).length,
      totalValue: allBoms.reduce((sum, b) => sum + (b.value || 0), 0)
    };
  }, [nfts]);

  // Catégories uniques pour le filtre
  const categories = useMemo(() => {
    const cats = new Set((nfts || []).map(n => n.category));
    return Array.from(cats).sort();
  }, [nfts]);

  // Handlers
  const handleToggleStatus = async (nft: NFT) => {
    try {
      console.log(`🔄 [toggleStatus] NFT ID: ${nft.id}`);
      const updatedNFT = await adminService.toggleNftActive(nft.id);
      
      if (selectedNft?.id === nft.id) {
        setSelectedNft(updatedNFT);
      }
      await refresh();
    } catch (error) {
      console.error('Error toggling NFT status:', error);
      alert('Erreur lors de la modification du statut');
    }
  };

  const handleOpenAudit = async (nft: NFT) => {
    try {
      console.log(`🔍 [getAuditLog] NFT ID: ${nft.id}`);
      const logs = await adminService.getAuditLog(nft.id);
      setAuditLog(logs);
      setSelectedNft(nft);
      setActiveModal('audit');
    } catch (error) {
      console.error('Error fetching audit log:', error);
      alert('Impossible de charger l\'historique');
    }
  };

  const handleDeleteNft = async () => {
    if (!selectedNft) return;
    if (!deleteReason.trim()) {
      alert('La raison est obligatoire');
      return;
    }
    
    setIsDeleting(true);
    try {
      console.log(`🗑️ [deleteNFT] ID: ${selectedNft.id}, Raison: ${deleteReason}`);
      await adminService.deleteNFT(selectedNft.id);
      
      console.log('✅ NFT supprimé avec succès');
      setActiveModal(null);
      setDeleteReason('');
      setSelectedNft(null);
      await refresh();
      alert('NFT supprimé avec succès');
    } catch (error: any) {
      console.error('❌ Erreur suppression:', error);
      alert(`Erreur: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!selectedNft) return;
    if (!transferToUserId.trim()) {
      alert('L\'ID utilisateur est obligatoire');
      return;
    }
    if (!transferReason.trim()) {
      alert('La raison est obligatoire');
      return;
    }
    
    setIsTransfering(true);
    try {
      const toUserId = parseInt(transferToUserId);
      console.log(`🔄 [transferOwnership] BOM ID: ${selectedNft.id} → User: ${toUserId}`);
      
      await adminService.transferBomOwnership(
        selectedNft.id,
        selectedNft.owner_id || 0,
        toUserId,
        transferReason
      );
      
      console.log('✅ Transfert réussi');
      setActiveModal(null);
      setTransferToUserId('');
      setTransferReason('');
      setSelectedNft(null);
      await refresh();
      alert('BOM transféré avec succès');
    } catch (error: any) {
      console.error('❌ Erreur transfert:', error);
      alert(`Erreur: ${error.response?.data?.detail || error.message}`);
    } finally {
      setIsTransfering(false);
    }
  };

  const handleCreateCollection = async () => {
    if (!collectionData.name.trim()) {
      alert('Le nom de la collection est obligatoire');
      return;
    }
    
    setIsCreatingCollection(true);
    try {
      console.log('📦 [createCollection]', collectionData);
      const newCollection = await adminService.createCollection({
        name: collectionData.name,
        description: collectionData.description || undefined,
        image_url: collectionData.image_url || undefined
      });
      
      console.log('✅ Collection créée:', newCollection);
      setActiveModal(null);
      setCollectionData({ name: '', description: '', image_url: '' });
      await refresh();
      alert(`✅ Collection "${newCollection.name}" créée avec succès!`);
    } catch (error: any) {
      console.error('❌ Erreur création collection:', error);
      alert(`Erreur: ${error.response?.data?.detail || error.message}`);
    } finally {
      setIsCreatingCollection(false);
    }
  };

  const columns = [
    {
      key: 'title',
      header: 'NFT',
      render: (value: string, row: NFT) => (
        <div className="flex items-center space-x-3">
          {row.preview_image && (
            <img
              src={row.preview_image}
              alt={value}
              className="w-12 h-12 rounded-lg object-cover"
            />
          )}
          <div>
            <div className="font-medium text-gray-900">{value}</div>
            <div className="text-sm text-gray-500">
              par {row.artist}
              {row.token_id && (
                <span className="ml-2 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                  #{row.token_id.substring(0, 6)}
                </span>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Catégorie',
      render: (value: string) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          {value}
        </span>
      ),
    },
    {
      key: 'edition_type',
      header: 'Rareté',
      render: (value: string) => {
        const colors: Record<string, string> = {
          common: 'bg-gray-100 text-gray-800',
          rare: 'bg-purple-100 text-purple-800',
          ultra_rare: 'bg-orange-100 text-orange-800',
          legendary: 'bg-red-100 text-red-800',
        };
        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[value] || colors.common}`}>
            {value}
          </span>
        );
      },
    },
    {
      key: 'value',
      header: 'Valeur',
      render: (value: any) => (
        <span className="font-medium">
          {value != null ? `${Number(value).toLocaleString()} FCFA` : '0 FCFA'}
        </span>
      ),
    },
    {
      key: 'max_editions',
      header: 'Éditions',
      render: (value: number | null, row: NFT) => (
        <div className="text-center">
          {value ? (
            <div>
              <div className="font-medium">{row.current_edition}/{value}</div>
              <div className="text-xs text-gray-500">{row.available_editions || 0} dispo.</div>
            </div>
          ) : (
            <span className="text-gray-500">1/1</span>
          )}
        </div>
      ),
    },
    {
      key: 'is_active',
      header: 'Statut',
      render: (value: boolean, row: NFT) => (
        <button
          onClick={() => handleToggleStatus(row)}
          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            value
              ? 'bg-green-100 text-green-800 hover:bg-green-200'
              : 'bg-red-100 text-red-800 hover:bg-red-200'
          }`}
        >
          {value ? '✅ Actif' : '❌ Inactif'}
        </button>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (value: any, row: NFT) => (
        <div className="flex space-x-2">
          <button
            onClick={() => {
              setSelectedNft(row);
              setActiveModal('details');
            }}
            className="text-blue-600 hover:text-blue-700 font-medium text-sm"
            title="Voir détails"
          >
            👁️
          </button>
          <button
            onClick={() => router.push(`/boms/${row.id}`)}
            className="text-green-600 hover:text-green-700 font-medium text-sm"
            title="Éditer"
          >
            ✏️
          </button>
          <button
            onClick={() => handleOpenAudit(row)}
            className="text-purple-600 hover:text-purple-700 font-medium text-sm"
            title="Audit"
          >
            📋
          </button>
          <button
            onClick={() => {
              setSelectedNft(row);
              setActiveModal('transfer');
            }}
            className="text-orange-600 hover:text-orange-700 font-medium text-sm"
            title="Transférer"
          >
            🔄
          </button>
          <button
            onClick={() => {
              setSelectedNft(row);
              setActiveModal('delete');
            }}
            className="text-red-600 hover:text-red-700 font-medium text-sm"
            title="Supprimer"
          >
            🗑️
          </button>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">🎨 NFTs/BOMs</h1>
            <p className="text-gray-600 mt-1">
              Gestion des {stats.total} NFTs de la plateforme
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              disabled={loading}
            >
              🔄 Actualiser
            </button>
            <button
              onClick={() => setActiveModal('createCollection')}
              className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-green-700 hover:to-emerald-700 transition-colors"
            >
              📦 Collection
            </button>
            <button
              onClick={() => router.push('/boms/create')}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 transition-colors"
            >
              ➕ Créer
            </button>
          </div>
        </div>

        {/* Dashboard Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">Total</div>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">✅ Actifs</div>
            <div className="text-2xl font-bold text-green-600">{stats.active}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">❌ Inactifs</div>
            <div className="text-2xl font-bold text-red-600">{stats.inactive}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">1/1 Uniques</div>
            <div className="text-2xl font-bold text-purple-600">{stats.unique}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">📚 Éditions</div>
            <div className="text-2xl font-bold text-blue-600">{stats.editions}</div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="text-sm text-gray-600">💰 Valeur</div>
            <div className="text-xl font-bold text-indigo-600">
              {Math.round(stats.totalValue / 1000)}k
            </div>
          </div>
        </div>

        {/* Filtres */}
        <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-4">
          <h3 className="font-semibold text-gray-900">🔍 Filtres</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <input
              type="text"
              placeholder="Rechercher par titre, artiste..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">📊 Tous les statuts</option>
              <option value="active">✅ Actifs</option>
              <option value="inactive">❌ Inactifs</option>
            </select>
            <select
              value={filters.edition_type}
              onChange={(e) => setFilters({ ...filters, edition_type: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">💎 Toutes rareté</option>
              <option value="common">Common</option>
              <option value="rare">Rare</option>
              <option value="ultra_rare">Ultra Rare</option>
              <option value="legendary">Légendaire</option>
            </select>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">📁 Toutes catégories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <select
              value={filters.collection_id}
              onChange={(e) => setFilters({ ...filters, collection_id: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">📦 Toutes collections</option>
              {collections.map(col => (
                <option key={col.id} value={col.id}>{col.name}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
            ❌ Impossible de charger les NFTs. {error.message}
          </div>
        )}

        {/* NFTs Table */}
        <DataTable
          columns={columns}
          data={filteredNfts}
          loading={loading}
          emptyMessage={nfts?.length === 0 ? "Aucun NFT créé" : "Aucun NFT ne correspond aux filtres"}
        />

        {/* === MODAL: DETAILS === */}
        <Modal
          isOpen={activeModal === 'details'}
          onClose={() => setActiveModal(null)}
          title="📋 Détails du NFT"
          size="lg"
        >
          {selectedNft && (
            <div className="space-y-6">
              {/* === PREVIEW SECTION: Animation + Image + Details === */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Animation (GIF/MP4) */}
                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
                  {selectedNft.animation_url ? (
                    selectedNft.animation_url.toLowerCase().endsWith('.gif') || 
                    selectedNft.animation_url.toLowerCase().endsWith('.webp') ? (
                      <img
                        src={selectedNft.animation_url}
                        alt={selectedNft.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const parent = e.currentTarget.parentElement;
                          if (parent) {
                            parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-400">Erreur animation</div>';
                          }
                        }}
                      />
                    ) : (
                      <video
                        src={selectedNft.animation_url}
                        className="w-full h-full object-cover"
                        autoPlay
                        loop
                        muted
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const parent = e.currentTarget.parentElement;
                          if (parent) {
                            parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-400">Erreur vidéo</div>';
                          }
                        }}
                      />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      Aucune animation
                    </div>
                  )}
                </div>

                {/* Preview Image */}
                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden">
                  {selectedNft.preview_image ? (
                    <img
                      src={selectedNft.preview_image}
                      alt={`${selectedNft.title} preview`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-400">Pas d\'image</div>';
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      Pas d'image
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase">Titre</label>
                    <p className="text-sm font-semibold text-gray-900">{selectedNft.title}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase">Token</label>
                    <p className="text-xs font-mono text-gray-900 truncate">{selectedNft.token_id}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase">Valeur</label>
                    <p className="text-sm font-bold text-green-600">
                      {(selectedNft.value || 0).toLocaleString()} FCFA
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase">Rareté</label>
                    <p className="text-sm capitalize text-gray-900">{selectedNft.edition_type}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase">Éditions</label>
                    <p className="text-sm text-gray-900">
                      {selectedNft.max_editions 
                        ? `${selectedNft.current_edition}/${selectedNft.max_editions}` 
                        : '1/1'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase">Statut</label>
                    <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${
                      selectedNft.is_active 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {selectedNft.is_active ? 'Actif' : 'Inactif'}
                    </span>
                  </div>
                </div>
              </div>

              {/* === ADDITIONAL INFO SECTION === */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Artiste</label>
                  <p className="mt-1 text-gray-900">{selectedNft.artist}</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Catégorie</label>
                  <p className="mt-1 text-gray-900">{selectedNft.category}</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700">Propriétaire</label>
                  <p className="mt-1 font-mono text-sm text-gray-900">
                    {selectedNft.owner_id ? `ID: ${selectedNft.owner_id}` : 'Non assigné'}
                  </p>
                </div>
              </div>
              
              {selectedNft.description && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Description</label>
                  <p className="mt-1 text-gray-900">{selectedNft.description}</p>
                </div>
              )}
              
              {selectedNft.tags && selectedNft.tags.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Tags</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedNft.tags.map((tag, index) => (
                      <span key={index} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => handleToggleStatus(selectedNft)}
                  className={`px-4 py-2 rounded-lg font-medium ${
                    selectedNft.is_active
                      ? 'bg-red-100 text-red-700 hover:bg-red-200'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  {selectedNft.is_active ? '❌ Désactiver' : '✅ Activer'}
                </button>
                <button
                  onClick={() => router.push(`/boms/${selectedNft.id}`)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                >
                  ✏️ Modifier
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* === MODAL: TRANSFER === */}
        <Modal
          isOpen={activeModal === 'transfer'}
          onClose={() => {
            setActiveModal(null);
            setTransferToUserId('');
            setTransferReason('');
          }}
          title="🔄 Transférer la propriété"
          size="md"
        >
          {selectedNft && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-700">
                  📌 NFT: <strong>{selectedNft.title}</strong><br/>
                  👤 Propriétaire actuel: ID {selectedNft.owner_id || 'N/A'}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ID du nouvel utilisateur *
                </label>
                <input
                  type="number"
                  value={transferToUserId}
                  onChange={(e) => setTransferToUserId(e.target.value)}
                  placeholder="Ex: 42"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Raison du transfert * (obligatoire)
                </label>
                <textarea
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Explique pourquoi ce transfert est nécessaire..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  rows={3}
                />
              </div>
              
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setActiveModal(null);
                    setTransferToUserId('');
                    setTransferReason('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  disabled={isTransfering}
                >
                  Annuler
                </button>
                <button
                  onClick={handleTransferOwnership}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50"
                  disabled={isTransfering || !transferToUserId || !transferReason}
                >
                  {isTransfering ? '⏳ Transfert...' : '🔄 Transférer'}
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* === MODAL: DELETE === */}
        <Modal
          isOpen={activeModal === 'delete'}
          onClose={() => {
            setActiveModal(null);
            setDeleteReason('');
          }}
          title="🗑️ Supprimer le NFT"
          size="md"
        >
          {selectedNft && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-red-700">
                  ⚠️ ATTENTION: Cette suppression est IRRÉVERSIBLE!
                </p>
                <p className="text-sm text-red-600 mt-2">
                  Vous allez supprimer: <strong>{selectedNft.title}</strong> (ID: {selectedNft.id})
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Raison de la suppression * (obligatoire)
                </label>
                <textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Pourquoi supprimer ce NFT? (ex: Contenu inapproprié, Demande du créateur, etc.)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  rows={3}
                />
              </div>
              
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setActiveModal(null);
                    setDeleteReason('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  disabled={isDeleting}
                >
                  Annuler
                </button>
                <button
                  onClick={handleDeleteNft}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
                  disabled={isDeleting || !deleteReason}
                >
                  {isDeleting ? '⏳ Suppression...' : '🗑️ Supprimer'}
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* === MODAL: CREATE COLLECTION === */}
        <Modal
          isOpen={activeModal === 'createCollection'}
          onClose={() => {
            setActiveModal(null);
            setCollectionData({ name: '', description: '', image_url: '' });
          }}
          title="📦 Créer une Collection"
          size="md"
        >
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-700">
                📌 Les collections servent à regrouper des NFTs par thème ou série
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nom de la collection *
              </label>
              <input
                type="text"
                value={collectionData.name}
                onChange={(e) => setCollectionData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Ex: Dragon Fantasy, Art Numérique, etc."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optionnel)
              </label>
              <textarea
                value={collectionData.description}
                onChange={(e) => setCollectionData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Décris cette collection..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                rows={3}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URL de l'image (optionnel)
              </label>
              <input
                type="url"
                value={collectionData.image_url}
                onChange={(e) => setCollectionData(prev => ({ ...prev, image_url: e.target.value }))}
                placeholder="https://example.com/image.png"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              {collectionData.image_url && (
                <div className="mt-2 p-2 border border-gray-200 rounded-lg bg-gray-50 flex items-center justify-center h-24">
                  <img 
                    src={collectionData.image_url} 
                    alt="preview" 
                    className="max-h-full max-w-full object-contain rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>
            
            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  setActiveModal(null);
                  setCollectionData({ name: '', description: '', image_url: '' });
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                disabled={isCreatingCollection}
              >
                Annuler
              </button>
              <button
                onClick={handleCreateCollection}
                className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                disabled={isCreatingCollection || !collectionData.name.trim()}
              >
                {isCreatingCollection ? '⏳ Création...' : '✅ Créer'}
              </button>
            </div>
          </div>
        </Modal>

        {/* === MODAL: AUDIT LOG === */}
        <Modal
          isOpen={activeModal === 'audit'}
          onClose={() => {
            setActiveModal(null);
            setAuditLog([]);
          }}
          title="📋 Historique d'audit"
          size="lg"
        >
          {selectedNft && (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm text-gray-700">
                  NFT: <strong>{selectedNft.title}</strong> (ID: {selectedNft.id})
                </p>
              </div>
              
              <div className="max-h-96 overflow-y-auto space-y-3">
                {auditLog.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    Aucun événement d'audit enregistré
                  </div>
                ) : (
                  auditLog.map((log, idx) => (
                    <div key={idx} className="border-l-4 border-blue-500 bg-blue-50 p-3 rounded">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-blue-900">{log.action}</p>
                          <p className="text-xs text-blue-700">Admin ID: {log.performed_by}</p>
                        </div>
                        <span className="text-xs text-blue-600">
                          {log.timestamp ? formatDistanceToNow(new Date(log.timestamp), { locale: fr, addSuffix: true }) : ''}
                        </span>
                      </div>
                      {log.raison && (
                        <p className="text-sm text-blue-800 mt-2">💬 {log.raison}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AdminLayout>
  );
}
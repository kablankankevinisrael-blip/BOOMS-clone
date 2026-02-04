import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/Layout/AdminLayout';
import NFTForm from '../../components/Forms/NFTForm';
import { adminService } from '../../services/admin';
import { NFT, NFTCreateData } from '../../types';

export default function EditBom() {
  const [nft, setNft] = useState<NFT | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [collections, setCollections] = useState<Array<{id: number, name: string}>>([]);
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    if (id) {
      loadNFT();
      loadCollections();
    }
  }, [id]);

  const loadNFT = async () => {
    try {
      console.log(`📥 Chargement NFT ID: ${id}`);
      const nftData = await adminService.getNFTById(Number(id));
      console.log('✅ NFT chargé:', {
        id: nftData.id,
        token_id: nftData.token_id,
        title: nftData.title,
        artist: nftData.artist,
        animation_url: nftData.animation_url,
        preview_image: nftData.preview_image
      });
      setNft(nftData);
    } catch (error: any) {
      console.error('❌ Error loading NFT:', error);
      setError(`NFT non trouvé: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadCollections = async () => {
    try {
      console.log('📦 Chargement des collections...');
      const collectionsData = await adminService.getCollections();
      setCollections(collectionsData.map(col => ({
        id: col.id,
        name: col.name
      })));
      console.log('✅ Collections chargées:', collectionsData.length);
    } catch (error) {
      console.error('❌ Erreur chargement collections:', error);
    }
  };

  const handleSubmit = async (nftData: NFTCreateData) => {
    // 🔒 PROTECTION : Empêche les soumissions multiples
    if (submitting) {
      console.log('⚠️ Soumission déjà en cours, ignore');
      return;
    }
    
    console.group('📤 SOUMISSION MODIFICATION NFT');
    console.log('ID à modifier:', id);
    console.log('Données envoyées:', nftData);
    
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      console.log('🔄 Appel à adminService.updateNFT...');
      const result = await adminService.updateNFT(Number(id), nftData);
      console.log('✅ Modification réussie:', {
        id: result.id,
        token_id: result.token_id,
        title: result.title
      });
      
      setSuccess('✅ NFT modifié avec succès! Redirection...');
      
      setTimeout(() => {
        router.push('/boms');
      }, 1500);
      
    } catch (err: any) {
      console.error('❌ Erreur modification:', err);
      
      let errorMessage = 'Erreur lors de la modification';
      
      if (err.response?.data?.detail) {
        if (Array.isArray(err.response.data.detail)) {
          errorMessage = 'Erreurs de validation:\n';
          err.response.data.detail.forEach((error: any, index: number) => {
            const field = error.loc?.join('.') || `erreur_${index}`;
            errorMessage += `• ${field}: ${error.msg}\n`;
          });
        } else {
          errorMessage = String(err.response.data.detail);
        }
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      console.log('📝 Message erreur final:', errorMessage);
      
    } finally {
      setSubmitting(false);
      console.groupEnd();
    }
  };

  const handleBackNavigation = (e: React.MouseEvent) => {
    e.stopPropagation(); // 🛡️ Empêche la propagation aux autres gestionnaires
    e.preventDefault(); // 🛡️ Empêche tout comportement par défaut
    
    if (!submitting) {
      router.back();
    } else {
      console.log('⚠️ Navigation bloquée: soumission en cours');
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement du NFT...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (!nft) {
    return (
      <AdminLayout>
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">NFT non trouvé</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push('/boms')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Retour aux NFTs
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          {/* 🔧 BOUTON RETOUR CORRIGÉ */}
          <button
            onClick={handleBackNavigation}
            className={`text-blue-600 hover:text-blue-700 font-medium mb-4 flex items-center ${
              submitting ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            disabled={submitting}
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {submitting ? 'Modification en cours...' : 'Retour'}
          </button>
          
          <div className="flex items-center mb-4">
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-3 rounded-full mr-4">
              <span className="text-2xl text-white">🎨</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Modifier le NFT</h1>
              <p className="text-gray-600 mt-1">
                {nft.title} - par {nft.artist}
                {nft.token_id && (
                  <span className="ml-2 text-sm bg-gray-100 px-2 py-1 rounded">
                    #{nft.token_id.substring(0, 8)}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-6 py-4 rounded-xl mb-6 flex items-center">
            <span className="text-xl mr-3">✅</span>
            <div>
              <strong>Succès!</strong> {success}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-6 py-4 rounded-xl mb-6">
            <div className="flex items-center mb-3">
              <span className="text-xl mr-3">❌</span>
              <div className="font-bold">Erreur de modification</div>
            </div>
            <pre className="text-sm whitespace-pre-wrap overflow-auto max-h-64 bg-red-100 p-4 rounded-lg mt-2">
              {error}
            </pre>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-6">
            <div className="flex items-center">
              <span className="text-2xl mr-3 text-white">✏️</span>
              <div>
                <h2 className="text-xl font-bold text-white">Édition NFT</h2>
                <p className="text-blue-100 text-sm">Modifiez les informations ci-dessous</p>
              </div>
            </div>
          </div>
          
          <div className="p-8">
            <NFTForm
              mode="edit"
              onSubmit={handleSubmit}
              loading={submitting}
              submitText={submitting ? "🔄 Modification en cours..." : "💾 Enregistrer les modifications"}
              initialData={nft}
              collections={collections}
            />
          </div>
        </div>

        {/* Prévisualisation */}
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">👁️ Prévisualisation</h3>
          
          {/* Grille des médias */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {/* Animation (GIF/MP4) */}
            <div>
              <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                {nft.animation_url ? (
                  <>
                    {nft.animation_url.toLowerCase().endsWith('.gif') || nft.animation_url.includes('giphy') ? (
                      <img
                        src={nft.animation_url}
                        alt={`${nft.title} animation`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <video
                        src={nft.animation_url}
                        autoPlay
                        loop
                        muted
                        className="w-full h-full object-cover"
                      />
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <div className="text-center">
                      <p className="text-sm">🎬 Aucune animation</p>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-2 font-medium">Animation (GIF/MP4)</p>
            </div>

            {/* Preview Image */}
            <div>
              <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                {nft.preview_image ? (
                  <img
                    src={nft.preview_image}
                    alt={`${nft.title} preview`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <div className="text-center">
                      <p className="text-sm">🖼️ Aucune image</p>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-2 font-medium">Image de preview</p>
            </div>

            {/* Détails */}
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold text-gray-700 mb-3">📋 Détails actuels</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start">
                    <span className="w-24 text-gray-500 flex-shrink-0">Token:</span>
                    <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded break-all">{nft.token_id?.substring(0, 12)}...</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-24 text-gray-500">Créé:</span>
                    <span>{new Date(nft.created_at).toLocaleDateString('fr-FR')}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-24 text-gray-500">Statut:</span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${nft.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {nft.is_active ? '✅ Actif' : '❌ Inactif'}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-24 text-gray-500">Édition:</span>
                    <span className="text-xs">{nft.edition_type} • {nft.max_editions ? `${nft.current_edition}/${nft.max_editions}` : '1/1'}</span>
                  </div>
                  <div className="flex items-center pt-2 border-t">
                    <span className="w-24 text-gray-500">Prix:</span>
                    <span className="font-semibold text-blue-600">{(nft.purchase_price || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-24 text-gray-500">Valeur:</span>
                    <span className="font-semibold text-green-600">{(nft.value || 0).toLocaleString('fr-FR')} FCFA</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
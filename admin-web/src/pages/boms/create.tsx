import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../components/Layout/AdminLayout';
import NFTForm from '../../components/Forms/NFTForm'; // CHANGÉ
import { adminService } from '../../services/admin';
import { NFTCreateData } from '../../types'; // CHANGÉ

export default function CreateBom() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<Array<{
    field: string;
    message: string;
  }>>([]);
  const [collections, setCollections] = useState<Array<{id: number, name: string}>>([]);
  const [previewData, setPreviewData] = useState<NFTCreateData | null>(null);
  
  const router = useRouter();

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
      console.error('Error loading collections:', error);
    }
  };

  const handleSubmit = async (nftData: NFTCreateData) => { // CHANGÉ
    setLoading(true);
    setError('');
    setValidationErrors([]);
    setPreviewData(nftData);

    try {
      console.log('🚀 [create] Création NFT:', nftData);
      
      const response = await adminService.createNFT(nftData); // CHANGÉ
      console.log('✅ NFT créé avec succès:', response);
      
      alert(`🎉 NFT créé !\n\nTitre: ${response.title}\nToken ID: ${response.token_id}\nArtiste: ${response.artist}`);
      
      router.push('/boms');
    } catch (err: any) {
      console.error('❌ Erreur création NFT:', err);
      
      let errorMessage = 'Erreur lors de la création du NFT';
      const validationErrs: Array<{field: string, message: string}> = [];
      
      const errorData = err.response?.data;
      
      if (errorData) {
        if (Array.isArray(errorData)) {
          errorMessage = 'Erreurs de validation NFT:';
          errorData.forEach((errorObj: any, index: number) => {
            if (errorObj && typeof errorObj === 'object') {
              const fieldParts = errorObj.loc || [];
              const field = fieldParts.join('.').replace('body.', '');
              const message = errorObj.msg || 'Erreur de validation';
              validationErrs.push({ 
                field: field || `erreur_${index}`, 
                message 
              });
              errorMessage += `\n• ${field}: ${message}`;
            }
          });
        } else if (errorData.detail) {
          errorMessage = String(errorData.detail);
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (typeof errorData === 'object') {
          try {
            errorMessage = JSON.stringify(errorData, null, 2);
          } catch {
            errorMessage = 'Erreur de validation NFT (format inconnu)';
          }
        }
      } else if (err.message) {
        errorMessage = String(err.message);
      }
      
      setError(errorMessage);
      setValidationErrors(validationErrs);
      
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="text-blue-600 hover:text-blue-700 font-medium mb-6 flex items-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Retour
          </button>
          
          <div className="flex items-center mb-4">
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-3 rounded-full mr-4">
              <span className="text-2xl text-white">🎨</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Créer un NFT</h1>
              <p className="text-gray-600 mt-1">
                Ajouter un nouveau NFT à la plateforme avec animation
              </p>
            </div>
          </div>
          
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-lg border border-purple-200">
            <p className="text-sm text-purple-800">
              <strong>💡 Info:</strong> Les NFTs sont des actifs numériques uniques avec animations. 
              Chaque NFT a un token ID unique et peut être collectionné, offert ou revendu.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-8 space-y-4">
            <div className="bg-red-50 border border-red-200 text-red-600 px-6 py-4 rounded-xl shadow-sm">
              <div className="flex items-center mb-3">
                <span className="text-xl mr-3">❌</span>
                <div className="font-bold text-lg">Erreur de création NFT</div>
              </div>
              <pre className="text-sm whitespace-pre-wrap overflow-auto max-h-80 bg-red-100 p-4 rounded-lg mt-2">
                {error}
              </pre>
            </div>
            
            {validationErrors.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-6 py-4 rounded-xl">
                <div className="font-bold mb-3 flex items-center">
                  <span className="text-lg mr-2">📋</span>
                  Corrections nécessaires:
                </div>
                <ul className="space-y-3">
                  {validationErrors.map((err, index) => (
                    <li key={index} className="flex items-start bg-white p-3 rounded-lg">
                      <span className="mr-3 text-yellow-500">•</span>
                      <div>
                        <strong className="capitalize text-gray-800">
                          {err.field.replace(/_/g, ' ')}:
                        </strong>
                        <span className="ml-2 text-gray-700">{err.message}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-6">
            <div className="flex items-center">
              <span className="text-2xl mr-3 text-white">🎬</span>
              <div>
                <h2 className="text-xl font-bold text-white">Nouveau NFT</h2>
                <p className="text-blue-100 text-sm">Remplissez les informations ci-dessous</p>
              </div>
            </div>
          </div>
          
          <div className="p-8">
            <NFTForm
              mode="create"
              onSubmit={handleSubmit}
              loading={loading}
              submitText={loading ? "🎨 Création en cours..." : "Créer le NFT"}
              validationErrors={validationErrors}
              collections={collections}
            />
          </div>
        </div>

        {/* Prévisualisation - Affichée après avoir commencé à remplir le formulaire */}
        {previewData && (
          <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">👁️ Prévisualisation</h3>
            
            {/* Grille des médias */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Animation (GIF/MP4) */}
              <div>
                <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                  {previewData.animation_url ? (
                    <>
                      {previewData.animation_url.toLowerCase().endsWith('.gif') || previewData.animation_url.includes('giphy') ? (
                        <img
                          src={previewData.animation_url}
                          alt={`${previewData.title} animation`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://media.giphy.com/media/3o7abAHdYvZdBNnGZq/giphy.gif';
                          }}
                        />
                      ) : (
                        <video
                          src={previewData.animation_url}
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
                        <p className="text-xs mt-1">Entrez une URL</p>
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-2 font-medium">Animation (GIF/MP4)</p>
              </div>

              {/* Preview Image */}
              <div>
                <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                  {previewData.preview_image ? (
                    <img
                      src={previewData.preview_image}
                      alt={`${previewData.title} preview`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://media.giphy.com/media/3o7abAHdYvZdBNnGZq/giphy.gif';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <p className="text-sm">🖼️ Aucune image</p>
                        <p className="text-xs mt-1">Entrez une URL</p>
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-2 font-medium">Image de preview</p>
              </div>

              {/* Détails */}
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold text-gray-700 mb-3">📋 Aperçu avant publication</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start">
                      <span className="w-24 text-gray-500 flex-shrink-0">Titre:</span>
                      <span className="font-medium text-gray-800">{previewData.title || '—'}</span>
                    </div>
                    <div className="flex items-start">
                      <span className="w-24 text-gray-500 flex-shrink-0">Artiste:</span>
                      <span className="text-gray-700">{previewData.artist || '—'}</span>
                    </div>
                    <div className="flex items-start">
                      <span className="w-24 text-gray-500 flex-shrink-0">Collection:</span>
                      <span className="text-gray-700 text-xs">{previewData.collection_id ? `ID: ${previewData.collection_id}` : '—'}</span>
                    </div>
                    <div className="flex items-center pt-2 border-t">
                      <span className="w-24 text-gray-500">Prix:</span>
                      <span className="font-semibold text-blue-600">{(previewData.purchase_price || 0).toLocaleString('fr-FR')} FCFA</span>
                    </div>
                    <div className="flex items-start">
                      <span className="w-24 text-gray-500 flex-shrink-0">Type:</span>
                      <span className="text-gray-700">{previewData.edition_type || '—'}</span>
                    </div>
                    {previewData.max_editions && (
                      <div className="flex items-center">
                        <span className="w-24 text-gray-500">Éditions:</span>
                        <span className="text-gray-700">{previewData.max_editions}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
            <span className="mr-2">📚</span>
            Guide de création NFT
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-gray-700 mb-2">🎬 Animations recommandées</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span><strong>GIFs animés:</strong> max 15 secondes, 500x500px</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span><strong>Vidéos MP4:</strong> max 30 secondes, 720p</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span><strong>Audio:</strong> MP3 optionnel, max 1 minute</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-gray-700 mb-2">💰 Valeurs recommandées</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span><strong>Commun:</strong> 1,000 - 5,000 FCFA</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span><strong>Rare:</strong> 5,000 - 20,000 FCFA</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span><strong>Ultra Rare:</strong> 20,000 - 50,000 FCFA</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span><strong>Légendaire:</strong> 50,000+ FCFA</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
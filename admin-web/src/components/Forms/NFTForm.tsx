import React, { useState, useEffect, useMemo, useRef } from 'react';
import { NFT, NFTCreateData } from '../../types';

interface NFTFormProps {
  onSubmit: (data: NFTCreateData) => void;
  loading: boolean;
  submitText: string;
  initialData?: NFT;
  validationErrors?: Array<{field: string, message: string}>;
  collections?: Array<{id: number, name: string}>;
  mode?: 'create' | 'edit';  // ← NOUVEAU: mode de formulaire
}

const categories = [
  'Art Numérique',
  'Animation',
  'Musique Visuelle',
  'Photographie',
  'Design',
  'Pixel Art',
  '3D Art',
  'Generative Art',
  'Autre'
];

const editionTypes = [
  { value: 'common', label: '🟢 Commune', description: 'Édition régulière' },
  { value: 'rare', label: '🔵 Rare', description: 'Édition limitée' },
  { value: 'ultra_rare', label: '🟣 Ultra Rare', description: 'Édition exclusive' },
  { value: 'legendary', label: '🟡 Légendaire', description: 'Édition unique' }
];

export default function NFTForm({ 
  onSubmit, 
  loading, 
  submitText, 
  initialData,
  validationErrors = [],
  collections = [],
  mode = 'create'  // ← NOUVEAU: par défaut création
}: NFTFormProps) {
  // Initialisation du formData avec les champs NFT
  const initialFormData = useMemo(() => ({
    title: initialData?.title || '',
    description: initialData?.description || '',
    artist: initialData?.artist || '',
    category: initialData?.category || categories[0],
    animation_url: initialData?.animation_url || '',
    audio_url: initialData?.audio_url || '',
    preview_image: initialData?.preview_image || '',
    duration: initialData?.duration || null,
    value: initialData?.value || 0,
    purchase_price: initialData?.purchase_price || 0,
    royalty_percentage: initialData?.royalty_percentage || 10.0,
    collection_id: initialData?.collection_id || null,
    edition_type: initialData?.edition_type || editionTypes[0].value,
    max_editions: initialData?.max_editions || null,
    tags: initialData?.tags || [],
    attributes: initialData?.attributes || [],
  }), [initialData]);

  const [formData, setFormData] = useState<NFTCreateData>(initialFormData);
  const [tagInput, setTagInput] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attributeInput, setAttributeInput] = useState({ trait_type: '', value: '' });
  
  // Référence pour suivre les données initiales précédentes
  const prevInitialFormDataRef = useRef<NFTCreateData>();
  const prevValidationErrorsRef = useRef<Array<{field: string, message: string}>>();

  useEffect(() => {
    // Vérifier si validationErrors a réellement changé
    const prevErrors = prevValidationErrorsRef.current;
  
    // Si c'est le même tableau (même référence) ou même contenu, ne rien faire
    if (validationErrors === prevErrors || 
        JSON.stringify(validationErrors) === JSON.stringify(prevErrors)) {
      return;
    }
  
    if (validationErrors.length === 0) {
      setFieldErrors({});
    } else {
      const newFieldErrors: Record<string, string> = {};
      validationErrors.forEach(err => {
        const fieldName = err.field.split('.').pop() || err.field;
        newFieldErrors[fieldName] = err.message;
      });
      setFieldErrors(newFieldErrors);
    }
  
    prevValidationErrorsRef.current = validationErrors;
  }, [validationErrors]); // La dépendance reste mais on compare le contenu

  // CORRECTION : Réinitialisation quand initialData change - sans boucle infinie
  useEffect(() => {
    // Vérifier si initialFormData a réellement changé
    if (JSON.stringify(prevInitialFormDataRef.current) !== JSON.stringify(initialFormData)) {
      console.log('🔄 NFTForm: Mise à jour du formulaire avec les données initiales');
      setFormData(initialFormData);
      prevInitialFormDataRef.current = initialFormData;
    }
  }, [initialFormData]); // SEULEMENT initialFormData dans les dépendances

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    // Effacer l'erreur du champ
    if (fieldErrors[name]) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? null : Number(value)) : value
    }));
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags?.includes(tagInput.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags?.filter(tag => tag !== tagToRemove) || []
    }));
  };

  const handleAddAttribute = () => {
    if (attributeInput.trait_type.trim() && attributeInput.value.trim()) {
      const newAttribute = {
        trait_type: attributeInput.trait_type.trim(),
        value: attributeInput.value.trim()
      };
      
      setFormData(prev => ({
        ...prev,
        attributes: [...(prev.attributes || []), newAttribute]
      }));
      
      setAttributeInput({ trait_type: '', value: '' });
    }
  };

  const handleRemoveAttribute = (indexToRemove: number) => {
    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes?.filter((_, index) => index !== indexToRemove) || []
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation client
    const errors: Record<string, string> = {};
    
    if (!formData.title.trim()) errors.title = 'Le titre est requis';
    if (!formData.artist.trim()) errors.artist = "L'artiste est requis";
    if (!formData.category.trim()) errors.category = 'La catégorie est requise';
    if (!formData.animation_url.trim()) errors.animation_url = "L'URL d'animation est requise";
    if (!formData.preview_image.trim()) errors.preview_image = "L'image de preview est requise";
    if (formData.value <= 0) errors.value = 'La valeur doit être positive';
    if (formData.purchase_price <= 0) errors.purchase_price = 'Le prix d\'achat doit être positif';
    
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    
    onSubmit(formData);
  };

  const getFieldClass = (fieldName: string) => {
    return `w-full px-4 py-2 border rounded-lg focus:ring-2 focus:outline-none ${fieldErrors[fieldName] 
      ? 'border-red-500 focus:border-red-500 focus:ring-red-200' 
      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-200'}`;
  };

  const getEditionDescription = (type: string) => {
    const edition = editionTypes.find(ed => ed.value === type);
    return edition ? edition.description : '';
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-6 rounded-xl mb-8">
        <div className="flex items-center">
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-3 rounded-full mr-4">
            <span className="text-2xl text-white">🎨</span>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {initialData ? 'Modifier le NFT' : 'Créer un NFT'}
            </h2>
            <p className="text-gray-600">
              {initialData 
                ? `NFT #${initialData.token_id?.substring(0, 8)} - ${initialData.title}`
                : 'Remplissez les informations pour créer un NFT unique'
              }
            </p>
          </div>
        </div>
      </div>

      {/* === INFORMATIONS DE BASE === */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="title" className="block text-sm font-semibold text-gray-700 mb-2">
            Titre du NFT *
          </label>
          <input
            type="text"
            id="title"
            name="title"
            required
            value={formData.title}
            onChange={handleChange}
            className={getFieldClass('title')}
            placeholder="Titre unique du NFT"
          />
          {fieldErrors.title && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.title}</p>
          )}
        </div>

        <div>
          <label htmlFor="artist" className="block text-sm font-semibold text-gray-700 mb-2">
            Artiste/Créateur *
          </label>
          <input
            type="text"
            id="artist"
            name="artist"
            required
            value={formData.artist}
            onChange={handleChange}
            className={getFieldClass('artist')}
            placeholder="Nom de l'artiste ou pseudonyme"
          />
          {fieldErrors.artist && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.artist}</p>
          )}
        </div>
      </div>

      {/* === DESCRIPTION === */}
      <div>
        <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-2">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          value={formData.description || ''}
          onChange={handleChange}
          className={getFieldClass('description')}
          placeholder="Décrivez votre NFT, son histoire, sa signification..."
        />
      </div>

      {/* === CATÉGORIE ET COLLECTION === */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="category" className="block text-sm font-semibold text-gray-700 mb-2">
            Catégorie *
          </label>
          <select
            id="category"
            name="category"
            required
            value={formData.category}
            onChange={handleChange}
            className={getFieldClass('category')}
          >
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="collection_id" className="block text-sm font-semibold text-gray-700 mb-2">
            Collection (optionnel)
          </label>
          <select
            id="collection_id"
            name="collection_id"
            value={formData.collection_id || ''}
            onChange={handleChange}
            className={getFieldClass('collection_id')}
          >
            <option value="">Sans collection</option>
            {collections.map(collection => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* === MÉDIAS NFT === */}
      <div className="bg-gray-50 p-6 rounded-xl space-y-6">
        <h3 className="text-lg font-semibold text-gray-800">🎬 Contenu du NFT</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="animation_url" className="block text-sm font-semibold text-gray-700 mb-2">
              URL d'animation (GIF/MP4) *
            </label>
            <input
              type="url"
              id="animation_url"
              name="animation_url"
              required
              value={formData.animation_url}
              onChange={handleChange}
              className={getFieldClass('animation_url')}
              placeholder="https://example.com/animation.gif"
            />
            {fieldErrors.animation_url && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.animation_url}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              URL d'un GIF animé ou vidéo MP4 courte (max 30s)
            </p>
          </div>

          <div>
            <label htmlFor="preview_image" className="block text-sm font-semibold text-gray-700 mb-2">
              Image de preview *
            </label>
            <input
              type="url"
              id="preview_image"
              name="preview_image"
              required
              value={formData.preview_image}
              onChange={handleChange}
              className={getFieldClass('preview_image')}
              placeholder="https://example.com/preview.jpg"
            />
            {fieldErrors.preview_image && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.preview_image}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Image statique pour l'affichage dans les galeries
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="audio_url" className="block text-sm font-semibold text-gray-700 mb-2">
              URL audio (optionnel)
            </label>
            <input
              type="url"
              id="audio_url"
              name="audio_url"
              value={formData.audio_url || ''}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 focus:outline-none"
              placeholder="https://example.com/audio.mp3"
            />
          </div>

          <div>
            <label htmlFor="duration" className="block text-sm font-semibold text-gray-700 mb-2">
              Durée (secondes)
            </label>
            <input
              type="number"
              id="duration"
              name="duration"
              min="0"
              max="60"
              value={formData.duration || ''}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 focus:outline-none"
              placeholder="Durée en secondes"
            />
          </div>
        </div>
      </div>

      {/* === VALEURS ET PRIX === */}
      <div className="bg-gray-50 p-6 rounded-xl space-y-6">
        <h3 className="text-lg font-semibold text-gray-800">💰 Valeurs</h3>
        
        {/* MODE CRÉATION: Prix d'achat modifiable, valeur calculée */}
        {mode === 'create' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="purchase_price" className="block text-sm font-semibold text-gray-700 mb-2">
                  💳 Prix d'achat (FCFA) * ← À FIXER
                </label>
                <input
                  type="number"
                  id="purchase_price"
                  name="purchase_price"
                  required
                  min="0"
                  step="100"
                  value={formData.purchase_price}
                  onChange={handleChange}
                  className={getFieldClass('purchase_price')}
                  placeholder="Ex: 5000"
                />
                {fieldErrors.purchase_price && (
                  <p className="mt-1 text-sm text-red-600">{fieldErrors.purchase_price}</p>
                )}
                <p className="mt-2 text-xs text-gray-600">
                  📌 Ce prix est <strong>FIXÉ DÉFINITIVEMENT</strong> et servira de référence de base.
                  La valeur réelle augmentera avec les interactions sociales.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  📊 Valeur initiale (automatique)
                </label>
                <div className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-700">
                  {(formData.purchase_price || 0).toLocaleString('fr-FR')} FCFA
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  ✅ Au départ, la valeur = prix d'achat. Elle augmentera avec les interactions.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* MODE ÉDITION: Tout en lecture seule */}
        {mode === 'edit' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-800">
                📌 <strong>Les prix ne sont pas modifiables en édition.</strong><br/>
                • <strong>Prix d'achat</strong> est fixé à la création et jamais changé<br/>
                • <strong>Valeur réelle</strong> est calculée automatiquement par les interactions sociales
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  💳 Prix d'achat (FCFA) - FIXÉ
                </label>
                <div className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-700 font-medium">
                  {(initialData?.purchase_price || 0).toLocaleString('fr-FR')} FCFA
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  ✅ Ne change jamais. C'est la référence de base.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  📈 Valeur réelle (FCFA) - DYNAMIQUE
                </label>
                <div className="w-full px-4 py-2 border border-blue-300 rounded-lg bg-blue-50 text-blue-800 font-semibold">
                  {(initialData?.value || 0).toLocaleString('fr-FR')} FCFA
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  🔄 Augmente avec les achats, partages, réactions sociales.<br/>
                  📊 Calculée automatiquement par le système.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
          <div>
            <label htmlFor="royalty_percentage" className="block text-sm font-semibold text-gray-700 mb-2">
              Royalties artiste (%)
            </label>
            <input
              type="number"
              id="royalty_percentage"
              name="royalty_percentage"
              min="0"
              max="50"
              step="0.5"
              value={formData.royalty_percentage}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 focus:outline-none"
              placeholder="10"
            />
          </div>
        </div>
      </div>

      {/* === ÉDITION ET RARETÉ === */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-xl space-y-6">
        <h3 className="text-lg font-semibold text-gray-800">🏆 Édition & Rareté</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="edition_type" className="block text-sm font-semibold text-gray-700 mb-2">
              Type d'édition *
            </label>
            <select
              id="edition_type"
              name="edition_type"
              required
              value={formData.edition_type}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 focus:outline-none"
            >
              {editionTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-sm text-gray-600">
              {getEditionDescription(formData.edition_type)}
            </p>
          </div>

          <div>
            <label htmlFor="max_editions" className="block text-sm font-semibold text-gray-700 mb-2">
              Nombre d'exemplaires
            </label>
            <input
              type="number"
              id="max_editions"
              name="max_editions"
              min="1"
              value={formData.max_editions || ''}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 focus:outline-none"
              placeholder="Laisser vide pour édition unique"
            />
            <p className="mt-1 text-xs text-gray-500">
              Nombre total d'exemplaires. Vide = édition unique (1/1)
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Tags
          </label>
          <div className="flex space-x-2 mb-4">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 focus:outline-none"
              placeholder="Ajouter un tag..."
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
            <button
              type="button"
              onClick={handleAddTag}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Ajouter
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {formData.tags?.map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gradient-to-r from-blue-100 to-purple-100 text-blue-800 border border-blue-200"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-2 text-blue-600 hover:text-blue-800"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* === ATTRIBUTS NFT === */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3">🔧 Attributs NFT</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <input
                type="text"
                value={attributeInput.trait_type}
                onChange={(e) => setAttributeInput({...attributeInput, trait_type: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 focus:outline-none"
                placeholder="Type d'attribut (ex: Rarity)"
              />
            </div>
            <div>
              <input
                type="text"
                value={attributeInput.value}
                onChange={(e) => setAttributeInput({...attributeInput, value: e.target.value})}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-500 focus:outline-none"
                placeholder="Valeur (ex: Legendary)"
              />
            </div>
          </div>
          
          <button
            type="button"
            onClick={handleAddAttribute}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors mb-4"
          >
            + Ajouter un attribut
          </button>
          
          <div className="space-y-3">
            {formData.attributes?.map((attr, index) => (
              <div key={index} className="flex items-center justify-between bg-white p-3 rounded-lg border">
                <div>
                  <span className="font-medium text-gray-700">{attr.trait_type}:</span>
                  <span className="ml-2 text-gray-600">{attr.value}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveAttribute(index)}
                  className="text-red-500 hover:text-red-700"
                >
                  Supprimer
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === SUBMIT === */}
      <div className="flex justify-end pt-8 border-t border-gray-200">
        <button
          type="submit"
          disabled={loading}
          className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg"
        >
          {loading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Traitement...
            </span>
          ) : (
            submitText
          )}
        </button>
      </div>
    </form>
  );
}
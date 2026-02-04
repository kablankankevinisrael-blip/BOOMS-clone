import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '@/components/Layout/AdminLayout';
import { adminService } from '../../services/admin';
import { ArrowLeft, AlertCircle, CheckCircle, RefreshCw, User, Phone, Wallet } from 'lucide-react';

export default function RedistributeFunds() {
  const router = useRouter();
  const { from_user_id } = router.query;

  const [form, setForm] = useState({
    to_user_id: '',
    amount: '',
    reason: 'royalties' as 'royalties' | 'bonus' | 'refund' | 'correction' | 'other',
    description: ''
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [sourceUser, setSourceUser] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const MAX_RETRIES = 3;

  useEffect(() => {
    if (from_user_id) {
      loadSourceUser();
    }
  }, [from_user_id]);

  const loadSourceUser = async () => {
    try {
      const userFunds = await adminService.getUserFunds(Number(from_user_id));
      setSourceUser(userFunds);
    } catch (err) {
      console.error('Erreur chargement utilisateur source:', err);
      setError('Impossible de charger les informations de l\'utilisateur source');
    }
  };

  // Validation locale simple
  const validateForm = () => {
    setValidationError(null);

    // Vérification des champs obligatoires
    if (!form.to_user_id || !form.amount) {
      return false;
    }

    const amount = parseFloat(form.amount);
    
    if (isNaN(amount) || amount <= 0) {
      setValidationError('Le montant doit être positif');
      return false;
    }

    if (amount < 100) {
      setValidationError('Le montant minimum est de 100 FCFA');
      return false;
    }

    // Vérification du solde source (uniquement si from_user_id existe)
    if (from_user_id && sourceUser) {
      const sourceBalance = sourceUser.cash_balance || 0;
      if (amount > sourceBalance) {
        setValidationError(`Montant supérieur au solde disponible (${sourceBalance.toFixed(4)} FCFA)`);
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation locale
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setSuccess('');
    setError('');
    setRetryCount(0);

    try {
      const response = await executeRedistribution();
      
      if (!response.success) {
        throw new Error(response.message || 'Redistribution échouée');
      }

      handleSuccess(response);
      
    } catch (err: any) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const executeRedistribution = async (): Promise<any> => {
    try {
      return await adminService.redistributeFunds({
        from_user_id: from_user_id ? Number(from_user_id) : undefined,
        to_user_id: Number(form.to_user_id),
        amount: adminService.toDecimalString(form.amount),
        reason: form.reason,
        description: form.description
      });
    } catch (err: any) {
      // Gestion spécifique des erreurs de transaction
      const errorMessage = err.response?.data?.detail || err.message || 'Erreur inconnue';
      
      if (isTransactionError(errorMessage) && retryCount < MAX_RETRIES) {
        // Tentative de retry
        setRetryCount(prev => prev + 1);
        setError(`Tentative ${retryCount + 1}/${MAX_RETRIES}...`);
        
        // Attente exponentielle
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        
        return executeRedistribution();
      }
      
      throw err;
    }
  };

  const isTransactionError = (message: string): boolean => {
    const transactionErrors = [
      'closed transaction',
      'context manager',
      'Can\'t operate',
      'transaction inside',
      'SQLAlchemy',
      'transaction rollback'
    ];
    
    return transactionErrors.some(error => message.toLowerCase().includes(error.toLowerCase()));
  };

  const handleSuccess = (response: any) => {
    const successMessage = `Redistribution de ${form.amount} FCFA réussie ! (Type: ${form.reason})`;
    setSuccess(successMessage);
    
    // Réinitialiser le formulaire
    setForm({ ...form, amount: '', to_user_id: '', description: '' });
    setValidationError(null);

    // Notifier les autres composants
    notifyRefresh();

    // Rafraîchir les données utilisateur
    if (from_user_id) {
      setTimeout(() => loadSourceUser(), 1000);
    }

    // Redirection optionnelle après délai
    setTimeout(() => {
      if (window.confirm('Redistribution réussie ! Souhaitez-vous retourner à la gestion des fonds ?')) {
        router.push('/funds');
      }
    }, 2000);
  };

  const handleError = (err: any) => {
    let errorMessage = err.response?.data?.detail || err.message || 'Erreur inconnue';
    
    if (isTransactionError(errorMessage)) {
      if (retryCount >= MAX_RETRIES) {
        errorMessage = `Échec après ${MAX_RETRIES} tentatives. Erreur technique de transaction. Veuillez réessayer plus tard ou contacter l'administrateur.`;
      } else {
        errorMessage = `Erreur technique temporaire. Tentative ${retryCount + 1}/${MAX_RETRIES} échouée.`;
      }
    }
    
    setError(`Échec de la redistribution : ${errorMessage}`);
    console.error('Redistribution error:', err);
  };

  const notifyRefresh = () => {
    if (typeof window !== 'undefined') {
      // Méthode 1: Broadcast à toutes les fenêtres
      window.postMessage({ type: 'REFRESH_FUNDS_DATA', timestamp: Date.now() }, '*');
      
      // Méthode 2: Rafraîchir si ouvert dans un popup
      if (window.opener) {
        window.opener.postMessage({ type: 'REFRESH_FUNDS_DATA', timestamp: Date.now() }, '*');
      }
      
      // Méthode 3: Rafraîchir la session storage
      sessionStorage.setItem('forceRefreshFunds', Date.now().toString());
    }
  };

  const reasons = [
    { value: 'royalties', label: 'Royalties NFT', description: 'Paiement de royalties entre artistes' },
    { value: 'bonus', label: 'Bonus utilisateur', description: 'Bonus de parrainage ou promotionnel' },
    { value: 'refund', label: 'Remboursement', description: 'Remboursement d\'un achat ou service' },
    { value: 'correction', label: 'Correction de solde', description: 'Ajustement technique de compte' },
    { value: 'other', label: 'Autre', description: 'Autre type de redistribution' },
  ];

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  };

  const getReasonDescription = () => {
    const reasonObj = reasons.find(r => r.value === form.reason);
    return reasonObj?.description || '';
  };

  const getTransactionTypes = () => {
    const types: Record<string, { from: string; to: string }> = {
      royalties: { from: 'royalties_payout', to: 'royalties_received' },
      bonus: { from: 'bonus_payout', to: 'bonus_received' },
      refund: { from: 'refund_payout', to: 'refund_received' },
      correction: { from: 'correction_payout', to: 'correction_received' },
      other: { from: 'other_redistribution_payout', to: 'other_redistribution_received' }
    };
    return types[form.reason] || { from: 'payout', to: 'received' };
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center mb-8">
          <button
            onClick={() => router.push('/funds')}
            className="flex items-center text-gray-600 hover:text-gray-900 mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Retour à la gestion des fonds"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Redistribuer des Fonds</h1>
            <p className="text-gray-600 mt-1">
              Transférer des fonds entre utilisateurs ou depuis la plateforme
            </p>
          </div>
        </div>

        <div className="card p-6 space-y-6">
          {/* Source User Info */}
          {sourceUser && (
            <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
              <h3 className="font-semibold text-blue-800 mb-3 flex items-center">
                <User className="mr-2" size={18} />
                Source des fonds
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-3 bg-white rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Utilisateur</p>
                  <p className="font-medium text-gray-900">{sourceUser.full_name || `Utilisateur ${from_user_id}`}</p>
                  <div className="flex items-center mt-1 text-sm text-gray-500">
                    <Phone size={14} className="mr-1" />
                    {sourceUser.phone || 'Non renseigné'}
                  </div>
                </div>
                <div className="p-3 bg-white rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">ID Utilisateur</p>
                  <p className="font-mono font-bold text-blue-600">{from_user_id}</p>
                </div>
                <div className="p-3 bg-white rounded-lg">
                  <p className="text-sm text-gray-600 mb-1 flex items-center">
                    <Wallet size={14} className="mr-1" />
                    Solde disponible
                  </p>
                  <p className="text-xl font-bold text-green-600">
                    {formatAmount(sourceUser.cash_balance)} FCFA
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start">
              <CheckCircle className="mr-3 mt-0.5 flex-shrink-0 text-green-500" size={20} />
              <div className="flex-1">
                <span className="text-green-800 font-medium">{success}</span>
                <p className="text-sm text-green-600 mt-1">
                  Les transactions ont été créées avec succès. Les soldes sont mis à jour.
                </p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start">
                <AlertCircle className="mr-3 mt-0.5 flex-shrink-0 text-red-500" size={20} />
                <div className="flex-1">
                  <span className="text-red-800 font-medium">{error}</span>
                  {isTransactionError(error) && retryCount < MAX_RETRIES && (
                    <div className="mt-2 flex items-center text-sm text-red-600">
                      <RefreshCw className="mr-2 animate-spin" size={16} />
                      Tentative automatique en cours...
                    </div>
                  )}
                </div>
              </div>
              {isTransactionError(error) && retryCount >= MAX_RETRIES && (
                <button
                  onClick={() => {
                    setRetryCount(0);
                    setError('');
                  }}
                  className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm font-medium"
                >
                  Réessayer manuellement
                </button>
              )}
            </div>
          )}

          {/* Validation Error */}
          {validationError && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center">
                <AlertCircle className="mr-2 text-yellow-600" size={16} />
                <span className="text-sm font-medium text-yellow-700">
                  {validationError}
                </span>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Destinataire */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700">
                  ID utilisateur destinataire
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={form.to_user_id}
                  onChange={(e) => {
                    setForm({ ...form, to_user_id: e.target.value });
                    setValidationError(null);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  placeholder="Ex: 456"
                  disabled={loading}
                />
                <p className="text-sm text-gray-500 mt-1">
                  L'ID numérique de l'utilisateur qui recevra les fonds
                </p>
              </div>

              {/* Montant */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700">
                  Montant à redistribuer (FCFA)
                </label>
                <input
                  type="number"
                  required
                  min="100"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => {
                    setForm({ ...form, amount: e.target.value });
                    setValidationError(null);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  placeholder="Ex: 50000.50"
                  disabled={loading}
                />
                <div className="flex justify-between mt-1">
                  <p className="text-sm text-gray-500">Minimum: 100 FCFA</p>
                  {sourceUser && form.amount && parseFloat(form.amount) > sourceUser.cash_balance && (
                    <p className="text-sm text-red-600 font-medium">
                      Solde insuffisant
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Raison */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700">
                Raison de la redistribution
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2 mb-3">
                {reasons.map((reason) => (
                  <button
                    key={reason.value}
                    type="button"
                    onClick={() => setForm({ ...form, reason: reason.value as any })}
                    className={`p-3 rounded-lg border text-sm font-medium transition-all ${form.reason === reason.value
                        ? 'bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-blue-100'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                      }`}
                    disabled={loading}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-700 mb-1">
                  <span className="font-medium">Description:</span> {getReasonDescription()}
                </p>
                <p className="text-xs text-gray-500">
                  Types de transaction: {getTransactionTypes().from} → {getTransactionTypes().to}
                </p>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700">
                Description (optionnel)
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors min-h-[100px]"
                placeholder="Notes supplémentaires, référence interne, détails..."
                disabled={loading}
              />
              <p className="text-sm text-gray-500 mt-1">
                Cette description apparaîtra dans l'historique des transactions des deux utilisateurs
              </p>
            </div>

            {/* Summary */}
            {form.amount && form.to_user_id && !validationError && (
              <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
                <h4 className="font-semibold text-purple-800 mb-2">Récapitulatif</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Source:</span>
                    <span className="font-medium">
                      {from_user_id ? `Utilisateur ${from_user_id}` : 'Caisse Plateforme'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Destinataire:</span>
                    <span className="font-medium">Utilisateur {form.to_user_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Montant:</span>
                    <span className="font-bold text-purple-700">
                      {formatAmount(parseFloat(form.amount))} FCFA
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Raison:</span>
                    <span className="font-medium">{reasons.find(r => r.value === form.reason)?.label}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-4 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={() => router.push('/funds')}
                className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                disabled={loading}
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={loading || !form.to_user_id || !form.amount || !!validationError}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <RefreshCw className="mr-2 animate-spin" size={18} />
                    {retryCount > 0 ? `Traitement (${retryCount})...` : 'Traitement...'}
                  </>
                ) : (
                  `Confirmer la redistribution`
                )}
              </button>
            </div>
          </form>

          {/* Important Information */}
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h4 className="font-semibold text-yellow-800 mb-3 flex items-center">
              <AlertCircle size={18} className="mr-2" />
              Informations importantes
            </h4>
            <ul className="text-sm text-yellow-700 space-y-2">
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Cette action est <strong>irréversible</strong> et sera journalisée dans l'historique des transactions</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Les types de transaction seront spécifiques à la raison choisie (ex: royalties_received/royalties_payout)</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Les deux utilisateurs verront la transaction dans leur historique avec la description fournie</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Vérifiez bien les IDs utilisateur avant validation</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
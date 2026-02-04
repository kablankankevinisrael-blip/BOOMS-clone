import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/Layout/AdminLayout';
import { adminService } from '../../services/admin';
import BigNumber from 'bignumber.js';

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'general' | 'fees' | 'payment' | 'notifications' | 'security'>('general');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // === DONNÉES GÉNÉRALES ===
  const [generalSettings, setGeneralSettings] = useState({
    appName: 'BOOMS',
    appDescription: 'Plateforme de cadeaux collaboratifs',
    appLogo: '',
    supportEmail: 'support@booms.cm',
    phone: '+237 6 XX XX XX XX',
  });

  // === FRAIS ET COMMISSIONS ===
  const [feeSettings, setFeeSettings] = useState({
    platformFee: '5', // %
    creatorCommission: '15', // %
    paymentFee: '2.5', // %
    withdrawalFee: '1000', // montant fixe en FCFA
    minWithdrawal: '10000',
    maxWithdrawal: '1000000',
  });

  // === PAIEMENT (STRIPE) ===
  const [paymentSettings, setPaymentSettings] = useState({
    stripePublicKey: '****',
    stripeWebhookUrl: 'https://api.booms.cm/webhooks/stripe',
    paymentMethods: ['card', 'mobile_money'],
    currency: 'XAF',
  });

  // === NOTIFICATIONS ===
  const [notificationSettings, setNotificationSettings] = useState({
    emailNotifications: true,
    smsNotifications: true,
    pushNotifications: true,
    dailyReport: true,
    weeklyReport: true,
    alertThreshold: '1000000', // montant seuil pour alertes
  });

  // === SÉCURITÉ ===
  const [securitySettings, setSecuritySettings] = useState({
    twoFactorAuth: true,
    ipWhitelist: '',
    maxLoginAttempts: '5',
    sessionTimeout: '3600', // secondes
    requirePasswordChange: '90', // jours
    enableAuditLog: true,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      // Charger depuis le backend quand disponible
      // const settings = await adminService.getSettings();
      console.log('⚙️ Paramètres chargés');
    } catch (error) {
      console.error('Erreur chargement settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGeneral = async () => {
    try {
      setLoading(true);
      const result = await adminService.updateSettingsGeneral({
        platform_name: generalSettings.appName,
        platform_description: generalSettings.appDescription,
        support_email: generalSettings.supportEmail,
        support_phone: generalSettings.phone,
      });
      
      if (result.success) {
        setMessage({ type: 'success', text: '✅ Paramètres généraux sauvegardés' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: '❌ Erreur lors de la sauvegarde' });
      }
    } catch (error) {
      console.error('❌ Erreur:', error);
      setMessage({ type: 'error', text: `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}` });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFees = async () => {
    try {
      setLoading(true);
      const result = await adminService.updateSettingsFees({
        transaction_fee_percent: parseFloat(feeSettings.platformFee),
        minimum_transaction: parseFloat(feeSettings.minWithdrawal),
        maximum_transaction: parseFloat(feeSettings.maxWithdrawal),
        wave_fee_percent: parseFloat(feeSettings.paymentFee),
        orange_money_fee_percent: parseFloat(feeSettings.paymentFee) + 0.5,
        stripe_fee_percent: parseFloat(feeSettings.paymentFee),
      });
      
      if (result.success) {
        setMessage({ type: 'success', text: '✅ Paramètres de frais sauvegardés' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: '❌ Erreur lors de la sauvegarde' });
      }
    } catch (error) {
      console.error('❌ Erreur:', error);
      setMessage({ type: 'error', text: `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}` });
    } finally {
      setLoading(false);
    }
  };

  const handleSavePayment = async () => {
    try {
      setLoading(true);
      const result = await adminService.updateSettingsPayment({
        minimum_deposit: parseFloat(feeSettings.minWithdrawal),
        maximum_deposit: parseFloat(feeSettings.maxWithdrawal),
        minimum_withdrawal: parseFloat(feeSettings.minWithdrawal),
        maximum_withdrawal: parseFloat(feeSettings.maxWithdrawal),
        withdrawal_processing_time_hours: 24,
      });
      
      if (result.success) {
        setMessage({ type: 'success', text: '✅ Paramètres de paiement sauvegardés' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: '❌ Erreur lors de la sauvegarde' });
      }
    } catch (error) {
      console.error('❌ Erreur:', error);
      setMessage({ type: 'error', text: `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}` });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNotifications = async () => {
    try {
      setLoading(true);
      const result = await adminService.updateSettingsNotifications({
        notify_on_transaction: true,
        notify_on_deposit: true,
        notify_on_withdrawal: true,
        notify_on_gift: true,
        email_notifications_enabled: notificationSettings.emailNotifications,
        sms_notifications_enabled: notificationSettings.smsNotifications,
      });
      
      if (result.success) {
        setMessage({ type: 'success', text: '✅ Paramètres de notifications sauvegardés' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: '❌ Erreur lors de la sauvegarde' });
      }
    } catch (error) {
      console.error('❌ Erreur:', error);
      setMessage({ type: 'error', text: `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}` });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSecurity = async () => {
    try {
      setLoading(true);
      const result = await adminService.updateSettingsSecurity({
        require_2fa: securitySettings.twoFactorAuth,
        max_login_attempts: parseInt(securitySettings.maxLoginAttempts),
        lockout_duration_minutes: 30,
        session_timeout_minutes: parseInt(securitySettings.sessionTimeout) / 60,
        password_min_length: 8,
        maintenance_mode: false,
      });
      
      if (result.success) {
        setMessage({ type: 'success', text: '✅ Paramètres de sécurité sauvegardés' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: '❌ Erreur lors de la sauvegarde' });
      }
    } catch (error) {
      console.error('❌ Erreur:', error);
      setMessage({ type: 'error', text: `❌ Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* === TITRE === */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">⚙️ Paramètres</h1>
          <p className="text-gray-600 mt-1">Gérez les paramètres globaux de la plateforme</p>
        </div>

        {/* === MESSAGE ===*/}
        {message && (
          <div
            className={`p-4 rounded-lg border ${
              message.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* === TABS ===*/}
        <div className="border-b border-gray-200 flex gap-0">
          {[
            { id: 'general', label: '📋 Général', icon: '📋' },
            { id: 'fees', label: '💰 Frais', icon: '💰' },
            { id: 'payment', label: '💳 Paiement', icon: '💳' },
            { id: 'notifications', label: '🔔 Notifications', icon: '🔔' },
            { id: 'security', label: '🔒 Sécurité', icon: '🔒' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-3 border-b-2 font-medium text-sm transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* === ONGLET GÉNÉRAL ===*/}
        {activeTab === 'general' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Informations Générales</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l'application</label>
                <input
                  type="text"
                  value={generalSettings.appName}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, appName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={generalSettings.appDescription}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, appDescription: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email de support</label>
                <input
                  type="email"
                  value={generalSettings.supportEmail}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, supportEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
                <input
                  type="tel"
                  value={generalSettings.phone}
                  onChange={(e) => setGeneralSettings({ ...generalSettings, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="pt-4 border-t border-gray-200">
                <button
                  onClick={handleSaveGeneral}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {loading ? '⏳ Sauvegarde...' : '💾 Sauvegarder'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* === ONGLET FRAIS ===*/}
        {activeTab === 'fees' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Configuration des Frais et Commissions</h2>
              <p className="text-sm text-gray-600 mb-4">
                Définissez les pourcentages et montants de frais pour la plateforme
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Frais plateforme (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={feeSettings.platformFee}
                  onChange={(e) => setFeeSettings({ ...feeSettings, platformFee: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Prélevé sur chaque transaction</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Commission créateur (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={feeSettings.creatorCommission}
                  onChange={(e) => setFeeSettings({ ...feeSettings, creatorCommission: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Récompense créateur</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Frais paiement (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={feeSettings.paymentFee}
                  onChange={(e) => setFeeSettings({ ...feeSettings, paymentFee: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Frais gateway de paiement</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Frais retrait (FCFA)</label>
                <input
                  type="number"
                  value={feeSettings.withdrawalFee}
                  onChange={(e) => setFeeSettings({ ...feeSettings, withdrawalFee: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Montant fixe par retrait</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Retrait minimum (FCFA)</label>
                <input
                  type="number"
                  value={feeSettings.minWithdrawal}
                  onChange={(e) => setFeeSettings({ ...feeSettings, minWithdrawal: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Retrait maximum (FCFA)</label>
                <input
                  type="number"
                  value={feeSettings.maxWithdrawal}
                  onChange={(e) => setFeeSettings({ ...feeSettings, maxWithdrawal: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* === APERÇU DES FRAIS ===*/}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-3">📊 Aperçu sur une transaction de 100 000 FCFA</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-700">Montant initial</span>
                  <span className="font-medium">100 000 FCFA</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-700">- Frais plateforme ({feeSettings.platformFee}%)</span>
                  <span className="font-medium text-red-600">
                    -{new BigNumber(100000).multipliedBy(feeSettings.platformFee).dividedBy(100).toFormat(0)} FCFA
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-700">- Frais paiement ({feeSettings.paymentFee}%)</span>
                  <span className="font-medium text-red-600">
                    -{new BigNumber(100000).multipliedBy(feeSettings.paymentFee).dividedBy(100).toFormat(0)} FCFA
                  </span>
                </div>
                <div className="border-t border-blue-200 pt-2 flex justify-between">
                  <span className="font-semibold text-blue-900">Montant net pour créateur</span>
                  <span className="font-bold text-blue-900">
                    {new BigNumber(100000)
                      .minus(new BigNumber(100000).multipliedBy(feeSettings.platformFee).dividedBy(100))
                      .minus(new BigNumber(100000).multipliedBy(feeSettings.paymentFee).dividedBy(100))
                      .toFormat(0)}{' '}
                    FCFA
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={handleSaveFees}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {loading ? '⏳ Sauvegarde...' : '💾 Sauvegarder'}
              </button>
            </div>
          </div>
        )}

        {/* === ONGLET PAIEMENT ===*/}
        {activeTab === 'payment' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Configuration Paiement</h2>
              <p className="text-sm text-gray-600 mb-4">Paramètres d'intégration Stripe et méthodes de paiement</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Clé publique Stripe</label>
                <input
                  type="password"
                  value={paymentSettings.stripePublicKey}
                  onChange={(e) => setPaymentSettings({ ...paymentSettings, stripePublicKey: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="pk_live_..."
                />
                <p className="text-xs text-gray-500 mt-1">Clé de publication Stripe (ne s'affiche pas pour la sécurité)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL Webhook Stripe</label>
                <input
                  type="text"
                  value={paymentSettings.stripeWebhookUrl}
                  onChange={(e) => setPaymentSettings({ ...paymentSettings, stripeWebhookUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Devises</label>
                <select
                  value={paymentSettings.currency}
                  onChange={(e) => setPaymentSettings({ ...paymentSettings, currency: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="XAF">XAF (Franc CFA)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Méthodes de paiement activées</label>
                <div className="space-y-2">
                  {['card', 'mobile_money', 'bank_transfer'].map((method) => (
                    <label key={method} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={paymentSettings.paymentMethods.includes(method)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setPaymentSettings({
                              ...paymentSettings,
                              paymentMethods: [...paymentSettings.paymentMethods, method],
                            });
                          } else {
                            setPaymentSettings({
                              ...paymentSettings,
                              paymentMethods: paymentSettings.paymentMethods.filter((m) => m !== method),
                            });
                          }
                        }}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="text-gray-700">
                        {method === 'card' && '💳 Carte bancaire'}
                        {method === 'mobile_money' && '📱 Mobile Money'}
                        {method === 'bank_transfer' && '🏦 Virement bancaire'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                ⚠️ <strong>Important:</strong> Les clés Stripe ne peuvent être modifiées que par un administrateur système.
                Contactez le support pour mettre à jour vos clés API.
              </p>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <button
                disabled={true}
                className="px-4 py-2 bg-gray-400 text-white rounded-lg cursor-not-allowed font-medium"
              >
                🔒 Non modifiable (Admin système uniquement)
              </button>
            </div>
          </div>
        )}

        {/* === ONGLET NOTIFICATIONS ===*/}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Paramètres de Notifications</h2>
            </div>

            <div className="space-y-4">
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationSettings.emailNotifications}
                  onChange={(e) =>
                    setNotificationSettings({ ...notificationSettings, emailNotifications: e.target.checked })
                  }
                  className="w-4 h-4 rounded"
                />
                <span className="text-gray-700 font-medium">📧 Notifications email</span>
              </label>

              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationSettings.smsNotifications}
                  onChange={(e) =>
                    setNotificationSettings({ ...notificationSettings, smsNotifications: e.target.checked })
                  }
                  className="w-4 h-4 rounded"
                />
                <span className="text-gray-700 font-medium">📱 Notifications SMS</span>
              </label>

              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationSettings.pushNotifications}
                  onChange={(e) =>
                    setNotificationSettings({ ...notificationSettings, pushNotifications: e.target.checked })
                  }
                  className="w-4 h-4 rounded"
                />
                <span className="text-gray-700 font-medium">🔔 Notifications push</span>
              </label>

              <div className="border-t border-gray-200 pt-4">
                <h3 className="font-medium text-gray-900 mb-4">Rapports automatiques</h3>

                <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={notificationSettings.dailyReport}
                    onChange={(e) =>
                      setNotificationSettings({ ...notificationSettings, dailyReport: e.target.checked })
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-gray-700 font-medium">📋 Rapport quotidien</span>
                </label>

                <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notificationSettings.weeklyReport}
                    onChange={(e) =>
                      setNotificationSettings({ ...notificationSettings, weeklyReport: e.target.checked })
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-gray-700 font-medium">📊 Rapport hebdomadaire</span>
                </label>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Seuil d'alerte (FCFA)</label>
                <input
                  type="number"
                  value={notificationSettings.alertThreshold}
                  onChange={(e) =>
                    setNotificationSettings({ ...notificationSettings, alertThreshold: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Déclenche une alerte au-delà de ce montant</p>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={handleSaveNotifications}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {loading ? '⏳ Sauvegarde...' : '💾 Sauvegarder'}
              </button>
            </div>
          </div>
        )}

        {/* === ONGLET SÉCURITÉ ===*/}
        {activeTab === 'security' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Paramètres de Sécurité</h2>
              <p className="text-sm text-gray-600 mb-4">Configurez les politiques de sécurité de la plateforme</p>
            </div>

            <div className="space-y-4">
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={securitySettings.twoFactorAuth}
                  onChange={(e) =>
                    setSecuritySettings({ ...securitySettings, twoFactorAuth: e.target.checked })
                  }
                  className="w-4 h-4 rounded"
                />
                <div>
                  <span className="text-gray-700 font-medium block">🔐 Authentification à deux facteurs obligatoire</span>
                  <span className="text-xs text-gray-500">Exiger 2FA pour tous les administrateurs</span>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={securitySettings.enableAuditLog}
                  onChange={(e) =>
                    setSecuritySettings({ ...securitySettings, enableAuditLog: e.target.checked })
                  }
                  className="w-4 h-4 rounded"
                />
                <div>
                  <span className="text-gray-700 font-medium block">📝 Journal d'audit</span>
                  <span className="text-xs text-gray-500">Enregistrer toutes les actions des administrateurs</span>
                </div>
              </label>

              <div className="border-t border-gray-200 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Tentatives de connexion max.</label>
                <input
                  type="number"
                  value={securitySettings.maxLoginAttempts}
                  onChange={(e) =>
                    setSecuritySettings({ ...securitySettings, maxLoginAttempts: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Nombre de tentatives avant blocage du compte</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Délai d'expiration session (secondes)</label>
                <input
                  type="number"
                  value={securitySettings.sessionTimeout}
                  onChange={(e) =>
                    setSecuritySettings({ ...securitySettings, sessionTimeout: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Déconnexion automatique après inactivité</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Changement de mot de passe requis tous les (jours)</label>
                <input
                  type="number"
                  value={securitySettings.requirePasswordChange}
                  onChange={(e) =>
                    setSecuritySettings({ ...securitySettings, requirePasswordChange: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Liste blanche IP (optionnel)</label>
                <textarea
                  value={securitySettings.ipWhitelist}
                  onChange={(e) =>
                    setSecuritySettings({ ...securitySettings, ipWhitelist: e.target.value })
                  }
                  rows={3}
                  placeholder="192.168.1.1&#10;10.0.0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">Une IP par ligne. Laisser vide pour désactiver.</p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                <strong>⚠️ Attention:</strong> Ces paramètres affectent la sécurité de toute la plateforme. Modifiez-les
                avec prudence.
              </p>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={handleSaveSecurity}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {loading ? '⏳ Sauvegarde...' : '💾 Sauvegarder'}
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

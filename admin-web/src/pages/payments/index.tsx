import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/Layout/AdminLayout';
import { adminService } from '../../services/admin';
import { PaymentTransaction } from '../../types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function Payments() {
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadPayments();
  }, []);

  const loadPayments = async () => {
    try {
      setLoading(true);
      const data = await adminService.getPaymentTransactions();
      setPayments(data);
    } catch (error) {
      console.error('Erreur chargement paiements:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredPayments = payments.filter(payment => {
    if (filter === 'all') return true;
    return payment.type === filter;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'deposit': return 'Dépôt';
      case 'withdrawal': return 'Retrait';
      case 'bom_purchase': return 'Achat Bom';
      case 'bom_withdrawal': return 'Retrait Bom';
      case 'transfer_sent': return 'Transfert envoyé';
      case 'transfer_received': return 'Transfert reçu';
      case 'royalties_received': return 'Royalties';
      case 'bonus_received': return 'Bonus';
      default: return type;
    }
  };

  // CORRECTION : Formater les montants Decimal (string) avec séparateurs
  const formatAmount = (amountString: string) => {
    try {
      // Convertir string Decimal en nombre pour formatting
      const amount = parseFloat(amountString);
      return amount.toLocaleString('fr-FR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
      });
    } catch (error) {
      return amountString;
    }
  };

  // CORRECTION : Calculer les frais totaux avec Decimal
  const calculateTotalFees = () => {
    return payments.reduce((sum, p) => {
      try {
        return sum + parseFloat(p.fees || '0');
      } catch (error) {
        return sum;
      }
    }, 0);
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Chargement des paiements...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Paiements</h1>
            <p className="text-gray-600 mt-1">Transactions financières de la plateforme</p>
          </div>
          <button onClick={loadPayments} className="btn-primary">
            Actualiser
          </button>
        </div>

        {/* Filtres */}
        <div className="flex flex-wrap gap-2">
          {['all', 'deposit', 'withdrawal', 'bom_purchase', 'bom_withdrawal', 'transfer_sent', 'transfer_received'].map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-4 py-2 rounded-lg transition-colors text-sm ${
                filter === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {type === 'all' ? 'Tous' : getTypeLabel(type)}
            </button>
          ))}
        </div>

        {/* Tableau */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Montant
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Frais
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Net
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Statut
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {payment.id.slice(0, 12)}...
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">
                        {getTypeLabel(payment.type)}
                      </span>
                    </td>
                    {/* CORRECTION : formatAmount pour Decimal string */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatAmount(payment.amount)} FCFA
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatAmount(payment.fees)} FCFA
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      {formatAmount(payment.net_amount)} FCFA
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(payment.status)}`}>
                        {payment.status === 'completed' ? 'Complété' : 
                         payment.status === 'pending' ? 'En attente' : 
                         payment.status === 'failed' ? 'Échoué' : payment.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {format(new Date(payment.created_at), 'dd/MM/yyyy HH:mm', { locale: fr })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredPayments.length === 0 && (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-2">Aucun paiement trouvé</div>
            </div>
          )}
        </div>

        {/* Statistiques - CORRECTION : Utilisation de formatAmount pour les totaux */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="text-sm text-gray-500 mb-2">Total Paiements</div>
            <div className="text-2xl font-bold text-gray-900">{payments.length}</div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="text-sm text-gray-500 mb-2">Dépôts</div>
            <div className="text-2xl font-bold text-blue-600">
              {payments.filter(p => p.type === 'deposit').length}
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="text-sm text-gray-500 mb-2">Retraits</div>
            <div className="text-2xl font-bold text-purple-600">
              {payments.filter(p => p.type === 'withdrawal').length}
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="text-sm text-gray-500 mb-2">Frais Totaux</div>
            <div className="text-2xl font-bold text-orange-600">
              {formatAmount(calculateTotalFees().toString())} FCFA
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
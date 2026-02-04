import React from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  TrendingUp, 
  TrendingDown, 
  CreditCard, 
  Gift, 
  Wallet,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

export interface TreasuryTransaction {
  id: number;
  user_id: number;
  user_phone?: string;
  user_full_name?: string;
  amount: string | number;  // CORRIGÉ: Accepte string pour précision Decimal
  transaction_type: string;
  description: string;
  created_at: string;
}

interface TreasuryTableProps {
  transactions: TreasuryTransaction[];
  loading?: boolean;
}

// Fonction utilitaire pour formater les montants (support string/number)
const formatTreasuryAmount = (amount: string | number): string => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0.00';
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(num);
};

const getTransactionIcon = (type: string) => {
  if (type.includes('purchase')) return <CreditCard className="h-4 w-4 text-blue-500" />;
  if (type.includes('fee')) return <Wallet className="h-4 w-4 text-green-500" />;
  if (type.includes('commission')) return <TrendingUp className="h-4 w-4 text-purple-500" />;
  if (type.includes('redistribution')) return <Gift className="h-4 w-4 text-pink-500" />;
  return <Wallet className="h-4 w-4 text-gray-500" />;
};

const getTransactionColor = (amount: string | number) => {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return num > 0 ? 'text-green-600' : 'text-red-600';
};

const getTransactionTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    'boom_purchase': 'Achat Boom',
    'boom_sell': 'Vente Boom',
    'deposit_fee': 'Frais dépôt',
    'withdrawal_fee': 'Frais retrait',
    'treasury_deposit': 'Dépôt admin',
    'treasury_withdrawal': 'Retrait admin',
    'platform_royalties_payout': 'Redistribution royalties',
    'platform_bonus_payout': 'Redistribution bonus'
  };
  
  return labels[type] || type.replace(/_/g, ' ');
};

export default function TreasuryTable({ transactions, loading = false }: TreasuryTableProps) {
  if (loading) {
    return (
      <div className="card">
        <div className="p-6">
          <div className="text-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-gray-600">Chargement des transactions...</p>
          </div>
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="card">
        <div className="p-6">
          <div className="text-center py-10">
            <Wallet className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune transaction</h3>
            <p className="text-gray-500">Les transactions de la caisse apparaîtront ici</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">Transactions de la Caisse</h2>
        <p className="text-sm text-gray-600">{transactions.length} transactions</p>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Transaction
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Utilisateur
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Montant
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Date
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {transactions.map((transaction) => {
              const amountNum = typeof transaction.amount === 'string' 
                ? parseFloat(transaction.amount) 
                : transaction.amount;
              
              return (
                <tr key={transaction.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        {getTransactionIcon(transaction.transaction_type)}
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">
                          {getTransactionTypeLabel(transaction.transaction_type)}
                        </div>
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {transaction.description}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {transaction.user_full_name || `User ${transaction.user_id}`}
                    </div>
                    {transaction.user_phone && (
                      <div className="text-sm text-gray-500">{transaction.user_phone}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {amountNum > 0 ? (
                        <ArrowUpRight className="h-4 w-4 text-green-500 mr-1" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4 text-red-500 mr-1" />
                      )}
                      <span className={`font-medium ${getTransactionColor(transaction.amount)}`}>
                        {amountNum > 0 ? '+' : ''}{formatTreasuryAmount(transaction.amount)} FCFA
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {amountNum > 0 ? 'Crédit' : 'Débit'} caisse
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(transaction.created_at), 'dd MMM yyyy HH:mm', { locale: fr })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
        <div className="text-sm text-gray-600">
          Total des transactions : {transactions.length}
        </div>
      </div>
    </div>
  );
}
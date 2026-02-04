import React from 'react';
import DataTable from '../UI/DataTable';
import { UserFunds } from '@/types';

interface UserFundsTableProps {
  data: UserFunds[];
  loading?: boolean;
  onRedistribute?: (user: UserFunds) => void;
}

export default function UserFundsTable({ data, loading = false, onRedistribute }: UserFundsTableProps) {
  const columns = [
    {
      key: 'full_name',
      header: 'Utilisateur',
      render: (_: any, row: UserFunds) => (
        <div>
          <p className="font-medium">{row.full_name || `Utilisateur ${row.user_id}`}</p>
          <p className="text-sm text-gray-500">{row.phone}</p>
        </div>
      ),
    },
    {
      key: 'cash_balance',
      header: 'Solde calculé',
      render: (value: number) => (
        <span className="font-semibold">{value.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} FCFA</span>
      ),
    },
    {
      key: 'wallet_balance',
      header: 'Wallet stocké',
      render: (value: number, row: UserFunds) => (
        <div>
          <span className="text-blue-600 font-medium">
            {value.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} FCFA
          </span>
          {typeof row.wallet_balance_stored === 'number' && (
            <p className="text-xs text-gray-500">
              DB: {row.wallet_balance_stored.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'discrepancy_amount',
      header: 'Écart',
      render: (value: number | undefined, row: UserFunds) =>
        value && row.has_discrepancy ? (
          <span className="text-red-600 font-semibold">{value.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} FCFA</span>
        ) : (
          <span className="text-green-600 text-sm font-medium">OK</span>
        ),
    },
    {
      key: 'pending_withdrawals',
      header: 'Retraits en attente',
      render: (value: number) => value > 0 ? (
        <span className="text-orange-600 font-medium">{value.toLocaleString()} FCFA</span>
      ) : <span className="text-gray-400">-</span>,
    },
    {
      key: 'total_commissions_earned',
      header: 'Commissions',
      render: (value: number) => (
        <span className="text-green-600 font-bold">{value.toLocaleString()} FCFA</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (_: any, row: UserFunds) => (
        <button
          onClick={() => onRedistribute?.(row)}
          className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all shadow-sm"
          disabled={!onRedistribute}
        >
          Redistribuer
        </button>
      ),
    },
  ];

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">Fonds des Utilisateurs</h2>
        <span className="text-sm text-gray-500">
          Total: {data.length} utilisateur{data.length > 1 ? 's' : ''}
        </span>
      </div>
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Aucun utilisateur avec fonds"
      />
    </div>
  );
}
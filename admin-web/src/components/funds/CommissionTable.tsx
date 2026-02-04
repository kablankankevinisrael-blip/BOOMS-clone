import React from 'react';
import DataTable from '../UI/DataTable';
import { Commission } from '@/types';

interface CommissionTableProps {
  data: Commission[];
  loading?: boolean;
}

export default function CommissionTable({ data, loading = false }: CommissionTableProps) {
  const columns = [
    {
      key: 'id',
      header: 'ID',
    },
    {
      key: 'type',
      header: 'Type',
      render: (value: string) => {
        const typeColors: Record<string, string> = {
          deposit: 'bg-green-100 text-green-800',
          withdrawal: 'bg-red-100 text-red-800',
          royalty: 'bg-purple-100 text-purple-800',
          market: 'bg-blue-100 text-blue-800',
          boom_purchase: 'bg-yellow-100 text-yellow-800',
          boom_sell: 'bg-indigo-100 text-indigo-800'
        };
        
        return (
          <span className={`px-2 py-1 text-xs rounded-full ${typeColors[value] || 'bg-gray-100 text-gray-800'}`}>
            {value.toUpperCase()}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: 'Montant',
      render: (value: number) => (
        <span className="font-semibold text-green-600">+{value.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} FCFA</span>
      ),
    },
    {
      key: 'user_id',
      header: 'Utilisateur ID',
    },
    {
      key: 'bom_id',
      header: 'NFT ID',
      render: (value: number | undefined) => value ? value : '-',
    },
    {
      key: 'description',
      header: 'Description',
    },
    {
      key: 'created_at',
      header: 'Date',
      render: (value: string) => new Date(value).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
    },
  ];

  return (
    <div className="card p-6">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Commissions & Frais Récoltés</h2>
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyMessage="Aucune commission enregistrée"
      />
    </div>
  );
}
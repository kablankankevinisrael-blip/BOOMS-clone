import React from 'react';
import { Users, Image, TrendingUp, DollarSign } from 'lucide-react';

interface StatsCardsProps {
  stats: {
    total_users: number;
    total_boms: number;
    active_boms: number;
    total_platform_value: number;
  };
}

export default function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    {
      title: 'Utilisateurs',
      value: stats.total_users,
      icon: Users,
      color: 'blue',
      change: '+12%',
    },
    {
      title: 'Boms Total',
      value: stats.total_boms,
      icon: Image,
      color: 'green',
      change: '+8%',
    },
    {
      title: 'Boms Actifs',
      value: stats.active_boms,
      icon: TrendingUp,
      color: 'purple',
      change: '+5%',
    },
    {
      title: 'Valeur Plateforme',
      value: `${stats.total_platform_value.toLocaleString()} FCFA`,
      icon: DollarSign,
      color: 'orange',
      change: '+15%',
    },
  ];

  const getColorClasses = (color: string) => {
    const colors: any = {
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      purple: 'bg-purple-500',
      orange: 'bg-orange-500',
    };
    return colors[color] || 'bg-gray-500';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.title} className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">
                  {card.title}
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {card.value}
                </p>
                <p className="text-xs text-green-600 font-medium mt-1">
                  {card.change} ce mois
                </p>
              </div>
              <div className={`p-3 rounded-lg ${getColorClasses(card.color)}`}>
                <Icon size={24} className="text-white" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
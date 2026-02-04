import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { 
  BarChart3, 
  Users, 
  Image, 
  Gift, 
  CreditCard,
  Wallet,   
  Settings,
  DollarSign,
  Headphones,
  LogOut
} from 'lucide-react';

interface SidebarProps {
  user: any;
  onLogout: () => void;
}

const menuItems = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: BarChart3,
  },
  {
    name: 'Utilisateurs',
    href: '/users',
    icon: Users,
  },
  {
    name: 'Support',
    href: '/support',
    icon: Headphones,
  },
  {
    name: 'Boms',
    href: '/boms',
    icon: Image,
  },
  {
    name: 'Transactions',
    href: '/transactions',
    icon: CreditCard,
  },
  {
    name: 'Cadeaux',
    href: '/gifts',
    icon: Gift,
  },
  {
    name: 'Caisse Plateforme',
    href: '/treasury',
    icon: Wallet,
  },
  {
    name: 'Frais & Fonds',
    href: '/funds',
    icon: DollarSign,
  },
  {
    name: 'Analytiques',
    href: '/analytics',
    icon: Settings,
  },
];

export default function Sidebar({ user, onLogout }: SidebarProps) {
  const router = useRouter();

  return (
    <div className="w-64 bg-white shadow-lg border-r border-gray-200 flex flex-col h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">👑</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Booms</h1>
            <p className="text-sm text-gray-500">Admin Dashboard</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-2">
            Navigation
          </h3>
          <ul className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = 
                router.pathname === item.href || 
                router.pathname.startsWith(`${item.href}/[id]`) ||
                router.pathname.startsWith(`${item.href}/`);
              
              return (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 border-l-4 border-blue-600'
                        : 'text-gray-700 hover:bg-gray-100 hover:border-l-4 hover:border-gray-300'
                    }`}
                  >
                    <Icon size={20} className={isActive ? "text-blue-600" : "text-gray-500"} />
                    <span className="font-medium">{item.name}</span>
                    {isActive && (
                      <span className="ml-auto w-2 h-2 bg-blue-600 rounded-full"></span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Section Admin */}
        <div className="mt-8">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-2">
            Administration
          </h3>
          <ul className="space-y-1">
            <li>
              <Link
                href="/settings"
                className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-colors ${
                  router.pathname === '/settings'
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Settings size={20} />
                <span className="font-medium">Paramètres</span>
              </Link>
            </li>
          </ul>
        </div>
      </nav>

      {/* User info and logout */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex items-center space-x-3 mb-4 p-3 bg-white rounded-lg shadow-sm">
          <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-md">
            <span className="text-white font-bold">
              {user?.full_name?.charAt(0) || 'A'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {user?.full_name || 'Administrateur'}
            </p>
            <p className="text-xs text-gray-500 truncate">{user?.phone || 'Admin'}</p>
            <div className="flex items-center mt-1">
              <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                {user?.is_admin ? 'Administrateur' : 'Modérateur'}
              </span>
            </div>
          </div>
        </div>
        
        <button
          onClick={onLogout}
          className="flex items-center justify-center space-x-2 w-full px-4 py-2.5 text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
        >
          <LogOut size={18} />
          <span className="font-medium">Déconnexion</span>
        </button>

        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            Version 1.0.0 • {new Date().getFullYear()} Booms
          </p>
        </div>
      </div>
    </div>
  );
}
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Sidebar from './Sidebar';
import AuthService from '../../services/auth';
import Link from 'next/link';

interface AdminLayoutProps {
  children: React.ReactNode;
}

// Fonction pour obtenir le titre de la page actuelle
const getPageTitle = (pathname: string): string => {
  if (pathname === '/dashboard') return 'Dashboard';
  if (pathname === '/boms') return 'NFTs';
  if (pathname === '/boms/create') return 'Créer un NFT';
  if (pathname.includes('/boms/[id]')) return 'Modifier NFT';
  if (pathname === '/users') return 'Utilisateurs';
  if (pathname === '/support') return 'Support';
  if (pathname === '/transactions') return 'Transactions';
  if (pathname === '/gifts') return 'Cadeaux';
  if (pathname === '/analytics') return 'Analytiques';
  return 'Administration';
};

// Fonction pour obtenir les breadcrumbs (fil d'Ariane)
const getBreadcrumbs = (pathname: string): Array<{ name: string; href: string }> => {
  const breadcrumbs: Array<{ name: string; href: string }> = [];
  
  // Page d'accueil
  breadcrumbs.push({ name: 'Admin', href: '/dashboard' });
  
  // Pages spécifiques
  if (pathname === '/dashboard') {
    return breadcrumbs;
  }
  
  if (pathname.startsWith('/boms')) {
    breadcrumbs.push({ name: 'NFTs', href: '/boms' });
    
    if (pathname === '/boms/create') {
      breadcrumbs.push({ name: 'Création', href: '/boms/create' });
    } else if (pathname.includes('/boms/[id]')) {
      breadcrumbs.push({ name: 'Édition', href: pathname });
    }
  } 
  else if (pathname === '/users') {
    breadcrumbs.push({ name: 'Utilisateurs', href: '/users' });
  }
  else if (pathname === '/support') {
    breadcrumbs.push({ name: 'Support', href: '/support' });
  }
  else if (pathname === '/transactions') {
    breadcrumbs.push({ name: 'Transactions', href: '/transactions' });
  }
  else if (pathname === '/gifts') {
    breadcrumbs.push({ name: 'Cadeaux', href: '/gifts' });
  }
  else if (pathname === '/analytics') {
    breadcrumbs.push({ name: 'Analytiques', href: '/analytics' });
  }
  
  return breadcrumbs;
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      if (!AuthService.isAuthenticated()) {
        router.push('/login');
        return;
      }

      try {
        const userData = await AuthService.getCurrentUser();
        if (!userData.is_admin) {
          AuthService.logout();
          router.push('/login');
          return;
        }
        setUser(userData);
      } catch (error) {
        AuthService.logout();
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  const handleLogout = () => {
    AuthService.logout();
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Chargement...</p>
        </div>
      </div>
    );
  }

  const currentPageTitle = getPageTitle(router.pathname);
  const breadcrumbs = getBreadcrumbs(router.pathname);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar user={user} onLogout={handleLogout} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm border-b border-gray-200 z-10">
          <div className="px-6 py-4">
            {/* Breadcrumbs */}
            <div className="flex items-center space-x-2 text-sm text-gray-500 mb-2">
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={crumb.href}>
                  {index > 0 && (
                    <span className="text-gray-300 mx-2">/</span>
                  )}
                  <Link
                    href={crumb.href}
                    className={`transition-colors ${
                      index === breadcrumbs.length - 1
                        ? 'text-blue-600 font-medium'
                        : 'hover:text-blue-600'
                    }`}
                  >
                    {crumb.name}
                  </Link>
                </React.Fragment>
              ))}
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                {/* Indicateur visuel de page active */}
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-3 h-3 bg-blue-600 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium text-blue-700 bg-blue-50 px-3 py-1 rounded-full">
                    {currentPageTitle}
                  </span>
                </div>
                
                <h1 className="text-2xl font-bold text-gray-900">
                  Administration Booms
                </h1>
                <p className="text-gray-600 text-sm">
                  Panel de gestion de la plateforme
                </p>
              </div>
              
              {/* Informations utilisateur */}
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <p className="font-medium text-gray-900">{user?.full_name}</p>
                  <p className="text-sm text-gray-500">{user?.phone}</p>
                </div>
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">
                    {user?.full_name?.charAt(0) || 'A'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 bg-gray-50">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
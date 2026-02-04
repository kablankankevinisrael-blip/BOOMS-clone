import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import AuthService from '../services/auth';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const router = useRouter();

  useEffect(() => {
    console.group('🚀 [LOGIN USEEFFECT] Composant monté');
    
    // Vérifier si déjà connecté
    if (AuthService.isAuthenticated()) {
      console.log('🔐 Utilisateur déjà authentifié, vérification admin...');
      
      // Vérifier aussi si c'est un admin
      AuthService.verifyAdmin()
        .then(isAdmin => {
          if (isAdmin) {
            console.log('✅ Admin confirmé, redirection dashboard');
            router.push('/dashboard');
          } else {
            console.log('❌ Non admin, nettoyage session');
            AuthService.logout();
          }
        })
        .catch(() => {
          console.log('⚠️ Erreur vérification admin, nettoyage');
          AuthService.logout();
        });
    }
    
    console.groupEnd();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.group('📝 [LOGIN SUBMIT] Formulaire soumis');
    
    setLoading(true);
    setError('');
    
    console.log('📊 Données formulaire:');
    console.log('- Phone:', phone);
    console.log('- Password length:', password.length);

    try {
      console.log('🔐 Étape 1: Tentative de connexion...');
      
      // ESSAYER D'ABORD LA MÉTHODE FETCH (plus fiable)
      const loginData = await AuthService.loginWithFetch(phone, password);
      console.log('✅ Login réussi! Données:', loginData);
      
      // Petite pause pour s'assurer du stockage
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Vérification intermédiaire
      console.log('🔍 Vérification token stocké:');
      const token = AuthService.getToken();
      console.log('- Token présent:', !!token);
      console.log('- Token début:', token?.substring(0, 20) + '...');
      
      if (!token) {
        throw new Error('Token non stocké après connexion');
      }
      
      console.log('👑 Étape 2: Vérification admin...');
      const isAdmin = await AuthService.verifyAdmin();
      console.log('👑 Résultat vérification admin:', isAdmin);

      if (!isAdmin) {
        console.log('❌ Échec: Utilisateur non admin');
        AuthService.logout();
        setError('Accès administrateur requis. Contactez le support.');
        console.groupEnd();
        return;
      }

      console.log('🚀 Étape 3: Redirection vers dashboard');
      console.log('🔀 Redirection en cours...');
      
      // Redirection simple et directe
      window.location.href = '/dashboard';
      
    } catch (err: any) {
      console.error('💥 [LOGIN SUBMIT] ERREUR:');
      console.error('- Message:', err.message);
      console.error('- Full error:', err);
      
      // Messages d'erreur utilisateur-friendly
      let errorMessage = 'Erreur de connexion';
      
      if (err.message.includes('401') || err.message.includes('Unauthorized')) {
        errorMessage = 'Numéro de téléphone ou mot de passe incorrect';
      } else if (err.message.includes('Network')) {
        errorMessage = 'Impossible de joindre le serveur. Vérifiez votre connexion.';
      } else if (err.message.includes('404')) {
        errorMessage = 'Serveur indisponible. Réessayez plus tard.';
      } else if (err.response?.data?.detail) {
        errorMessage = err.response.data.detail;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      
      // Si debug mode activé, montrer plus de détails
      if (debugMode) {
        setError(`${errorMessage} (Détail: ${err.message})`);
      }
    } finally {
      console.log('🏁 Fin processus login');
      setLoading(false);
      console.groupEnd();
    }
  };

  const runDebugTests = async () => {
    console.group('🧪 [DEBUG TESTS]');
    setDebugMode(true);
    
    // Test 1: localStorage
    console.log('🧪 Test 1: localStorage analysis');
    const allKeys = Object.keys(localStorage);
    console.log('- Nombre d\'éléments:', allKeys.length);
    console.log('- Clés:', allKeys);
    console.log('- admin_token:', localStorage.getItem('admin_token')?.substring(0, 30) + '...');
    
    // Test 2: AuthService status
    console.log('🧪 Test 2: AuthService status');
    console.log('- isAuthenticated():', AuthService.isAuthenticated());
    console.log('- getToken() début:', AuthService.getToken()?.substring(0, 20) + '...');
    
    // Test 3: Test API direct
    console.log('🧪 Test 3: Test API direct avec fetch');
    try {
      const testUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1'}/auth/login`;
      console.log('- URL testée:', testUrl);
      
      const testResponse = await fetch(testUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          phone: '0758647383', 
          password: 'admin123' 
        })
      });
      
      console.log('- Status:', testResponse.status);
      console.log('- OK?:', testResponse.ok);
      
      if (!testResponse.ok) {
        console.error('- Pas OK, text:', await testResponse.text());
      } else {
        const testData = await testResponse.json();
        console.log('- Data reçue:', testData);
        
        if (testData.access_token) {
          console.log('✅ Token reçu via fetch direct');
          localStorage.setItem('admin_token', testData.access_token);
          console.log('✅ Token stocké, redirection...');
          window.location.href = '/dashboard';
        }
      }
    } catch (error) {
      console.error('- Erreur test API:', error);
      console.error('- Détails:', error.message);
    }
    
    // Test 4: Test endpoint backend
    console.log('🧪 Test 4: Test endpoint backend');
    try {
      const baseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1').replace('/api/v1', '');
      const healthCheck = await fetch(`${baseUrl}/health`);
      console.log('- Health check status:', healthCheck.status);
      console.log('- Health check text:', await healthCheck.text());
    } catch (error) {
      console.error('- Backend inaccessible:', error.message);
    }
    
    console.groupEnd();
  };

  const handleQuickLogin = async () => {
    setPhone('0758647383');
    setPassword('admin123');
    
    // Auto-submit après 500ms
    setTimeout(() => {
      const form = document.querySelector('form');
      if (form) {
        const submitEvent = new Event('submit', { cancelable: true });
        form.dispatchEvent(submitEvent);
      }
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-white font-bold">👑</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Administration Booms
          </h1>
          <p className="text-gray-600">
            Connexion administrateur
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className={`px-4 py-3 rounded-lg text-sm ${debugMode ? 'bg-red-100 border border-red-300 text-red-800' : 'bg-red-50 border border-red-200 text-red-600'}`}>
              <strong>{debugMode ? '🔧 [DEBUG] ' : '❌ '}Erreur:</strong> {error}
            </div>
          )}

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
              Numéro de téléphone
            </label>
            <input
              id="phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              placeholder="0758647383"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              placeholder="••••••••"
            />
          </div>

          <div className="space-y-3">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4 rounded-lg font-semibold hover:from-blue-700 hover:to-purple-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="w-5 h-5 border-t-2 border-white border-solid rounded-full animate-spin mr-2"></div>
                  Connexion...
                </div>
              ) : (
                'Se connecter'
              )}
            </button>

            <button
              type="button"
              onClick={handleQuickLogin}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-2 px-4 rounded-lg font-medium hover:from-green-600 hover:to-emerald-700 transition-all text-sm"
            >
              🔐 Connexion rapide (admin)
            </button>
          </div>
        </form>

        {/* PANEL DEBUG */}
        <div className="mt-6 p-4 bg-gray-100 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <p className="text-sm font-medium text-gray-700">🧪 Debug Panel</p>
            <span className={`text-xs px-2 py-1 rounded ${debugMode ? 'bg-red-100 text-red-800' : 'bg-gray-200 text-gray-700'}`}>
              {debugMode ? 'DEBUG ACTIVÉ' : 'debug'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={runDebugTests}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded"
            >
              Tests Complets
            </button>
            <button
              onClick={() => {
                localStorage.clear();
                console.log('🧹 localStorage nettoyé');
                window.location.reload();
              }}
              className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded"
            >
              Nettoyer tout
            </button>
            <button
              onClick={() => {
                console.log('📊 État AuthService:');
                console.log('- Token:', AuthService.getToken());
                console.log('- Authentifié:', AuthService.isAuthenticated());
                alert('Voir la console pour les détails');
              }}
              className="text-xs bg-gray-500 hover:bg-gray-600 text-white px-2 py-1 rounded"
            >
              État Auth
            </button>
            <button
              onClick={() => setDebugMode(!debugMode)}
              className={`text-xs px-2 py-1 rounded ${debugMode ? 'bg-purple-500 hover:bg-purple-600' : 'bg-gray-300 hover:bg-gray-400'} text-white`}
            >
              {debugMode ? 'Désactiver Debug' : 'Activer Debug'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
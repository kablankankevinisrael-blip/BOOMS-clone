import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
} from '@expo-google-fonts/space-grotesk';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { NotificationProvider } from './src/contexts/NotificationContext';
import { WalletProvider } from './src/contexts/WalletContext';
import { boomsWebSocket } from './src/services/websocket';
import { useAuthSync } from './src/hooks/useAuthSync'; // <-- NOUVEAU IMPORT
import AccountStateGate from './src/components/AccountStateGate';
import { gradients, palette, fonts } from './src/styles/theme';
import AppNavigator from './src/navigation/AppNavigator';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Hook personnalisé pour gérer le WebSocket avec l'authentification
const useWebSocketManager = () => {
  const { user, token, isAuthenticated } = useAuth();
  
  useEffect(() => {
    console.log('🔌 [WS-MANAGER] État:', {
      isAuthenticated,
      hasToken: !!token,
      hasUser: !!user,
      isConnected: boomsWebSocket.isConnectedStatus(),
      isAuthWS: boomsWebSocket.isAuthenticatedStatus()
    });
    
    if (isAuthenticated && token && user) {
      console.log('👤 [WS-MANAGER] Utilisateur authentifié:', user.id);
      
      const timeoutId = setTimeout(() => {
        const state = boomsWebSocket.getConnectionState();
        
        if (state.isConnected && state.isAuthenticated) {
          console.log('✅ [WS-MANAGER] Déjà connecté et authentifié');
        } else if (state.isConnected && !state.isAuthenticated) {
          console.log('🔄 [WS-MANAGER] Rafraîchissement connexion...');
          boomsWebSocket.refreshConnection();
        }
      }, 1500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isAuthenticated, token, user?.id]);
  
  return boomsWebSocket;
};

// Composant wrapper pour gérer le WebSocket
const WebSocketWrapper = ({ children }: { children: React.ReactNode }) => {
  useWebSocketManager();
  return <>{children}</>;
};

// Hook de monitoring discret (uniquement logs console)
const useWebSocketMonitor = () => {
  useEffect(() => {
    console.log('📡 [MONITOR] Initialisation monitoring...');
    
    // Monitoring léger toutes les 60 secondes
    const intervalId = setInterval(() => {
      if (boomsWebSocket.isConnectedStatus()) {
        const stats = boomsWebSocket.getLiveStats();
        console.log('📊 [MONITOR] Stats:', {
          uptime: stats.uptimeSeconds + 's',
          updates: stats.totalUpdates,
          booms: stats.subscribedBooms,
          type: stats.connectionType,
          auth: stats.authenticated
        });
      }
    }, 60000); // Seulement toutes les minutes
    
    // Cleanup
    return () => {
      clearInterval(intervalId);
    };
  }, []);
};

// Écran de chargement
function LoadingScreen({ onLoad }: { onLoad: () => void }) {
  useEffect(() => {
    console.log('🎁 BOOMS - Application en cours de chargement...');
    
    setTimeout(() => {
      console.log('✅ BOOMS - Chargement terminé');
      onLoad();
    }, 2000);
  }, []);
  return (
    <LinearGradient colors={gradients.hero} style={styles.loadingContainer}>
      <View style={styles.loadingBadge}>
        <Text style={styles.loadingMonogram}>BO</Text>
      </View>
      <Text style={styles.loadingTitle}>Booms Treasury</Text>
      <Text style={styles.loadingText}>Préparation de votre portefeuille</Text>
      <TouchableOpacity
        style={styles.debugButton}
        onPress={() => onLoad()}
      >
        <Text style={styles.debugButtonText}>Ignorer la transition</Text>
      </TouchableOpacity>
    </LinearGradient>
  );
}

// Composant principal de l'application
function MainApp() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [webSocketInitiated, setWebSocketInitiated] = useState(false);

  // Utiliser les hooks de monitoring
  useWebSocketMonitor();
  useAuthSync(); // <-- AJOUT ICI À LA PLACE DE SyncManager

  useEffect(() => {
    if (authLoading) {
      console.log('⏳ [APP] En attente auth...');
      return;
    }
    
    if (webSocketInitiated) return;
    
    console.log('🚀 [APP] Initialisation...');
    setWebSocketInitiated(true);
    
    const initialState = boomsWebSocket.getConnectionState();
    console.log('🔍 [APP] État initial:', initialState);
    
    // Écouteur de statut discret
    const unsubscribeStatus = boomsWebSocket.onStatusChange((status) => {
      if (status === 'authenticated') {
        console.log('✅ [APP] Connexion sécurisée établie');
      } else if (status === 'connected') {
        console.log('✅ [APP] Connexion établie');
      }
    });
    
    // Écouteur de notifications importantes
    const unsubscribeMessages = boomsWebSocket.onMessage((message) => {
      if (message.type === 'balance_update') {
        console.log('💰 [APP] Mise à jour solde');
      }
      if (message.type === 'social_update') {
        const socialMsg = message as any;
        if (Math.abs(socialMsg.delta) > 0.0001) {
          console.log(`📈 [APP] Boom #${socialMsg.boom_id}: ${socialMsg.delta > 0 ? '+' : ''}${socialMsg.delta.toFixed(5)}`);
        }
      }
    });
    
    return () => {
      unsubscribeStatus();
      unsubscribeMessages();
    };
  }, [isAuthenticated, authLoading, webSocketInitiated]);

  if (authLoading) {
    return (
      <LinearGradient colors={gradients.hero} style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Vérification de l'authentification...</Text>
      </LinearGradient>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <AccountStateGate>
        <AppNavigator />
      </AccountStateGate>
    </>
  );
}

// Point d'entrée principal
export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  if (isLoading) {
    return <LoadingScreen onLoad={() => setIsLoading(false)} />;
  }

  return (
    <AuthProvider>
      <NotificationProvider>
        <WalletProvider>
          {/* SUPPRIMÉ: SyncManager */}
          <WebSocketWrapper>
            <MainApp />
          </WebSocketWrapper>
        </WalletProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingTitle: {
    fontSize: 32,
    color: palette.white,
    fontFamily: fonts.heading,
    marginBottom: 12,
  },
  loadingText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    fontFamily: fonts.body,
    marginBottom: 32,
    textAlign: 'center',
  },
  loadingBadge: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  loadingMonogram: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: palette.white,
    letterSpacing: 2,
  },
  debugButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  debugButtonText: {
    color: palette.white,
    fontFamily: fonts.bodyMedium,
  },
});
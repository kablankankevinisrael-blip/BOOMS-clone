// frontend/src/hooks/useAuthSync.ts
import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { boomsWebSocket } from '../services/websocket';

/**
 * Hook de synchronisation critique Auth ↔ WebSocket
 * Vérifie périodiquement la cohérence
 */
export const useAuthSync = () => {
  const { isAuthenticated, user, token } = useAuth();
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncCheckRef = useRef<number>(0);
  const lastAuthChangeRef = useRef<number>(0);

  useEffect(() => {
    lastAuthChangeRef.current = Date.now();
  }, [isAuthenticated, user?.id, token]);

  useEffect(() => {
    const performSyncCheck = () => {
      const now = Date.now();
      // Ne pas vérifier trop souvent
      if (now - lastSyncCheckRef.current < 3000) {
        return;
      }
      lastSyncCheckRef.current = now;

      const authUserId = user?.id;
      const wsUserId = boomsWebSocket.getCurrentUserId();
      const wsState = boomsWebSocket.getConnectionState();

      console.log('🔄 [SYNC] Vérification:', {
        authUser: authUserId,
        wsUser: wsUserId,
        wsConnected: wsState.isConnected,
        wsAuthenticated: wsState.isAuthenticated
      });

      // 🚨 SCÉNARIO CRITIQUE : Auth dit un user, WebSocket dit un autre
      if (isAuthenticated && authUserId && 
          wsState.isConnected && wsUserId && 
          authUserId !== wsUserId) {
        
        console.warn(`⚠️ [SYNC] User mismatch: Auth=${authUserId}, WS=${wsUserId}`);
        
        // Vérifier si c'est un mismatch significatif
        const mismatchGap = Math.abs(authUserId - wsUserId);
        
        if (mismatchGap > 1) {
          console.error(`🚨 [SYNC] DÉSYNCHRONISATION CRITIQUE! Différence: ${mismatchGap}`);
          
          // Forcer la reconnexion seulement si la différence est grande
          boomsWebSocket.resetForNewUser();
          
          // Planifier reconnexion
          setTimeout(() => {
            console.log(`🔄 [SYNC] Reconnexion forcée pour user ${authUserId}`);
            // AuthContext gérera la reconnexion via refreshAuth
          }, 2000);
        } else {
          console.log(`ℹ️ [SYNC] Mismatch mineur (${mismatchGap}) - accepté`);
        }
      }

      // 🚨 SCÉNARIO : WebSocket connecté sans auth
      const hasAuthIdentity = Boolean(user?.id || token);
      const authGraceElapsed = Date.now() - lastAuthChangeRef.current > 8000;
      if (!isAuthenticated && wsState.isConnected && !hasAuthIdentity && authGraceElapsed) {
        console.error('🚨 [SYNC] WebSocket connecté sans auth!');
        boomsWebSocket.resetForNewUser();
      } else if (!isAuthenticated && wsState.isConnected && hasAuthIdentity) {
        console.warn('⚠️ [SYNC] WebSocket connecté avec identité partielle (transitoire)');
      }

      // 🚨 SCÉNARIO : Auth valide mais WebSocket pas connecté
      if (isAuthenticated && authUserId && !wsState.isConnected && !wsState.isConnecting) {
        console.log('⚠️ [SYNC] Auth valide mais WS déconnecté');
        // La reconnexion sera gérée par AuthContext
      }
    };

    // Démarrer la vérification périodique
    syncIntervalRef.current = setInterval(performSyncCheck, 5000); // Toutes les 5s
    
    // Première vérification immédiate
    setTimeout(performSyncCheck, 2000);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [isAuthenticated, user?.id, token]); // Dépendances critiques

  return null;
};
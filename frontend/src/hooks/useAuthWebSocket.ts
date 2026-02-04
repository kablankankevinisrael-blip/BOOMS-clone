// frontend/src/hooks/useAuthWebSocket.ts
import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { boomsWebSocket } from '../services/websocket';

/**
 * ANCIEN HOOK - DÉSACTIVÉ car la logique WebSocket est gérée par AuthContext
 * Gardé pour compatibilité mais ne fait rien d'actif
 * @deprecated Utilisez directement boomsWebSocket ou laissez AuthContext gérer
 */
export const useAuthWebSocket = () => {
  const { isAuthenticated, token, user } = useAuth();
  const initializedRef = useRef(false);

  useEffect(() => {
    console.log(`ℹ️ [AUTH-WS] Hook désactivé (WebSocket géré par AuthContext)`);
    console.log(`ℹ️ [AUTH-WS] État: auth=${isAuthenticated}, user=${user?.id}, token=${!!token}`);

    // ⚠️ NE RIEN FAIRE - La connexion WebSocket est gérée par AuthContext
    // Cette logique a été déplacée dans AuthContext pour éviter les conflits
    
    // Seulement logger pour debug
    if (isAuthenticated && user && token && !initializedRef.current) {
      console.log(`ℹ️ [AUTH-WS] AuthContext gère la connexion pour user ${user.id}`);
      initializedRef.current = true;
    }
    
    if (!isAuthenticated && initializedRef.current) {
      console.log('ℹ️ [AUTH-WS] Déconnexion détectée');
      initializedRef.current = false;
    }

  }, [isAuthenticated, user?.id, token]); // user.id est CRITIQUE

  // Retourne toujours l'instance WebSocket pour compatibilité
  return boomsWebSocket;
};
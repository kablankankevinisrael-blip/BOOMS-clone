// frontend/src/utils/authCleanup.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { boomsWebSocket } from '../services/websocket';

/**
 * Nettoyage complet lors de la déconnexion
 */
export const performCompleteLogout = async (): Promise<void> => {
  try {
    console.log('🧹 [CLEANUP] Nettoyage COMPLET en cours...');
    
    // 1. Nettoyer AsyncStorage
    await AsyncStorage.multiRemove([
      'booms_token',
      'booms_user',
    ]);
    
    // 2. Nettoyer WebSocket COMPLÈTEMENT
    boomsWebSocket.disconnect();
    boomsWebSocket.resetForNewUser();
    
    // 3. Forcer un délai
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log('✅ [CLEANUP] Nettoyage TERMINÉ');
  } catch (error) {
    console.error('❌ [CLEANUP] Erreur:', error);
    // Forcer le reset malgré tout
    boomsWebSocket.resetForNewUser();
  }
};
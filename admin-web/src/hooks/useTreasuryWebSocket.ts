import { useEffect, useState, useCallback } from 'react';
import AuthService from '../services/auth';
import { toast } from 'react-toastify';

interface WebSocketMessage {
  type: 'treasury_update' | 'transaction_created' | 'balance_updated' | 'error';
  payload: any;
  timestamp: string;
}

export const useTreasuryWebSocket = (
  onTreasuryUpdate?: (data: any) => void,
  onTransactionCreated?: (data: any) => void
) => {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const connectWebSocket = useCallback(() => {
    const token = AuthService.getToken();
    if (!token) {
      console.warn('❌ Pas de token pour WebSocket');
      return null;
    }

    // ✅ Lecture depuis .env.local via NEXT_PUBLIC_API_WS_URL
    const API_WS_URL = process.env.NEXT_PUBLIC_API_WS_URL || 'ws://localhost:8000';
    const wsUrl = `${API_WS_URL}/ws/secure-updates?token=${token}`;
    
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('🔗 WebSocket Trésorerie connecté');
      setConnected(true);
      toast.info('Connexion temps-réel activée', { autoClose: 2000 });
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        setLastMessage(message);

        switch (message.type) {
          case 'treasury_update':
            console.log('📊 Mise à jour trésorerie reçue:', message.payload);
            onTreasuryUpdate?.(message.payload);
            toast.info(`💰 Balance mise à jour: ${message.payload.new_balance} FCFA`, {
              autoClose: 3000,
            });
            break;

          case 'transaction_created':
            console.log('💳 Transaction créée:', message.payload);
            onTransactionCreated?.(message.payload);
            break;

          case 'error':
            console.error('❌ Erreur WebSocket:', message.payload);
            toast.error(`Erreur: ${message.payload.error}`);
            break;

          default:
            console.log('📨 Message WS non traité:', message.type);
        }
      } catch (error) {
        console.error('❌ Erreur parsing WS:', error);
      }
    };

    ws.onclose = (event) => {
      console.log(`🔌 WebSocket fermé (code: ${event.code}, reason: ${event.reason})`);
      setConnected(false);
      
      // Reconnexion automatique après 5 secondes
      if (event.code !== 1000) { // 1000 = fermeture normale
        setTimeout(() => {
          console.log('🔄 Tentative de reconnexion WebSocket...');
          connectWebSocket();
        }, 5000);
      }
    };

    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      toast.error('Connexion temps-réel perdue');
      setConnected(false);
    };

    return ws;
  }, [onTreasuryUpdate, onTransactionCreated]);

  useEffect(() => {
    const ws = connectWebSocket();

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Composant démonté');
      }
    };
  }, [connectWebSocket]);

  return { connected, lastMessage };
};
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { boomsWebSocket } from '../services/websocket';
import { useAuth } from './AuthContext';
import api from '../services/api';

interface WalletContextType {
  cashBalance: number;
  virtualBalance: number;
  inventory: any[]; // ⚡ AJOUT: State inventory
  loading: boolean;
  
  usableBalance: number;
  
  refreshCashBalance: (force?: boolean) => Promise<void>;
  refreshVirtualBalance: () => Promise<void>;
  refreshAllBalances: () => Promise<void>;
  
  refreshAfterSell: () => Promise<void>;
  
  hasSufficientFunds: (amount: number) => boolean;
  requestBackendSync: (reason?: string) => Promise<void>;
  
  getBalanceBreakdown: () => {
    cash: number;
    virtual: number;
    locked?: number;
    total?: number;
  };

  // ⚡ NOUVELLES MÉTHODES POUR LES SERVICES
  applyBackendState: (backendState: CompleteBackendState) => void;
  refreshCompleteState: () => Promise<void>;
    applyRealtimeCashBalance: (cash: number, source?: string) => void;
}

// ⚡ NOUVEAU : Interface pour l'état complet backend
interface CompleteBackendState {
  cash: {
    real_balance: string; // ⚡ CORRECTION: string au lieu de number
    currency: string;
  };
  wallet: {
    virtual_balance: string; // ⚡ CORRECTION: string au lieu de number
    currency: string;
  };
  inventory: any[];
  inventory_count: number;
  server_timestamp: string;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [virtualBalance, setVirtualBalance] = useState<number>(0);
  const [inventory, setInventory] = useState<any[]>([]); // ⚡ AJOUT: State inventory
  const [loading, setLoading] = useState(true);
  
  // ⚡ SUPPRESSION des timestamps complexes
  // const [lastCashUpdateTs, setLastCashUpdateTs] = useState<number>(0);
  // const lastUpdateRef = useRef<number>(0);
  
  const boomsWebSocketRef = useRef(boomsWebSocket);
  const lastSyncRequestRef = useRef(0);

  const { user, isAuthenticated } = useAuth();

  const usableBalance = React.useMemo(() => {
    return cashBalance;
  }, [cashBalance]);

  /**
   * ⚡ MÉTHODE CRITIQUE : Seule fonction autorisée à écrire le state
   * Écrase TOUT l'état frontend avec la vérité backend
   */
  const applyBackendState = useCallback((backendState: CompleteBackendState) => {
    console.log('[WALLET] 🔄 Application état backend (écrasement total)');
    
    // ⚡ ÉCRASEMENT, PAS DE FUSION
    setCashBalance(parseFloat(backendState.cash.real_balance) || 0); // ⚡ CORRECTION: parseFloat
    setVirtualBalance(parseFloat(backendState.wallet.virtual_balance) || 0); // ⚡ CORRECTION: parseFloat
    
    // ⚡ CRITIQUE: Mise à jour de l'inventaire
    if (Array.isArray(backendState.inventory)) {
      setInventory(backendState.inventory);
      console.log('[WALLET] 📦 Inventaire mis à jour:', backendState.inventory.length, 'items');
    } else {
      console.warn('[WALLET] ❌ Inventaire invalide dans backendState');
      setInventory([]);
    }
    
    console.log('[WALLET] ✅ État backend appliqué:', {
      cash: backendState.cash.real_balance,
      virtual: backendState.wallet.virtual_balance,
      inventory_count: backendState.inventory_count,
      source: backendState.server_timestamp
    });
  }, []);

  /**
   * ⚡ MÉTHODE PRINCIPALE : Resynchronisation complète depuis backend
   * À appeler après chaque action financière
   */
  const refreshCompleteState = useCallback(async () => {
    if (!user || !isAuthenticated) {
      console.log('[WALLET] ❌ Resync impossible: utilisateur non connecté');
      return;
    }

    const requestId = Date.now();
    lastSyncRequestRef.current = requestId;
    setLoading(true);

    try {
      console.log(`[WALLET] 🔄 Resync backend (req ${requestId})`);

      // Appel direct API (ne pas passer par walletService)
      const response = await api.get('/users/complete-state'); // ⚡ CORRECTION: chemin correct
      const completeState = response.data;

      if (lastSyncRequestRef.current !== requestId) {
        console.log(`[WALLET] ⏭️ Sync ${requestId} ignorée (une requête plus récente est active)`);
        return;
      }

      // ⚡ APPLICATION DE L'ÉTAT COMPLET
      applyBackendState(completeState);

      console.log(`[WALLET] ✅ Resynchronisation ${requestId} appliquée`);
    } catch (error) {
      if (lastSyncRequestRef.current === requestId) {
        console.error('[WALLET] ❌ Erreur resynchronisation:', error);
      } else {
        console.warn('[WALLET] ⚠️ Erreur sur une resync obsolète, ignorée');
      }
    } finally {
      if (lastSyncRequestRef.current === requestId) {
        setLoading(false);
      } else {
        console.log(`[WALLET] 💤 Sync ${requestId} terminée (état déjà mis à jour)`);
      }
    }
  }, [user, isAuthenticated, applyBackendState]);
  
  const applyRealtimeCashBalance = useCallback((cash: number, source: string = 'manual-snapshot') => {
    if (typeof cash !== 'number' || Number.isNaN(cash)) {
      console.warn('[WALLET] ❌ Snapshot cash invalide:', cash, source);
      return;
    }
  
    setCashBalance(prev => {
      if (prev === cash) {
        console.log('[WALLET] ⚠️ Snapshot cash ignoré (identique):', cash, source);
        return prev;
      }
      console.log('[WALLET] 💡 Snapshot cash appliqué:', { cash, source });
      return cash;
    });
  }, []);

  /**
   * ⚡ Compatibilité : garder l'ancienne méthode pour les composants existants
   * Mais elle appelle simplement refreshCompleteState
   */
  const refreshCashBalance = useCallback(async (force: boolean = false) => {
    console.log('[WALLET] ⚠️ refreshCashBalance (déprécié) -> refreshCompleteState');
    await refreshCompleteState();
  }, [refreshCompleteState]);

  const refreshVirtualBalance = useCallback(async () => {
    console.log('[WALLET] ⚠️ refreshVirtualBalance (déprécié) -> refreshCompleteState');
    await refreshCompleteState();
  }, [refreshCompleteState]);

  const refreshAfterSell = useCallback(async () => {
    console.log('[WALLET] 🔄 refreshAfterSell -> refreshCompleteState');
    await refreshCompleteState();
  }, [refreshCompleteState]);

  const refreshAllBalances = useCallback(async () => {
    console.log('[WALLET] 🔄 refreshAllBalances -> refreshCompleteState');
    await refreshCompleteState();
  }, [refreshCompleteState]);

  const requestBackendSync = useCallback(async (reason: string = 'manual-trigger') => {
    try {
      const wsState = boomsWebSocketRef.current?.getConnectionState?.();
      const wsActive = wsState?.isConnected && wsState?.isAuthenticated;

      if (wsActive) {
        console.log(`[WALLET] ⏭️ Sync ignorée (${reason}) - WebSocket actif`);
        return;
      }

      console.log(`[WALLET] 🧮 Sync forcée (${reason}) - WebSocket inactif`);
      await refreshCompleteState();
    } catch (error) {
      console.warn(`[WALLET] ⚠️ État WebSocket inconnu (${reason}), resync forcée`, error);
      await refreshCompleteState();
    }
  }, [refreshCompleteState]);

  const hasSufficientFunds = useCallback((amount: number): boolean => {
    const hasFunds = cashBalance >= amount;
    
    // ✅ PATCH 1: Suppression des emojis pour éviter l'erreur de parsing
    console.log('[WALLET] Vérification fonds:', amount, 'FCFA');
    console.log('[WALLET] Solde réel (cash):', cashBalance, 'FCFA');
    console.log('[WALLET] Solde virtuel:', virtualBalance, 'FCFA');
    console.log('[WALLET] Suffisant ?', hasFunds ? 'OUI' : 'NON');
    
    return hasFunds;
  }, [cashBalance, virtualBalance]);

  const getBalanceBreakdown = useCallback(() => ({
    cash: cashBalance,
    virtual: virtualBalance,
    locked: 0,
    usable: cashBalance,
    total: cashBalance + virtualBalance
  }), [cashBalance, virtualBalance]);

  // Initialisation et écoute WebSocket
  useEffect(() => {
    if (user && isAuthenticated) {
      console.log(`[WALLET] 👤 Utilisateur ${user.id} -> Chargement initial`);
      refreshCompleteState();

      // ⚡ ABONNEMENT WEBSOCKET SIMPLIFIÉ
      const unsubscribe = boomsWebSocketRef.current.onMessage((message: any) => {
        console.log('[WALLET] 📨 WebSocket:', message.type);
        
        // ⚡ NOUVEAU PROTOCOLE : WebSocket = "resynchronise-toi"
        if (message.type === 'state_invalidation') {
          console.log(`[WALLET] 🔔 Resync demandée: ${message.reason}`);
          refreshCompleteState();
          return;
        }
        
        // ⚡ COMPATIBILITÉ TEMPORAIRE (transition)
        if (message.type === 'balance_update' || 
            message.type === 'real_balance_update' ||
            message.type === 'virtual_balance_update') {
          console.log('[WALLET] ⚠️ Ancien format WebSocket -> resync complète');
          refreshCompleteState();
        }
      });

      return () => {
        console.log('[WALLET] 🔊 Désabonnement WebSocket');
        unsubscribe();
      };
    } else {
      console.log('[WALLET] 👤 Utilisateur déconnecté -> reset');
      setVirtualBalance(0);
      setCashBalance(0);
      setInventory([]); // ⚡ AJOUT: Reset inventory
      setLoading(false);
    }
  // ✅ PATCH 2: Dépendances stabilisées pour éviter la boucle infinie
  }, [user?.id, isAuthenticated, refreshCompleteState]);

  // ⚡ SUPPRIMER LE POLLING COMPLEXE (garder simple)
  // Le polling a été supprimé comme demandé

  return (
    <WalletContext.Provider value={{ 
      cashBalance, 
      virtualBalance,
      inventory, // ⚡ AJOUT: Export du state inventory
      loading,
      
      usableBalance,
      
      refreshCashBalance,
      refreshVirtualBalance,
      refreshAllBalances,
      
      refreshAfterSell,
      
      hasSufficientFunds,
      
      getBalanceBreakdown,
      
      // ⚡ AJOUTER LES NOUVELLES MÉTHODES POUR LES SERVICES
      applyBackendState,
      refreshCompleteState,
      applyRealtimeCashBalance,
      requestBackendSync
    }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet doit être utilisé dans WalletProvider');
  return context;
};
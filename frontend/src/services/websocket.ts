/**
 * SERVICE WEB SOCKET POUR MISE À JOUR TEMPS-RÉEL BOOMS
 * Compatible avec le système existant, fonctionne en parallèle du polling.
 * AMÉLIORATION : Support de l'authentification WebSocket avec fallback
 * ✅ AMÉLIORATION : Live trading avec rooms par Boom
 * ✅ CORRECTION : Ajout de la méthode onUpdate manquante
 * ✅ CORRECTION : Connexion différée pour éviter les conflits
 */

import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Types pour les messages WebSocket
export interface SocialUpdateMessage {
  type: 'social_update';
  boom_id: number;
  title: string;
  old_social_value: number;
  new_social_value: number;
  new_total_value?: number;
  delta: number;
  action: 'buy' | 'sell' | 'share' | 'share_internal' | 'gift' | 'interaction' | 'like' | 'comment';
  timestamp: string;
  user_id?: number;
  broadcast_type?: 'significant_change';
  social_event?: string;
  total_value?: number;
  market_capitalization?: number;
  effective_capitalization?: number;
  capitalization_units?: number;
  redistribution_pool?: number;
  capitalization_fee?: number;
}

export interface SocialEventMessage {
  type: 'social_event';
  boom_id: number;
  event_type: 'viral' | 'trending' | 'new' | 'decay' | 'milestone';
  message: string;
  timestamp: string;
  data: any;
}

export interface UserNotificationMessage {
  type: 'user_notification';
  notification_type: string;
  title: string;
  message: string;
  timestamp: string;
  data: any;
}

export interface MarketUpdateMessage {
  type: 'market_update';
  boom_id: number;
  update_type: 'listed' | 'sold' | 'price_changed' | 'bid_placed';
  price?: number;
  buyer_id?: number;
  seller_id?: number;
  timestamp: string;
}

export interface GlobalStatsMessage {
  type: 'global_stats';
  stats: {
    active_connections: number;
    boom_subscriptions: number;
    unique_booms_subscribed: number;
    user_connections: number;
    timestamp: string;
  };
  timestamp: string;
}

export interface WelcomeMessage {
  type: 'welcome';
  message: string;
  timestamp: string;
  active_connections: number;
  user_id?: number;
  username?: string;
  authenticated: boolean;
}

export interface SubscriptionConfirmedMessage {
  type: 'subscription_confirmed';
  boom_id: number;
  message: string;
  timestamp: string;
}

export interface UnsubscriptionConfirmedMessage {
  type: 'unsubscription_confirmed';
  boom_id: number;
  timestamp: string;
}

export interface StatsMessage {
  type: 'stats';
  active_connections: number;
  boom_subscriptions: number;
  user_connections: number;
  timestamp: string;
}

export interface AuthErrorMessage {
  type: 'auth_error';
  message: string;
  timestamp: string;
}

export interface UserActionMessage {
  type: 'user_action';
  action: string;
  boom_id: number;
  timestamp: string;
}

// ⚡ NOUVEAU : Type pour l'invalidation d'état
export interface StateInvalidationMessage {
  type: 'state_invalidation';
  reason: string;
  timestamp: string;
  priority?: 'low' | 'medium' | 'high';
  original_message?: any;
}

export type WebSocketMessage = 
  | SocialUpdateMessage
  | SocialEventMessage
  | UserNotificationMessage
  | MarketUpdateMessage
  | GlobalStatsMessage
  | WelcomeMessage
  | SubscriptionConfirmedMessage
  | UnsubscriptionConfirmedMessage
  | StatsMessage
  | AuthErrorMessage
  | UserActionMessage
  | StateInvalidationMessage
  | { type: 'ping' | 'pong' }
  | { type: 'connection_status'; connected: boolean; authenticated: boolean };

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'XOF',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const formatCurrencyAmount = (value: number): string => {
  const numeric = Number.isFinite(value) ? value : Number(value) || 0;
  return currencyFormatter.format(Math.abs(numeric));
};

// Callbacks types
export type MessageCallback = (message: WebSocketMessage) => void;
export type StatusCallback = (status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'authenticated') => void;
export type BoomUpdateCallback = (boomId: number, delta: number, action: string, data: any) => void;
export type UpdateCallback = (data: any) => void; // ✅ Ajout du type pour onUpdate

/**
 * Service WebSocket principal pour BOOMS
 * Gère les connexions, reconnexions et callbacks
 * ✅ AMÉLIORATION : Support du live trading avec rooms par Boom
 * ✅ CORRECTION : Ajout de la méthode onUpdate manquante
 */
class BoomsWebSocketService {
  private socket: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000; // 1 seconde initiale
  private maxReconnectDelay: number = 30000; // 30 secondes max
  
  private messageCallbacks: MessageCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private boomUpdateCallbacks: Map<number, BoomUpdateCallback[]> = new Map();
  private updateCallbacks: UpdateCallback[] = []; // ✅ Ajout pour onUpdate
  
  private isConnecting: boolean = false;
  private isConnected: boolean = false;
  private isAuthenticated: boolean = false;
  private subscribedBooms: Set<number> = new Set();
  
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  
  private currentUserId: number | null = null;
  private currentUsername: string | null = null;
  private useSecureConnection: boolean = true;
  
  // Nouvelle propriété pour gérer la connexion automatique différée
  private autoConnectEnabled: boolean = true;
  private autoConnectAttempted: boolean = false;
  
  // Statistiques live
  private liveStats = {
    totalUpdates: 0,
    boomUpdates: new Map<number, number>(),
    lastUpdateTime: null as Date | null,
    connectionStartTime: null as Date | null
  };
  
  constructor() {
    console.log('🔌 Service WebSocket BOOMS initialisé (version live trading)');
    
    // 🚨 COMMENTEZ ou SUPPRIMEZ cette ligne :
    // this.scheduleDelayedAutoConnect(); // <-- À SUPPRIMER
    
    // ✅ REMPLACEZ par :
    console.log('🔌 [WS] Auto-connect désactivé - connexion contrôlée uniquement');
  }
  
  /**
   * Connexion automatique différée pour éviter les conflits
   */
  private scheduleDelayedAutoConnect(): void {
    if (!this.autoConnectEnabled) {
      console.log('🔌 [WS] Connexion automatique désactivée');
      return;
    }
    
    // Délai de 3 secondes pour laisser l'authentification s'initialiser
    setTimeout(async () => {
      if (this.autoConnectAttempted) {
        return; // Déjà tenté
      }
      
      this.autoConnectAttempted = true;
      
      try {
        // Vérifier si déjà connecté via un hook
        if (this.isConnected || this.isConnecting) {
          console.log('🔌 [WS] Déjà connecté via hook - skip auto-connect');
          return;
        }
        
        console.log('🔌 [WS] Connexion automatique différée...');
        
        // Vérifier s'il y a un token pour mode sécurisé
        const token = await AsyncStorage.getItem('booms_token');
        
        if (token) {
          console.log('🔌 [WS] Token trouvé, mode sécurisé');
          await this.connect();
        } else {
          console.log('🔌 [WS] Mode invité - connexion non sécurisée');
          await this.connect();
        }
      } catch (error) {
        console.error('❌ [WS] Erreur connexion automatique:', error);
        this.autoConnectAttempted = false; // Permettre une nouvelle tentative
      }
    }, 3000); // 3 secondes de délai
  }
  
  /**
   * Connecter au serveur WebSocket
   * ✅ AMÉLIORATION : Support de l'authentification avec fallback
   */
  async connect(userId?: number): Promise<void> {
    // ✅ CORRECTION : Vérification double avant connexion
    if (this.isConnecting) {
      console.log('⚠️ WebSocket déjà en cours de connexion');
      return;
    }
    
    if (this.isConnected) {
      console.log('⚠️ WebSocket déjà connecté');
      
      // Vérifier si besoin de mettre à jour l'authentification
      if (userId && this.currentUserId !== userId) {
        console.log('🔄 Mise à jour userId de', this.currentUserId, 'à', userId);
        this.currentUserId = userId;
      }
      return;
    }
    
    this.isConnecting = true;
    this.updateStatus('connecting');
    this.liveStats.connectionStartTime = new Date();
    
    try {
      // Essayer d'abord le WebSocket authentifié
      await this.connectSecure();
      
    } catch (error) {
      console.error('❌ Erreur connexion WebSocket sécurisée:', error);
      
      // Fallback sur l'ancien WebSocket non authentifié
      if (this.useSecureConnection) {
        console.log('🔄 Fallback sur WebSocket non sécurisé');
        this.useSecureConnection = false;
        await this.connectInsecure();
      } else {
        this.isConnecting = false;
        this.updateStatus('error');
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Connexion contrôlée avec authentification
   * À utiliser depuis AuthContext
   */
  public async connectWithAuth(userId: number, token: string): Promise<void> {
    console.log(`🔐 [WS] Connexion authentifiée pour user ${userId}`);
    
    // S'assurer qu'aucune connexion n'est en cours
    if (this.isConnected || this.isConnecting) {
      console.log('🔄 [WS] Déconnexion forcée pour nouvel utilisateur');
      await this.resetForNewUser();
    }
    
    this.currentUserId = userId;
    this.useSecureConnection = true;
    
    // Construire l'URL avec le token
    const wsUrl = this.buildWebSocketUrl(true, token);
    console.log('🔐 Connexion WebSocket authentifiée:', wsUrl.substring(0, 50) + '...');
    
    await this.connectDirect(wsUrl);
  }

  private async connectDirect(wsUrl: string): Promise<void> {
    this.isConnecting = true;
    this.updateStatus('connecting');
    
    this.socket = new WebSocket(wsUrl);
    this.setupEventListeners();
  }
  
  /**
   * Connexion sécurisée avec authentification
   */
  private async connectSecure(): Promise<void> {
    const token = await this.getToken();
    if (!token) {
      throw new Error('Aucun token disponible');
    }
    
    const wsUrl = this.buildWebSocketUrl(true, token);
    console.log('🔐 Connexion WebSocket sécurisée vers:', wsUrl);
    
    this.socket = new WebSocket(wsUrl);
    this.setupEventListeners();
  }
  
  /**
   * Connexion non sécurisée (fallback)
   */
  private async connectInsecure(): Promise<void> {
    const wsUrl = this.buildWebSocketUrl(false);
    console.log('🔓 Connexion WebSocket non sécurisée vers:', wsUrl);
    
    this.socket = new WebSocket(wsUrl);
    this.setupEventListeners();
  }
  
  /**
   * Obtenir le token d'authentification
   */
  private async getToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem('booms_token');
    } catch (error) {
      console.error('❌ Erreur lecture token:', error);
      return null;
    }
  }
  
  /**
   * Construire l'URL WebSocket
   * ✅ CORRECTION : URL directe pour éviter "Cannot read property 'replace' of undefined"
   * ✅ AJOUT: Timestamp pour éviter le cache de session
   */
  private buildWebSocketUrl(secure: boolean, token?: string): string {
    // ✅ CORRECTION: Utiliser EXPO_PUBLIC_API_BASE_URL depuis .env.local
    // Fallback sur localhost si non configuré
    const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';
    const base = apiUrl.replace('/api/v1', '');
    const protocol = base.startsWith('https') ? 'wss://' : 'ws://';
    const host = base.replace('http://', '').replace('https://', '').replace('ws://', '').replace('wss://', '');
    
    if (secure && token) {
      // ✅ AJOUT: Timestamp pour éviter le cache de session
      const timestamp = Date.now();
      return `${protocol}${host}/ws/secure-updates?token=${encodeURIComponent(token)}&_t=${timestamp}`;
    } else {
      return `${protocol}${host}/ws/booms`;
    }
  }
  
  /**
   * Configurer les écouteurs d'événements WebSocket
   * ✅ AMÉLIORATION : Gestion améliorée des états d'authentification
   */
  private setupEventListeners(): void {
    if (!this.socket) return;
    
    this.socket.onopen = () => {
      console.log('✅ WebSocket connecté avec succès');
      this.isConnecting = false;
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      
      if (this.useSecureConnection) {
        this.updateStatus('authenticated');
        this.isAuthenticated = true;
      } else {
        this.updateStatus('connected');
        this.isAuthenticated = false;
      }
      
      // Émettre l'événement connection_status pour onUpdate
      this.emitUpdate({
        type: 'connection_status',
        connected: true,
        authenticated: this.isAuthenticated
      });
      
      this.startHeartbeat();
      this.subscribeToPreviouslySubscribedBooms();
      
      // Demander les stats initiales
      this.getStats();
      
      // Démarrer les statistiques périodiques
      this.startStatsCollection();
    };
    
    this.socket.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('❌ Erreur parsing message WebSocket:', error, event.data);
      }
    };
    
    this.socket.onerror = (error) => {
      console.error('❌ Erreur WebSocket:', error);
      this.updateStatus('error');
      this.emitUpdate({
        type: 'connection_status',
        connected: false,
        authenticated: false,
        error: true
      });
    };
    
    this.socket.onclose = (event) => {
      console.log(`🔌 WebSocket déconnecté (code: ${event.code}, raison: ${event.reason})`);
      this.isConnecting = false;
      this.isConnected = false;
      this.isAuthenticated = false;
      
      // Émettre l'événement de déconnexion pour onUpdate
      this.emitUpdate({
        type: 'connection_status',
        connected: false,
        authenticated: false,
        code: event.code,
        reason: event.reason
      });
      
      this.stopHeartbeat();
      this.stopStatsCollection();
      this.updateStatus('disconnected');
      
      // Tentative de reconnexion si non fermé normalement
      if (event.code !== 1000) { // 1000 = fermeture normale
        this.scheduleReconnect();
      }
    };
  }
  
  /**
   * Gérer un message reçu
   * ⚡ CORRECTION : Traitement simplifié - WebSocket comme "sonnette" uniquement
   */
  private handleMessage(message: WebSocketMessage): void {
    console.log('📨 Message WebSocket reçu:', message.type, message);
    
    // ⚡ SUPPRIMER : updateLiveStats (pas nécessaire pour notre logique)
    
    // Appeler tous les callbacks enregistrés
    this.messageCallbacks.forEach(callback => {
      try {
        callback(message);
      } catch (error) {
        console.error('❌ Erreur dans callback WebSocket:', error);
      }
    });
    
    // ✅ Émettre vers les callbacks onUpdate (compatibilité)
    this.emitUpdate(message);
    
    // Traitements spécifiques par type
    switch (message.type) {
      case 'welcome':
        this.handleWelcomeMessage(message as WelcomeMessage);
        break;
        
      case 'social_update':
        this.handleSocialUpdate(message as SocialUpdateMessage);
        break;
        
      case 'social_event':
        this.handleSocialEvent(message as SocialEventMessage);
        break;
        
      case 'user_notification':
        this.handleUserNotification(message as UserNotificationMessage);
        break;
        
      case 'subscription_confirmed':
        this.handleSubscriptionConfirmed(message as SubscriptionConfirmedMessage);
        break;
        
      case 'auth_error':
        this.handleAuthError(message as AuthErrorMessage);
        break;
        
      case 'ping':
        this.sendPong();
        break;
        
      default:
        // Les autres types sont gérés par les callbacks
        break;
    }

    // ⚡ NOUVEAU : Traitement unifié pour toutes les invalidations d'état
    if (message.type === 'state_invalidation') {
      console.log('🎯 [WS] State invalidation reçu:', (message as any).reason);
      
      // Émettre un événement clair pour le WalletContext
      this.emitUpdate({
        type: 'state_invalidation',
        reason: (message as any).reason,
        timestamp: new Date().toISOString(),
        priority: 'high'
      });
    }

    // ⚡ COMPATIBILITÉ : Convertir anciens events en state_invalidation
    if (message.type === 'balance_update' || 
        message.type === 'real_balance_update' || 
        message.type === 'virtual_balance_update') {
      console.log('⚠️ [WS] Ancien format détecté, conversion en state_invalidation');
      
      this.emitUpdate({
        type: 'state_invalidation',
        reason: 'legacy_' + message.type,
        timestamp: new Date().toISOString(),
        original_message: message
      });
    }
  }
  
  /**
   * Émettre un message vers les callbacks onUpdate
   * ✅ NOUVEAU : Méthode pour la compatibilité
   */
  private emitUpdate(data: any): void {
    this.updateCallbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('❌ Erreur dans callback onUpdate:', error);
      }
    });
  }
  
  /**
   * Gérer le message de bienvenue
   */
  private handleWelcomeMessage(message: WelcomeMessage): void {
    console.log('👋 Message de bienvenue:', message.message);
    
    if (message.user_id) {
      const serverUserId = message.user_id;
      
      // ✅ LOGIQUE CORRIGÉE : Toujours accepter le user_id du serveur
      if (this.currentUserId !== null && this.currentUserId !== serverUserId) {
        console.warn(`⚠️ [WS] User mismatch: client=${this.currentUserId}, serveur=${serverUserId} - Forçant l'alignement`);
        
        // Émettre un événement pour alerter les autres parties
        this.emitUpdate({
          type: 'user_id_mismatch',
          client_user_id: this.currentUserId,
          server_user_id: serverUserId,
          timestamp: new Date().toISOString()
        });
      }
      
      // Mettre à jour avec l'ID du serveur (source de vérité)
      this.currentUserId = serverUserId;
      this.currentUsername = message.username || null;
      console.log(`👤 Utilisateur authentifié par serveur: ID ${serverUserId} (${message.username || 'sans nom'})`);
    }
    
    if (message.authenticated) {
      this.isAuthenticated = true;
      this.updateStatus('authenticated');
    }
  }
  
  /**
   * Gérer une erreur d'authentification
   */
  private handleAuthError(message: AuthErrorMessage): void {
    console.error('🔒 Erreur d\'authentification:', message.message);
    
    // Basculer vers le WebSocket non sécurisé
    if (this.useSecureConnection) {
      console.log('🔄 Basculer vers WebSocket non sécurisé...');
      this.useSecureConnection = false;
      this.disconnect();
      setTimeout(() => this.connect(), 1000);
    }
  }
  
  /**
   * Gérer la confirmation d'abonnement
   */
  private handleSubscriptionConfirmed(message: SubscriptionConfirmedMessage): void {
    const { boom_id, message: confirmationMessage } = message;
    console.log(`✅ ${confirmationMessage}`);
    
    // Notifier les callbacks spécifiques à ce Boom
    this.notifyBoomCallbacks(boom_id, 0, 'subscribed', message);
  }
  
  /**
   * Gérer une mise à jour de valeur sociale
   * ✅ AMÉLIORATION : Notifications ciblées par Boom
   */
  private handleSocialUpdate(message: SocialUpdateMessage): void {
    const { boom_id, title, delta, action, new_social_value, social_event } = message;
    
    // Mettre à jour les callbacks spécifiques à ce Boom
    this.notifyBoomCallbacks(boom_id, delta, action, message);
    
    // Afficher une notification pour les changements significatifs
    if (Math.abs(delta) >= 0.00001) {
      this.showSocialUpdateNotification(title, delta, action, social_event);
    }
    
    // Jouer un son pour les achats significatifs
    if (action === 'buy' && delta > 0.00003) {
      this.playPurchaseSound();
    }
  }
  
  /**
   * Gérer un événement social
   */
  private handleSocialEvent(message: SocialEventMessage): void {
    const { boom_id, event_type, message: eventMessage } = message;
    
    // Afficher une alerte pour les événements importants
    if (event_type === 'viral' || event_type === 'trending' || event_type === 'milestone') {
      Alert.alert(
        `🎉 BOOM ${event_type.toUpperCase()}!`,
        eventMessage,
        [{ text: 'Super !' }]
      );
      
      // Jouer un son spécial pour les événements viraux
      if (event_type === 'viral') {
        this.playViralSound();
      }
    }
  }
  
  /**
   * Gérer une notification utilisateur
   */
  private handleUserNotification(message: UserNotificationMessage): void {
    const { title, message: notificationMessage, notification_type } = message;
    
    // Afficher la notification
    Alert.alert(
      title,
      notificationMessage,
      [{ text: 'OK' }]
    );
  }
  
  /**
   * Notifier les callbacks spécifiques à un Boom
   */
  private notifyBoomCallbacks(boomId: number, delta: number, action: string, data: any): void {
    const callbacks = this.boomUpdateCallbacks.get(boomId);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(boomId, delta, action, data);
        } catch (error) {
          console.error('❌ Erreur dans callback Boom:', error);
        }
      });
    }
  }
  
  /**
   * Afficher une notification pour mise à jour sociale
   */
  private showSocialUpdateNotification(title: string, delta: number, action: string, socialEvent?: string): void {
    let icon = '🔄';
    let color = '#3B82F6';
    
    if (action === 'buy') {
      icon = '📈';
      color = '#10B981';
    } else if (action === 'sell') {
      icon = '📉';
      color = '#EF4444';
    } else if (action === 'share' || action === 'share_internal') {
      icon = '🔄';
      color = '#8B5CF6';
    } else if (action === 'like') {
      icon = '❤️';
      color = '#EC4899';
    }
    
    // Ajouter l'emoji d'événement si présent
    if (socialEvent === 'viral') {
      icon = '🔥 ' + icon;
    } else if (socialEvent === 'trending') {
      icon = '📈 ' + icon;
    }
    
    const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
    const notificationMessage = `${icon} ${title}: ${sign}${formatCurrencyAmount(delta)}`;
    
    // Émettre un événement pour que les composants puissent l'afficher
    this.emitNotificationEvent(notificationMessage, color);
  }
  
  /**
   * Jouer un son d'achat (à implémenter selon ton app)
   */
  private playPurchaseSound(): void {
    console.log('🔔 Son d\'achat joué');
    // Exemple: SoundPlayer.playSoundFile('purchase', 'mp3');
  }
  
  /**
   * Jouer un son viral (à implémenter selon ton app)
   */
  private playViralSound(): void {
    console.log('🎉 Son viral joué');
    // Exemple: SoundPlayer.playSoundFile('viral', 'mp3');
  }
  
  /**
   * Émettre un événement de notification
   */
  private emitNotificationEvent(message: string, color: string): void {
    // Implémentation selon ton système de notifications
    // Exemple: EventEmitter.emit('notification', { message, color });
    
    console.log('📢 Notification live:', message);
  }
  
  /**
   * Démarrer le heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.socket) {
        this.socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000); // Toutes les 25 secondes
  }
  
  /**
   * Démarrer la collecte de statistiques
   */
  private startStatsCollection(): void {
    this.statsInterval = setInterval(() => {
      this.getStats();
    }, 60000); // Toutes les minutes
  }
  
  /**
   * Arrêter le heartbeat et la collecte
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }
  
  /**
   * Arrêter la collecte de statistiques
   */
  private stopStatsCollection(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }
  
  /**
   * Envoyer un pong en réponse à un ping
   */
  private sendPong(): void {
    if (this.isConnected && this.socket) {
      this.socket.send(JSON.stringify({ type: 'pong' }));
    }
  }
  
  /**
   * Obtenir les statistiques du serveur
   */
  getStats(): void {
    if (this.isConnected && this.socket) {
      this.socket.send(JSON.stringify({ type: 'get_stats' }));
    }
  }
  
  /**
   * S'abonner aux mises à jour d'un BOOM
   * ✅ AMÉLIORATION : Gestion robuste des abonnements
   */
  subscribeToBoom(boomId: number): void {
    if (this.isConnected && this.socket && !this.subscribedBooms.has(boomId)) {
      const subscribeMessage = {
        type: 'subscribe',
        boom_id: boomId
      };
      
      this.socket.send(JSON.stringify(subscribeMessage));
      this.subscribedBooms.add(boomId);
      
      console.log(`📡 Abonnement demandé pour BOOM #${boomId}`);
      console.log(`📊 Boom actuellement suivis: ${Array.from(this.subscribedBooms).join(', ')}`);
    }
  }
  
  /**
   * Se désabonner des mises à jour d'un BOOM
   */
  unsubscribeFromBoom(boomId: number): void {
    if (this.isConnected && this.socket && this.subscribedBooms.has(boomId)) {
      const unsubscribeMessage = {
        type: 'unsubscribe',
        boom_id: boomId
      };
      
      this.socket.send(JSON.stringify(unsubscribeMessage));
      this.subscribedBooms.delete(boomId);
      
      // Supprimer les callbacks spécifiques
      this.boomUpdateCallbacks.delete(boomId);
      
      console.log(`📡 Désabonné de BOOM #${boomId}`);
    }
  }
  
  /**
   * Envoyer une action utilisateur
   */
  sendUserAction(boomId: number, action: string): void {
    if (this.isConnected && this.socket) {
      const actionMessage = {
        type: 'user_action',
        action: action,
        boom_id: boomId,
        timestamp: new Date().toISOString()
      };
      
      this.socket.send(JSON.stringify(actionMessage));
      console.log(`📤 Action "${action}" envoyée pour BOOM #${boomId}`);
    }
  }
  
  /**
   * Res'abonner aux BOOMS précédemment souscrits
   */
  private subscribeToPreviouslySubscribedBooms(): void {
    console.log(`🔄 Réabonnement aux ${this.subscribedBooms.size} Boom(s) précédents`);
    
    this.subscribedBooms.forEach(boomId => {
      this.subscribeToBoom(boomId);
    });
  }
  
  /**
   * Planifier une reconnexion
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Nombre maximum de tentatives de reconnexion atteint');
      
      // Essayer de basculer entre les modes si un échoue
      if (this.useSecureConnection) {
        console.log('🔄 Essai du WebSocket non sécurisé...');
        this.useSecureConnection = false;
        setTimeout(() => {
          this.connect();
        }, 5000);
      }
      return;
    }
    
    this.reconnectAttempts++;
    
    // Augmenter progressivement le délai (backoff exponentiel)
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    
    console.log(`🔄 Reconnexion dans ${Math.round(delay/1000)}s... (tentative ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isConnected && !this.isConnecting) {
        this.connect();
      }
    }, delay);
  }
  
  /**
   * Mettre à jour le statut et notifier les callbacks
   */
  private updateStatus(status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'authenticated'): void {
    console.log(`📡 Statut WebSocket: ${status}${this.isAuthenticated ? ' (authentifié)' : ''}`);
    
    this.statusCallbacks.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('❌ Erreur dans callback de statut:', error);
      }
    });
  }
  
  /**
   * Déconnecter proprement
   */
  disconnect(): void {
    console.log('🔌 Déconnexion WebSocket demandée');
    
    this.stopHeartbeat();
    this.stopStatsCollection();
    
    // Se désabonner de tous les Booms
    this.subscribedBooms.forEach(boomId => {
      this.unsubscribeFromBoom(boomId);
    });
    
    this.subscribedBooms.clear();
    this.boomUpdateCallbacks.clear();
    this.updateCallbacks = []; // ✅ Vider les callbacks onUpdate
    this.isAuthenticated = false;
    this.currentUserId = null;
    this.currentUsername = null;
    
    if (this.socket) {
      this.socket.close(1000, 'Déconnexion utilisateur');
      this.socket = null;
    }
    
    this.isConnecting = false;
    this.isConnected = false;
    this.updateStatus('disconnected');
  }
  
  /**
   * Rafraîchir la connexion avec un nouveau token
   */
  async refreshConnection(): Promise<void> {
    console.log('🔄 Rafraîchissement de la connexion WebSocket...');
    
    // Basculer vers le mode sécurisé si on était en mode non sécurisé
    if (!this.useSecureConnection) {
      this.useSecureConnection = true;
    }
    
    this.disconnect();
    
    // Petite pause avant reconnexion
    setTimeout(() => {
      this.connect();
    }, 1000);
  }
  
  /**
   * ✅ NOUVEAU : Méthode pour obtenir l'état complet de connexion
   */
  getConnectionState(): {
    isConnecting: boolean;
    isConnected: boolean;
    isAuthenticated: boolean;
    autoConnectAttempted: boolean;
  } {
    return {
      isConnecting: this.isConnecting,
      isConnected: this.isConnected,
      isAuthenticated: this.isAuthenticated,
      autoConnectAttempted: this.autoConnectAttempted
    };
  }
  
  /**
   * ✅ NOUVEAU : Désactiver la connexion automatique
   */
  disableAutoConnect(): void {
    this.autoConnectEnabled = false;
    console.log('🔌 [WS] Connexion automatique désactivée');
  }
  
  /**
   * ✅ NOUVEAU : Activer la connexion automatique
   */
  enableAutoConnect(): void {
    this.autoConnectEnabled = true;
    console.log('🔌 [WS] Connexion automatique activée');
  }
  
  // ==================== API PUBLIQUE ====================
  
  /**
   * ✅ CORRECTION : Ajout de la méthode onUpdate manquante
   * Méthode utilisée par InventoryScreen, DashboardScreen, BomDetailScreen
   */
  onUpdate(callback: UpdateCallback): () => void {
    this.updateCallbacks.push(callback);
    
    // Retourner une fonction pour supprimer le callback
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) {
        this.updateCallbacks.splice(index, 1);
      }
    };
  }
  
  /**
   * ✅ NOUVEAU : Réinitialiser complètement l'instance WebSocket
   */
  resetForNewUser(): void {
    console.log('🔄 [WS] Réinitialisation pour nouvel utilisateur');
    
    // Se déconnecter proprement
    this.disconnect();
    
    // Réinitialiser TOUS les états
    this.messageCallbacks = [];
    this.statusCallbacks = [];
    this.boomUpdateCallbacks.clear();
    this.updateCallbacks = [];
    this.subscribedBooms.clear();
    
    this.isConnecting = false;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.currentUserId = null;
    this.currentUsername = null;
    this.autoConnectAttempted = false;
    
    // Réinitialiser les stats
    this.liveStats = {
      totalUpdates: 0,
      boomUpdates: new Map<number, number>(),
      lastUpdateTime: null,
      connectionStartTime: null
    };
    
    console.log('✅ [WS] Instance complètement réinitialisée');
  }
  
  /**
   * Ajouter un callback pour les messages généraux
   */
  onMessage(callback: MessageCallback): () => void {
    this.messageCallbacks.push(callback);
    
    // Retourner une fonction pour supprimer le callback
    return () => {
      const index = this.messageCallbacks.indexOf(callback);
      if (index > -1) {
        this.messageCallbacks.splice(index, 1);
      }
    };
  }
  
  /**
   * Ajouter un callback pour les changements de statut
   */
  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.push(callback);
    
    // Retourner une fonction pour supprimer le callback
    return () => {
      const index = this.statusCallbacks.indexOf(callback);
      if (index > -1) {
        this.statusCallbacks.splice(index, 1);
      }
    };
  }
  
  /**
   * Ajouter un callback spécifique pour un Boom
   */
  onBoomUpdate(boomId: number, callback: BoomUpdateCallback): () => void {
    if (!this.boomUpdateCallbacks.has(boomId)) {
      this.boomUpdateCallbacks.set(boomId, []);
    }
    
    const callbacks = this.boomUpdateCallbacks.get(boomId)!;
    callbacks.push(callback);
    
    // S'abonner automatiquement au Boom si ce n'est pas déjà fait
    if (!this.subscribedBooms.has(boomId)) {
      this.subscribeToBoom(boomId);
    }
    
    // Retourner une fonction pour supprimer le callback
    return () => {
      const callbacks = this.boomUpdateCallbacks.get(boomId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
        if (callbacks.length === 0) {
          this.boomUpdateCallbacks.delete(boomId);
        }
      }
    };
  }
  
  /**
   * Vérifier si connecté
   */
  isConnectedStatus(): boolean {
    return this.isConnected;
  }
  
  /**
   * Vérifier si authentifié
   */
  isAuthenticatedStatus(): boolean {
    return this.isAuthenticated;
  }
  
  /**
   * Obtenir les BOOMS auxquels on est abonné
   */
  getSubscribedBooms(): number[] {
    return Array.from(this.subscribedBooms);
  }
  
  /**
   * Obtenir l'ID de l'utilisateur courant
   */
  getCurrentUserId(): number | null {
    return this.currentUserId;
  }
  
  /**
   * Obtenir le nom d'utilisateur courant
   */
  getCurrentUsername(): string | null {
    return this.currentUsername;
  }
  
  /**
   * Obtenir les statistiques live
   */
  getLiveStats() {
    const uptime = this.liveStats.connectionStartTime 
      ? Date.now() - this.liveStats.connectionStartTime.getTime()
      : 0;
    
    return {
      totalUpdates: this.liveStats.totalUpdates,
      subscribedBooms: this.subscribedBooms.size,
      boomUpdates: Object.fromEntries(this.liveStats.boomUpdates),
      lastUpdate: this.liveStats.lastUpdateTime,
      uptimeSeconds: Math.floor(uptime / 1000),
      connectionType: this.useSecureConnection ? 'secure' : 'insecure',
      authenticated: this.isAuthenticated
    };
  }
  
  /**
   * Envoyer un message personnalisé
   */
  sendMessage(message: any): boolean {
    if (this.isConnected && this.socket) {
      try {
        this.socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('❌ Erreur envoi message:', error);
        return false;
      }
    }
    return false;
  }
  
  /**
   * Méthode de compatibilité avec l'ancien système
   */
  send(message: string): boolean {
    if (this.isConnected && this.socket) {
      try {
        this.socket.send(message);
        return true;
      } catch (error) {
        console.error('❌ Erreur envoi message:', error);
        return false;
      }
    }
    return false;
  }
}

// Instance singleton globale
export const boomsWebSocket = new BoomsWebSocketService();

// ✅ SUPPRIMÉ : La connexion automatique immédiate est maintenant dans scheduleDelayedAutoConnect()

// Hook React Native pour utiliser facilement le WebSocket
export const useWebSocket = () => {
  return {
    connect: boomsWebSocket.connect.bind(boomsWebSocket),
    disconnect: boomsWebSocket.disconnect.bind(boomsWebSocket),
    refreshConnection: boomsWebSocket.refreshConnection.bind(boomsWebSocket),
    subscribeToBoom: boomsWebSocket.subscribeToBoom.bind(boomsWebSocket),
    unsubscribeFromBoom: boomsWebSocket.unsubscribeFromBoom.bind(boomsWebSocket),
    sendUserAction: boomsWebSocket.sendUserAction.bind(boomsWebSocket),
    onUpdate: boomsWebSocket.onUpdate.bind(boomsWebSocket), // ✅ Ajouté
    onMessage: boomsWebSocket.onMessage.bind(boomsWebSocket),
    onStatusChange: boomsWebSocket.onStatusChange.bind(boomsWebSocket),
    onBoomUpdate: boomsWebSocket.onBoomUpdate.bind(boomsWebSocket),
    isConnected: boomsWebSocket.isConnectedStatus.bind(boomsWebSocket),
    isAuthenticated: boomsWebSocket.isAuthenticatedStatus.bind(boomsWebSocket),
    getConnectionState: boomsWebSocket.getConnectionState.bind(boomsWebSocket),
    disableAutoConnect: boomsWebSocket.disableAutoConnect.bind(boomsWebSocket),
    enableAutoConnect: boomsWebSocket.enableAutoConnect.bind(boomsWebSocket),
    getCurrentUserId: boomsWebSocket.getCurrentUserId.bind(boomsWebSocket),
    getCurrentUsername: boomsWebSocket.getCurrentUsername.bind(boomsWebSocket),
    getSubscribedBooms: boomsWebSocket.getSubscribedBooms.bind(boomsWebSocket),
    getLiveStats: boomsWebSocket.getLiveStats.bind(boomsWebSocket),
    sendMessage: boomsWebSocket.sendMessage.bind(boomsWebSocket),
    send: boomsWebSocket.send.bind(boomsWebSocket),
    resetForNewUser: boomsWebSocket.resetForNewUser.bind(boomsWebSocket)
  };
};

// Fonction utilitaire pour formatter les deltas
export const formatDelta = (delta: number): string => {
  const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  return `${sign}${formatCurrencyAmount(delta)}`;
};

// Fonction utilitaire pour obtenir l'icône d'action
export const getActionIcon = (action: string): string => {
  switch (action) {
    case 'buy': return '📈';
    case 'sell': return '📉';
    case 'share':
    case 'share_internal':
      return '🔄';
    case 'gift': return '🎁';
    case 'like': return '❤️';
    case 'comment': return '💬';
    default: return '🔄';
  }
};

// Fonction utilitaire pour obtenir le type de connexion
export const getConnectionType = (): string => {
  return boomsWebSocket.isAuthenticatedStatus() ? 'authentifié' : 'non sécurisé';
};

// Fonction utilitaire pour calculer la nouvelle valeur
export const calculateNewValue = (oldValue: number, delta: number, conversionRate: number = 10000): number => {
  return oldValue + (delta * conversionRate);
};
import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { Notification } from '../services/notifications';
import { notificationsService } from '../services/notifications';
import { useAuth } from './AuthContext';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  refreshNotifications: () => Promise<void>;
  markAsRead: (notificationId: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  // Nouveau : Fonction pour gérer les actions spécifiques aux notifications
  handleNotificationAction: (notification: Notification) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const unreadCount = notifications.filter(notification => !notification.is_read).length;

  const refreshNotifications = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const data = await notificationsService.getNotifications(false, 50);
      setNotifications(data);
    } catch (error) {
      console.error('Erreur lors du chargement des notifications:', error);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: number) => {
    try {
      await notificationsService.markAsRead(notificationId);
      setNotifications(prev =>
        prev.map(notification =>
          notification.id === notificationId
            ? { ...notification, is_read: true }
            : notification
        )
      );
    } catch (error) {
      console.error('Erreur lors du marquage comme lu:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await notificationsService.markAllAsRead();
      setNotifications(prev =>
        prev.map(notification => ({ ...notification, is_read: true }))
      );
    } catch (error) {
      console.error('Erreur lors du marquage de tous comme lus:', error);
    }
  };

  // NOUVEAU : Fonction pour gérer les actions spécifiques aux notifications
  const handleNotificationAction = (notification: Notification) => {
    // Parser les données de notification depuis le backend
    const notificationData = notification.notification_data || {};
    
    switch (notification.notification_type) {
      case 'gift_received':
        // Pour les notifications de cadeau reçu
        const giftId = notification.related_entity_id || notificationData.gift_id;
        if (giftId) {
          console.log(`Action: Naviguer vers le cadeau ID: ${giftId}`);
          // Ici, on pourrait naviguer vers l'écran de cadeau
          // Par exemple: navigation.navigate('GiftDetail', { giftId });
          
          // Retourner l'action pour le composant qui appelle
          return {
            type: 'navigate',
            screen: 'GiftInbox',
            params: { focusOnGiftId: giftId }
          };
        }
        break;
        
      case 'gift_accepted':
        // Pour les notifications d'acceptation de cadeau
        const acceptedGiftId = notification.related_entity_id || notificationData.gift_id;
        if (acceptedGiftId) {
          console.log(`Action: Voir le cadeau accepté ID: ${acceptedGiftId}`);
          return {
            type: 'showMessage',
            message: `Votre cadeau a été accepté! Cadeau ID: ${acceptedGiftId}`
          };
        }
        break;
        
      case 'contact_added':
        // Pour les notifications de nouvel contact
        const contactUserId = notification.related_entity_id || notificationData.contact_user_id;
        if (contactUserId) {
          console.log(`Action: Voir le contact ID: ${contactUserId}`);
          return {
            type: 'navigate',
            screen: 'Contacts',
            params: { highlightUserId: contactUserId }
          };
        }
        break;
        
      default:
        console.log(`Type de notification non géré: ${notification.notification_type}`);
        return null;
    }
    
    return null;
  };

  useEffect(() => {
    if (user) {
      refreshNotifications();
      const interval = setInterval(refreshNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const value: NotificationContextType = {
    notifications,
    unreadCount,
    loading,
    refreshNotifications,
    markAsRead,
    markAllAsRead,
    handleNotificationAction, // NOUVEAU
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
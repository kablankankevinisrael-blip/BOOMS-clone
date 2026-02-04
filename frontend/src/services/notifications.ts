import api from './api';

export interface Notification {
  id: number;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  related_entity_id?: number;
  notification_data: Record<string, any>;
  created_at: string;
}

// Types spécifiques pour les données de notification
export interface GiftNotificationData {
  gift_id?: number;
  sender_name?: string;
  receiver_name?: string;
  boom_title?: string;
  social_value_increment?: number;
  fees?: {
    gift_fee?: number;
    sharing_fee?: number;
    total_fees?: number;
  };
}

export interface ContactNotificationData {
  contact_user_id?: number;
  contact_name?: string;
}

// Fonction utilitaire pour parser les données de notification
export const parseNotificationData = (notification: Notification) => {
  const { notification_type, notification_data, related_entity_id } = notification;
  
  switch (notification_type) {
    case 'gift_received':
    case 'gift_accepted':
      return {
        type: 'gift' as const,
        data: {
          gift_id: related_entity_id || notification_data?.gift_id,
          sender_name: notification_data?.sender_name,
          receiver_name: notification_data?.receiver_name,
          boom_title: notification_data?.boom_title,
          social_value_increment: notification_data?.social_value_increment,
          fees: notification_data?.fees
        } as GiftNotificationData
      };
      
    case 'contact_added':
      return {
        type: 'contact' as const,
        data: {
          contact_user_id: related_entity_id || notification_data?.contact_user_id,
          contact_name: notification_data?.contact_name
        } as ContactNotificationData
      };
      
    default:
      return {
        type: 'other' as const,
        data: notification_data
      };
  }
};

export const notificationsService = {
  // Récupérer les notifications
  async getNotifications(unreadOnly: boolean = false, limit: number = 50): Promise<Notification[]> {
    const response = await api.get(`/notifications?unread_only=${unreadOnly}&limit=${limit}`);
    return response.data;
  },

  // Marquer une notification comme lue
  async markAsRead(notificationId: number): Promise<{ message: string }> {
    const response = await api.patch(`/notifications/${notificationId}/read`);
    return response.data;
  },

  // Marquer toutes les notifications comme lues
  async markAllAsRead(): Promise<{ message: string }> {
    const response = await api.post('/notifications/mark-all-read');
    return response.data;
  },

  // Nouveau: Récupérer les notifications par type
  async getNotificationsByType(notificationType: string, unreadOnly: boolean = false): Promise<Notification[]> {
    const allNotifications = await this.getNotifications(unreadOnly);
    return allNotifications.filter(notification => 
      notification.notification_type === notificationType
    );
  },

  // Nouveau: Récupérer les notifications de cadeau
  async getGiftNotifications(unreadOnly: boolean = false): Promise<Notification[]> {
    return this.getNotificationsByType('gift_received', unreadOnly)
      .concat(await this.getNotificationsByType('gift_accepted', unreadOnly));
  }
};
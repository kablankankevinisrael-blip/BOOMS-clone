from sqlalchemy.orm import Session
from app.models.notification_models import Notification

def create_notification(db: Session, user_id: int, title: str, message: str, 
                       notification_type: str, related_entity_id: int = None, notification_data: dict = None):
    """Créer une nouvelle notification"""
    try:
        print(f"📧 Création de notification pour l'utilisateur {user_id}: {title}")
        
        # S'assurer que notification_data est un dictionnaire
        if notification_data is None:
            notification_data = {}
            
        notification = Notification(
            user_id=user_id,
            title=title,
            message=message,
            notification_type=notification_type,
            related_entity_id=related_entity_id,
            notification_data=notification_data
        )
        
        db.add(notification)
        db.commit()
        db.refresh(notification)
        
        print(f"✅ Notification créée avec succès (ID: {notification.id})")
        return notification
        
    except Exception as e:
        db.rollback()
        print(f"❌ Erreur dans create_notification: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def get_user_notifications(db: Session, user_id: int, unread_only: bool = False, limit: int = 50):
    """Récupérer les notifications d'un utilisateur"""
    try:
        print(f"📧 Récupération des notifications pour l'utilisateur {user_id}")
        
        query = db.query(Notification).filter(Notification.user_id == user_id)
        
        if unread_only:
            query = query.filter(Notification.is_read == False)
        
        notifications = query.order_by(Notification.created_at.desc()).limit(limit).all()
        
        print(f"✅ {len(notifications)} notifications récupérées")
        
        # ✅ RETOURNER DIRECTEMENT LES OBJETS SQLAlchemy PYDANTIC
        return notifications
        
    except Exception as e:
        print(f"❌ Erreur dans get_user_notifications: {str(e)}")
        import traceback
        traceback.print_exc()
        return []

def mark_notification_as_read(db: Session, notification_id: int, user_id: int):
    """Marquer une notification comme lue"""
    try:
        print(f"📧 Marquage de la notification {notification_id} comme lue")
        
        notification = db.query(Notification).filter(
            Notification.id == notification_id,
            Notification.user_id == user_id
        ).first()
        
        if notification:
            notification.is_read = True
            db.commit()
            print(f"✅ Notification {notification_id} marquée comme lue")
        else:
            print(f"⚠️ Notification {notification_id} non trouvée")
        
        return notification
        
    except Exception as e:
        db.rollback()
        print(f"❌ Erreur dans mark_notification_as_read: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def mark_all_notifications_as_read(db: Session, user_id: int):
    """Marquer toutes les notifications comme lues"""
    try:
        print(f"📧 Marquage de toutes les notifications comme lues pour l'utilisateur {user_id}")
        
        result = db.query(Notification).filter(
            Notification.user_id == user_id,
            Notification.is_read == False
        ).update({"is_read": True})
        
        db.commit()
        print(f"✅ {result} notifications marquées comme lues")
        return True
        
    except Exception as e:
        db.rollback()
        print(f"❌ Erreur dans mark_all_notifications_as_read: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
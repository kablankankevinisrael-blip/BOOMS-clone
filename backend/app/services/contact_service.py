from sqlalchemy.orm import Session
from app.models.user_models import User
from app.models.gift_models import Contact
from app.services.notification_service import create_notification

def add_contact(db: Session, user_id: int, contact_data: dict):
    """Ajouter un utilisateur à la liste de contacts"""
    try:
        # Vérifier que l'utilisateur existe
        contact_user = db.query(User).filter(
            User.phone == contact_data['contact_phone'],
            User.is_active == True
        ).first()
        
        if not contact_user:
            raise ValueError("Utilisateur non trouvé")
        
        if contact_user.id == user_id:
            raise ValueError("Vous ne pouvez pas vous ajouter vous-même en contact")
        
        # Vérifier si le contact existe déjà
        existing_contact = db.query(Contact).filter(
            Contact.user_id == user_id,
            Contact.contact_user_id == contact_user.id
        ).first()
        
        if existing_contact:
            raise ValueError("Cet utilisateur est déjà dans vos contacts")
        
        # Créer le contact
        contact = Contact(
            user_id=user_id,
            contact_user_id=contact_user.id,
            nickname=contact_data.get('nickname')
        )
        db.add(contact)
        
        # Notification (optionnelle)
        create_notification(
            db=db,
            user_id=user_id,
            title="👥 Contact ajouté",
            message=f"{contact_user.full_name or contact_user.phone} a été ajouté à vos contacts",
            notification_type="contact_added",
            related_entity_id=contact.id
        )
        
        db.commit()
        db.refresh(contact)
        return contact
    except Exception as e:
        db.rollback()
        print(f"❌ Erreur dans add_contact: {str(e)}")
        raise e  # Relancer l'exception pour que la route la gère

def get_user_contacts(db: Session, user_id: int):
    """Récupérer la liste des contacts d'un utilisateur"""
    try:
        print(f"🔍 DEBUG: Récupération contacts pour user_id: {user_id}")
        
        # Récupérer tous les contacts de l'utilisateur
        contacts = db.query(Contact).filter(Contact.user_id == user_id).all()
        print(f"✅ DEBUG: {len(contacts)} contacts bruts trouvés")
        
        # Pour chaque contact, récupérer les infos de l'utilisateur contacté
        enriched_contacts = []
        for contact in contacts:
            # Récupérer l'utilisateur correspondant au contact
            contact_user = db.query(User).filter(User.id == contact.contact_user_id).first()
            
            if contact_user:
                enriched_contact = {
                    "id": contact.id,
                    "contact_user_id": contact.contact_user_id,
                    "nickname": contact.nickname,
                    "is_favorite": contact.is_favorite,
                    "created_at": contact.created_at,
                    "contact_phone": contact_user.phone,  # Phone de l'utilisateur contacté
                    "contact_name": contact_user.full_name  # Nom de l'utilisateur contacté
                }
                enriched_contacts.append(enriched_contact)
                print(f"✅ Contact {contact.id} -> {contact_user.phone}")
            else:
                print(f"⚠️ Utilisateur {contact.contact_user_id} non trouvé pour le contact {contact.id}")
        
        print(f"✅ DEBUG: {len(enriched_contacts)} contacts enrichis créés")
        return enriched_contacts
        
    except Exception as e:
        print(f"❌ Erreur dans get_user_contacts: {str(e)}")
        import traceback
        traceback.print_exc()
        return []

def search_users(db: Session, search_term: str, current_user_id: int):
    """Rechercher des utilisateurs par téléphone ou nom"""
    try:
        users = db.query(User).filter(
            User.is_active == True,
            User.id != current_user_id,
            (User.phone.contains(search_term)) | (User.full_name.contains(search_term))
        ).limit(20).all()
        
        return users
    except Exception as e:
        print(f"❌ Erreur dans search_users: {str(e)}")
        return []  # Retourner une liste vide en cas d'erreur

def remove_contact(db: Session, user_id: int, contact_id: int):
    """Supprimer un contact"""
    try:
        contact = db.query(Contact).filter(
            Contact.id == contact_id,
            Contact.user_id == user_id
        ).first()
        
        if not contact:
            raise ValueError("Contact non trouvé")
        
        db.delete(contact)
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        print(f"❌ Erreur dans remove_contact: {str(e)}")
        raise e  # Relancer l'exception pour que la route la gère
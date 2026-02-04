"""
SERVICE WEB SOCKET POUR MISE À JOUR TEMPS-RÉEL DES VALEURS SOCIALES BOOMS
Fonctionne en parallèle de l'API REST existante, ne casse rien.
Version améliorée avec logs détaillés et robustesse renforcée.
"""

import json
import logging
from typing import Dict, List, Set, Any
from fastapi import WebSocket, WebSocketDisconnect
from datetime import datetime
import asyncio
from uuid import uuid4
from decimal import Decimal

logger = logging.getLogger(__name__)

class ConnectionManager:
    """
    Gestionnaire de connexions WebSocket pour les mises à jour temps-réel.
    Compatible avec tous les services existants.
    """
    
    def __init__(self):
        # Connexions actives par type
        self.active_connections: Set[WebSocket] = set()
        # Abonnements par BOOM ID
        self.boom_subscriptions: Dict[int, Set[WebSocket]] = {}
        # Connexions par utilisateur
        self.user_connections: Dict[int, Set[WebSocket]] = {}
        # ID de session par connexion
        self.connection_ids: Dict[WebSocket, str] = {}
        # Statistiques détaillées
        self.stats = {
            "total_connections": 0,
            "messages_sent": 0,
            "messages_received": 0,
            "errors": 0,
            "started_at": datetime.utcnow().isoformat()
        }
        
        logger.info("✅ Manager WebSocket initialisé")
        logger.debug(f"   Stats initialisées: {self.stats}")
    
    async def connect(self, websocket: WebSocket, user_id: int = None, client_info: Dict = None):
        """
        Accepter une nouvelle connexion WebSocket avec logs détaillés.
        """
        try:
            await websocket.accept()
            connection_id = str(uuid4())
            
            self.active_connections.add(websocket)
            self.connection_ids[websocket] = connection_id
            
            if user_id:
                if user_id not in self.user_connections:
                    self.user_connections[user_id] = set()
                self.user_connections[user_id].add(websocket)
            
            self.stats["total_connections"] += 1
            
            logger.info(f"🔌 Connexion WebSocket établie (ID: {connection_id})")
            logger.debug(f"   User ID: {user_id}")
            logger.debug(f"   Client info: {client_info}")
            logger.debug(f"   Connexions actives: {len(self.active_connections)}")
            logger.debug(f"   Connexions par user: {len(self.user_connections)}")
            
            return connection_id
            
        except Exception as e:
            logger.error(f"❌ Erreur lors de la connexion WebSocket: {e}")
            self.stats["errors"] += 1
            raise
    
    def disconnect(self, websocket: WebSocket):
        """
        Supprimer une connexion WebSocket avec logs.
        """
        try:
            connection_id = self.connection_ids.get(websocket, "inconnu")
            
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
            
            # Nettoyer les abonnements
            for boom_id in list(self.boom_subscriptions.keys()):
                if websocket in self.boom_subscriptions[boom_id]:
                    self.boom_subscriptions[boom_id].remove(websocket)
                    logger.debug(f"   Nettoyage abonnement BOOM #{boom_id}")
            
            # Nettoyer les connexions utilisateur
            for uid in list(self.user_connections.keys()):
                if websocket in self.user_connections[uid]:
                    self.user_connections[uid].remove(websocket)
                    if not self.user_connections[uid]:
                        del self.user_connections[uid]
            
            # Supprimer l'ID de connexion
            if websocket in self.connection_ids:
                del self.connection_ids[websocket]
            
            logger.info(f"🔌 Connexion WebSocket fermée (ID: {connection_id})")
            logger.debug(f"   Connexions restantes: {len(self.active_connections)}")
            
        except Exception as e:
            logger.error(f"❌ Erreur lors de la déconnexion WebSocket: {e}")
            self.stats["errors"] += 1
    
    async def subscribe_to_boom(self, websocket: WebSocket, boom_id: int):
        """
        S'abonner aux mises à jour d'un BOOM spécifique.
        """
        try:
            connection_id = self.connection_ids.get(websocket, "inconnu")
            
            if boom_id not in self.boom_subscriptions:
                self.boom_subscriptions[boom_id] = set()
            
            self.boom_subscriptions[boom_id].add(websocket)
            
            # Confirmation d'abonnement
            confirmation_msg = {
                "type": "subscription_confirmed",
                "boom_id": boom_id,
                "message": f"Abonné aux mises à jour du BOOM #{boom_id}",
                "connection_id": connection_id,
                "timestamp": datetime.utcnow().isoformat(),
                "subscriber_count": len(self.boom_subscriptions[boom_id])
            }
            
            await websocket.send_json(confirmation_msg)
            
            logger.info(f"📡 Abonnement BOOM #{boom_id} (Connexion: {connection_id})")
            logger.debug(f"   Total abonnés: {len(self.boom_subscriptions[boom_id])}")
            
        except Exception as e:
            logger.error(f"❌ Erreur lors de l'abonnement BOOM #{boom_id}: {e}")
            self.stats["errors"] += 1
    
    async def unsubscribe_from_boom(self, websocket: WebSocket, boom_id: int):
        """
        Se désabonner des mises à jour d'un BOOM.
        """
        try:
            connection_id = self.connection_ids.get(websocket, "inconnu")
            
            if boom_id in self.boom_subscriptions and websocket in self.boom_subscriptions[boom_id]:
                self.boom_subscriptions[boom_id].remove(websocket)
                
                confirmation_msg = {
                    "type": "unsubscription_confirmed",
                    "boom_id": boom_id,
                    "message": f"Désabonné des mises à jour du BOOM #{boom_id}",
                    "connection_id": connection_id,
                    "timestamp": datetime.utcnow().isoformat()
                }
                
                await websocket.send_json(confirmation_msg)
                
                logger.info(f"📡 Désabonnement BOOM #{boom_id} (Connexion: {connection_id})")
                
        except Exception as e:
            logger.error(f"❌ Erreur lors du désabonnement BOOM #{boom_id}: {e}")
            self.stats["errors"] += 1
    
    async def broadcast_to_all(self, message: Dict):
        """
        Diffuser un message à TOUTES les connexions actives.
        """
        disconnected = []
        sent_count = 0
        error_count = 0
        
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
                sent_count += 1
                self.stats["messages_sent"] += 1
            except Exception as e:
                logger.warning(f"⚠️ Erreur envoi broadcast: {e}")
                disconnected.append(connection)
                error_count += 1
                self.stats["errors"] += 1
        
        # Nettoyage des connexions fermées
        for conn in disconnected:
            self.disconnect(conn)
        
        logger.debug(f"📢 Broadcast général: {sent_count} envoyés, {error_count} erreurs")
        
        return {"sent": sent_count, "errors": error_count}
    
    async def broadcast_to_boom_subscribers(self, boom_id: int, message: Dict):
        """
        Diffuser un message uniquement aux abonnés d'un BOOM spécifique.
        """
        if boom_id not in self.boom_subscriptions:
            logger.debug(f"📢 Aucun abonné pour BOOM #{boom_id}")
            return {"sent": 0, "errors": 0, "subscribers": 0}
        
        disconnected = []
        subscribers = self.boom_subscriptions[boom_id].copy()
        sent_count = 0
        error_count = 0
        
        logger.debug(f"📢 Diffusion BOOM #{boom_id} à {len(subscribers)} abonné(s)")
        
        for connection in subscribers:
            try:
                await connection.send_json(message)
                sent_count += 1
                self.stats["messages_sent"] += 1
            except Exception as e:
                logger.warning(f"⚠️ Erreur envoi BOOM #{boom_id}: {e}")
                disconnected.append(connection)
                error_count += 1
                self.stats["errors"] += 1
        
        # Nettoyage
        for conn in disconnected:
            if conn in subscribers:
                subscribers.remove(conn)
            self.disconnect(conn)
        
        logger.debug(f"📢 Broadcast BOOM #{boom_id}: {sent_count} envoyés, {error_count} erreurs")
        
        return {
            "sent": sent_count,
            "errors": error_count,
            "subscribers": len(subscribers)
        }
    
    async def broadcast_to_user(self, user_id: int, message: Dict):
        """
        Diffuser un message à un utilisateur spécifique.
        """
        if user_id not in self.user_connections:
            logger.debug(f"📢 Utilisateur #{user_id} non connecté")
            return {"sent": 0, "errors": 0}
        
        disconnected = []
        user_conns = self.user_connections[user_id].copy()
        sent_count = 0
        error_count = 0
        
        for connection in user_conns:
            try:
                await connection.send_json(message)
                sent_count += 1
                self.stats["messages_sent"] += 1
            except Exception as e:
                logger.warning(f"⚠️ Erreur envoi user #{user_id}: {e}")
                disconnected.append(connection)
                error_count += 1
                self.stats["errors"] += 1
        
        # Nettoyage
        for conn in disconnected:
            if conn in user_conns:
                user_conns.remove(conn)
            self.disconnect(conn)
        
        logger.debug(f"📢 Broadcast user #{user_id}: {sent_count} envoyés")
        
        return {"sent": sent_count, "errors": error_count}
    
    async def send_ping(self, websocket: WebSocket):
        """
        Envoyer un ping pour garder la connexion active.
        """
        connection_id = self.connection_ids.get(websocket, "inconnu")
        
        try:
            ping_msg = {
                "type": "ping",
                "connection_id": connection_id,
                "timestamp": datetime.utcnow().isoformat()
            }
            await websocket.send_json(ping_msg)
            logger.debug(f"🏓 Ping envoyé (Connexion: {connection_id})")
        except Exception as e:
            logger.warning(f"⚠️ Erreur ping (Connexion: {connection_id}): {e}")
            self.disconnect(websocket)
    
    async def handle_connection(self, websocket: WebSocket, user_id: int = None, client_info: Dict = None):
        """
        Gérer la connexion WebSocket complète avec heartbeat et messages.
        """
        connection_id = None
        
        try:
            connection_id = await self.connect(websocket, user_id, client_info)
            
            # Envoyer un message de bienvenue
            welcome_msg = {
                "type": "welcome",
                "message": "✅ Connecté au service temps-réel BOOMS",
                "connection_id": connection_id,
                "user_id": user_id,
                "timestamp": datetime.utcnow().isoformat(),
                "active_connections": len(self.active_connections)
            }
            
            await websocket.send_json(welcome_msg)
            
            # Boucle principale de gestion des messages
            while True:
                try:
                    # Attendre un message du client
                    data = await websocket.receive_text()
                    self.stats["messages_received"] += 1
                    
                    logger.debug(f"📨 Message reçu (Connexion: {connection_id}): {data[:100]}...")
                    
                    # Traiter le message JSON
                    try:
                        message = json.loads(data)
                        await self._handle_client_message(websocket, message)
                    except json.JSONDecodeError:
                        # Message texte simple, pourrait être un ping/pong
                        if data == "ping":
                            await websocket.send_text("pong")
                        elif data == "pong":
                            logger.debug(f"🏓 Pong reçu (Connexion: {connection_id})")
                        continue
                    
                except WebSocketDisconnect:
                    logger.info(f"🔌 WebSocketDisconnect (Connexion: {connection_id})")
                    break
                except Exception as e:
                    logger.error(f"❌ Erreur traitement message (Connexion: {connection_id}): {e}")
                    self.stats["errors"] += 1
                    break
        
        except WebSocketDisconnect:
            logger.info(f"🔌 WebSocket déconnecté (Connexion: {connection_id})")
        except Exception as e:
            logger.error(f"❌ Erreur majeure connexion (Connexion: {connection_id}): {e}")
            self.stats["errors"] += 1
        finally:
            if connection_id:
                logger.info(f"🔌 Nettoyage connexion (ID: {connection_id})")
            self.disconnect(websocket)
    
    async def _handle_client_message(self, websocket: WebSocket, message: Dict):
        """
        Traiter un message du client.
        """
        connection_id = self.connection_ids.get(websocket, "inconnu")
        msg_type = message.get("type")
        
        logger.debug(f"📨 Traitement message type '{msg_type}' (Connexion: {connection_id})")
        
        if msg_type == "subscribe":
            boom_id = message.get("boom_id")
            if boom_id:
                await self.subscribe_to_boom(websocket, boom_id)
        
        elif msg_type == "unsubscribe":
            boom_id = message.get("boom_id")
            if boom_id:
                await self.unsubscribe_from_boom(websocket, boom_id)
        
        elif msg_type == "user_action":
            # Nouveau: gérer les interactions utilisateur (like, share, etc.)
            await self._handle_user_action(websocket, message)
        
        elif msg_type == "ping":
            await websocket.send_json({
                "type": "pong",
                "connection_id": connection_id,
                "timestamp": datetime.utcnow().isoformat()
            })
        
        elif msg_type == "get_stats":
            stats = self.get_stats()
            await websocket.send_json({
                "type": "connection_stats",
                "connection_id": connection_id,
                "stats": stats,
                "timestamp": datetime.utcnow().isoformat()
            })
        
        elif msg_type == "echo":
            await websocket.send_json({
                "type": "echo_response",
                "original_message": message,
                "connection_id": connection_id,
                "timestamp": datetime.utcnow().isoformat()
            })
        
        else:
            logger.debug(f"📨 Message client non traité: {msg_type}")
            await websocket.send_json({
                "type": "unknown_message",
                "received_type": msg_type,
                "message": "Type de message non reconnu",
                "connection_id": connection_id,
                "timestamp": datetime.utcnow().isoformat()
            })
    
    async def _handle_user_action(self, websocket: WebSocket, message: Dict):
        """
        Traiter une action utilisateur (like, share, etc.).
        """
        from app.database import get_db
        from app.services.interaction_service import interaction_service
        
        connection_id = self.connection_ids.get(websocket, "inconnu")
        action = message.get("action")
        boom_id = message.get("boom_id")
        user_id = message.get("user_id")
        
        logger.info(f"🎬 Action utilisateur: {action} sur BOOM #{boom_id} par user #{user_id}")
        
        if not all([action, boom_id]):
            await websocket.send_json({
                "type": "user_action_error",
                "error": "Paramètres manquants (action et boom_id requis)",
                "connection_id": connection_id,
                "timestamp": datetime.utcnow().isoformat()
            })
            return
        
        try:
            # Récupérer une session DB
            db = next(get_db())
            
            # Enregistrer l'interaction
            result = interaction_service.record_interaction(
                db=db,
                user_id=user_id or 0,  # 0 pour utilisateur anonyme
                boom_id=boom_id,
                action_type=action,
                metadata=message.get("metadata")
            )
            
            if result.get("success"):
                # Envoyer confirmation au client
                await websocket.send_json({
                    "type": "user_action_success",
                    "connection_id": connection_id,
                    "action": action,
                    "boom_id": boom_id,
                    "result": result,
                    "timestamp": datetime.utcnow().isoformat()
                })
                
                # Si c'est un like ou un share, broadcast la mise à jour sociale
                if action in ['like', 'share', 'share_internal'] and result.get("delta", 0) > 0:
                    await self.broadcast_social_update(
                        boom_id=boom_id,
                        boom_title=result.get("boom_title", ""),
                        old_value=result.get("old_social_value", 0),
                        new_value=result.get("new_social_value", 0),
                        delta=result.get("delta", 0),
                        action=action,
                        user_id=user_id
                    )
                
                logger.info(f"✅ Action '{action}' traitée avec succès")
            else:
                await websocket.send_json({
                    "type": "user_action_error",
                    "connection_id": connection_id,
                    "error": result.get("error", "Erreur inconnue"),
                    "timestamp": datetime.utcnow().isoformat()
                })
                logger.error(f"❌ Erreur traitement action: {result.get('error')}")
            
        except Exception as e:
            logger.error(f"❌ Exception lors du traitement de l'action: {e}", exc_info=True)
            await websocket.send_json({
                "type": "user_action_error",
                "connection_id": connection_id,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            })
    
    def get_stats(self) -> Dict:
        """
        Obtenir des statistiques détaillées sur les connexions WebSocket.
        """
        total_boom_subscriptions = sum(len(subs) for subs in self.boom_subscriptions.values())
        
        stats = {
            "active_connections": len(self.active_connections),
            "boom_subscriptions": total_boom_subscriptions,
            "unique_booms_subscribed": len(self.boom_subscriptions),
            "user_connections": len(self.user_connections),
            "total_connections": self.stats["total_connections"],
            "messages_sent": self.stats["messages_sent"],
            "messages_received": self.stats["messages_received"],
            "errors": self.stats["errors"],
            "uptime": (datetime.utcnow() - datetime.fromisoformat(self.stats["started_at"])).total_seconds(),
            "connection_ids": list(self.connection_ids.values()),
            "timestamp": datetime.utcnow().isoformat()
        }
        
        return stats


# Instance globale du manager
websocket_manager = ConnectionManager()


# ==================== UTILITAIRES POUR LES SERVICES EXISTANTS ====================

async def broadcast_social_value_update(
    boom_id: int,
    boom_title: str,
    old_value: float,
    new_value: float,
    delta: float,
    action: str,
    user_id: int = None
):
    """
    Diffuser une mise à jour de valeur sociale.
    À appeler depuis purchase_service.py, gift_service.py, market_service.py, etc.
    """
    logger.info(f"📢 BROADCAST: BOOM #{boom_id} {action} Δ{delta}")
    
    message = {
        "type": "social_update",
        "boom_id": boom_id,
        "title": boom_title,
        "old_social_value": old_value,
        "new_social_value": new_value,
        "delta": delta,
        "delta_percent": (delta / old_value * 100) if old_value != 0 else 0,
        "action": action,
        "timestamp": datetime.utcnow().isoformat(),
        "user_id": user_id,
        "broadcast_id": str(uuid4())
    }
    
    # Diffuser aux abonnés du BOOM
    result = await websocket_manager.broadcast_to_boom_subscribers(boom_id, message)
    
    # Diffuser à tous pour les mises à jour importantes
    if abs(delta) >= 0.00001:  # Changements significatifs
        message["broadcast_type"] = "significant_change"
        message["significance"] = "high" if abs(delta) >= 0.0001 else "medium"
        
        broadcast_result = await websocket_manager.broadcast_to_all(message)
        logger.debug(f"📢 Broadcast significatif: {broadcast_result}")
    
    # Notifier l'utilisateur concerné
    if user_id:
        user_notification = {
            "type": "user_notification",
            "notification_type": "social_update",
            "title": "Valeur sociale mise à jour",
            "message": f"Votre action ({action}) a changé la valeur de {boom_title}",
            "data": message,
            "timestamp": datetime.utcnow().isoformat()
        }
        await websocket_manager.broadcast_to_user(user_id, user_notification)
    
    logger.info(f"📢 Broadcast terminé: BOOM #{boom_id} ({result['subscribers']} abonnés, {result['sent']} envoyés)")
    
    return {
        "success": True,
        "broadcast_id": message["broadcast_id"],
        "boom_id": boom_id,
        "action": action,
        "subscribers": result.get("subscribers", 0),
        "sent": result.get("sent", 0),
        "errors": result.get("errors", 0)
    }


async def broadcast_social_event(
    boom_id: int,
    event_type: str,  # 'viral', 'trending', 'new', 'decay', 'milestone'
    message: str,
    data: Dict = None
):
    """
    Diffuser un événement social (viral, trending, etc.).
    """
    logger.info(f"🎉 BROADCAST EVENT: BOOM #{boom_id} {event_type}")
    
    event_msg = {
        "type": "social_event",
        "boom_id": boom_id,
        "event_type": event_type,
        "message": message,
        "timestamp": datetime.utcnow().isoformat(),
        "data": data or {},
        "broadcast_id": str(uuid4())
    }
    
    # Diffuser à tous
    result = await websocket_manager.broadcast_to_all(event_msg)
    
    logger.info(f"🎉 Événement {event_type} diffusé: {result['sent']} envoyés")
    
    return {
        "success": True,
        "broadcast_id": event_msg["broadcast_id"],
        "event_type": event_type,
        "sent": result.get("sent", 0)
    }


async def broadcast_user_notification(
    user_id: int,
    notification_type: str,  # 'boom_purchased', 'gift_received', 'value_increased', etc.
    title: str,
    message: str,
    data: Dict = None
):
    """
    Envoyer une notification à un utilisateur spécifique.
    """
    logger.info(f"📩 NOTIFICATION: User #{user_id} - {notification_type}")
    
    notification = {
        "type": "user_notification",
        "notification_type": notification_type,
        "title": title,
        "message": message,
        "timestamp": datetime.utcnow().isoformat(),
        "data": data or {},
        "broadcast_id": str(uuid4())
    }
    
    result = await websocket_manager.broadcast_to_user(user_id, notification)
    
    logger.debug(f"📩 Notification envoyée: {result['sent']} connexion(s)")
    
    return {
        "success": True,
        "user_id": user_id,
        "notification_type": notification_type,
        "sent": result.get("sent", 0)
    }


async def broadcast_market_update(
    boom_id: int,
    update_type: str,  # 'listed', 'sold', 'price_changed', 'bid_placed'
    price: float = None,
    buyer_id: int = None,
    seller_id: int = None
):
    """
    Diffuser une mise à jour du marché.
    """
    logger.info(f"🏪 MARKET UPDATE: BOOM #{boom_id} - {update_type}")
    
    market_msg = {
        "type": "market_update",
        "boom_id": boom_id,
        "update_type": update_type,
        "price": price,
        "buyer_id": buyer_id,
        "seller_id": seller_id,
        "timestamp": datetime.utcnow().isoformat(),
        "broadcast_id": str(uuid4())
    }
    
    # Diffuser aux abonnés du BOOM
    result = await websocket_manager.broadcast_to_boom_subscribers(boom_id, market_msg)
    
    # Diffuser à tous pour les ventes importantes
    if update_type == 'sold' and price and price >= 10000:  # Ventes > 10k FCFA
        market_msg["broadcast_type"] = "significant_sale"
        market_msg["significance"] = "major" if price >= 50000 else "minor"
        
        broadcast_result = await websocket_manager.broadcast_to_all(market_msg)
        logger.debug(f"🏪 Vente majeure diffusée: {broadcast_result}")
    
    logger.info(f"🏪 Mise à jour marché diffusée: {result['subscribers']} abonnés")
    
    return {
        "success": True,
        "broadcast_id": market_msg["broadcast_id"],
        "update_type": update_type,
        "subscribers": result.get("subscribers", 0),
        "sent": result.get("sent", 0)
    }


async def broadcast_global_stats(stats: Dict):
    """
    Diffuser des statistiques globales.
    """
    stats_msg = {
        "type": "global_stats",
        "stats": stats,
        "timestamp": datetime.utcnow().isoformat(),
        "broadcast_id": str(uuid4())
    }
    
    result = await websocket_manager.broadcast_to_all(stats_msg)
    
    logger.debug(f"📊 Statistiques globales diffusées: {result['sent']} clients")
    
    return {
        "success": True,
        "broadcast_id": stats_msg["broadcast_id"],
        "sent": result.get("sent", 0)
    }


async def broadcast_balance_update(
    user_id: int, 
    new_balance: Any,  # Accepte string ou float
    balance_type: str = "real"
):
    """
    Envoie la nouvelle valeur du solde à l'utilisateur concerné
    - new_balance: peut être string "16373.74" ou float 16373.74
    - balance_type: "real" pour CashBalance, "virtual" pour Wallet
    """
    # Convertir en string propre
    if isinstance(new_balance, (Decimal, float, int)):
        balance_str = f"{float(new_balance):.2f}"
    else:
        # Déjà en string
        try:
            # Valider que c'est un nombre
            balance_float = float(new_balance)
            balance_str = f"{balance_float:.2f}"
        except:
            balance_str = "0.00"
    
    logger.info(f"💰 BROADCAST BALANCE: User #{user_id} → {balance_str} FCFA (type: {balance_type})")
    
    message = {
        "type": "balance_update",
        "user_id": user_id,
        "new_balance": balance_str,  # Toujours en string formatée
        "balance_type": balance_type,
        "source": "cash_balance" if balance_type == "real" else "wallet",
        "timestamp": datetime.utcnow().isoformat(),
        "broadcast_id": str(uuid4())
    }
    
    result = await websocket_manager.broadcast_to_user(user_id, message)
    
    logger.debug(f"💰 Mise à jour solde diffusée: User #{user_id}, type: {balance_type}, {result.get('sent', 0)} connexion(s)")
    
    return {
        "success": True,
        "user_id": user_id,
        "new_balance": new_balance,
        "balance_type": balance_type,
        "sent": result.get("sent", 0)
    }


async def broadcast_treasury_update(data: dict):
    """
    Diffuser une mise à jour treasury aux clients WebSocket
    """
    try:
        from . import websocket_manager
        
        message = {
            "type": "treasury_update",
            "data": data,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Broadcast à tous les clients
        result = await websocket_manager.broadcast_to_all(message)
        
        logger.info(f"🏦 Broadcast treasury: {result['sent']} clients")
        return True
        
    except Exception as e:
        logger.debug(f"WebSocket treasury update failed: {e}")
        return False


# ==================== TÂCHE DE FOND (HEARTBEAT) ====================

async def websocket_heartbeat():
    """
    Tâche de fond pour envoyer des pings et maintenir les connexions.
    """
    logger.info("❤️  Démarrage heartbeat WebSocket")
    
    heartbeat_count = 0
    
    while True:
        try:
            heartbeat_count += 1
            
            # Stats avant heartbeat
            stats_before = websocket_manager.get_stats()
            
            # Envoyer un ping à toutes les connexions
            ping_tasks = []
            for websocket in list(websocket_manager.active_connections):
                ping_tasks.append(websocket_manager.send_ping(websocket))
            
            if ping_tasks:
                await asyncio.gather(*ping_tasks, return_exceptions=True)
            
            # Envoyer les stats périodiquement (toutes les 10 heartbeats)
            if heartbeat_count % 10 == 0:
                stats = websocket_manager.get_stats()
                await broadcast_global_stats(stats)
                
                logger.info(f"❤️  Heartbeat #{heartbeat_count} - Stats: {stats['active_connections']} connexions, "
                          f"{stats['boom_subscriptions']} abonnements, {stats['messages_sent']} messages envoyés")
            
            # Log détaillé toutes les 5 heartbeats
            if heartbeat_count % 5 == 0:
                stats = websocket_manager.get_stats()
                logger.debug(f"❤️  Stats détaillées: {stats}")
            
            # Attendre 30 secondes
            await asyncio.sleep(30)
            
        except asyncio.CancelledError:
            logger.info("❤️  Heartbeat WebSocket annulé")
            break
        except Exception as e:
            logger.error(f"❌ Erreur heartbeat WebSocket #{heartbeat_count}: {e}")
            websocket_manager.stats["errors"] += 1
            
            # Attendre avant de réessayer
            await asyncio.sleep(10)


def start_websocket_background_task():
    """
    Démarrer la tâche de fond WebSocket.
    À appeler au démarrage de l'application.
    """
    try:
        loop = asyncio.get_event_loop()
        heartbeat_task = loop.create_task(websocket_heartbeat())
        
        # Stocker la tâche pour pouvoir l'annuler plus tard si besoin
        websocket_manager.heartbeat_task = heartbeat_task
        
        logger.info("✅ Tâche de fond WebSocket démarrée")
        
        return heartbeat_task
    except Exception as e:
        logger.error(f"❌ Impossible de démarrer la tâche WebSocket: {e}")
        raise


def stop_websocket_background_task():
    """
    Arrêter la tâche de fond WebSocket.
    À appeler à l'arrêt de l'application.
    """
    try:
        if hasattr(websocket_manager, 'heartbeat_task'):
            websocket_manager.heartbeat_task.cancel()
            logger.info("✅ Tâche de fond WebSocket arrêtée")
    except Exception as e:
        logger.error(f"❌ Erreur lors de l'arrêt de la tâche WebSocket: {e}")


# Route WebSocket FastAPI (à ajouter dans vos routes principales)
"""
from fastapi import WebSocket, Depends
from app.auth import get_current_user_ws

@router.websocket("/ws/booms")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = None,
    user_id: int = None
):
    # Authentification optionnelle
    user = None
    if token:
        try:
            user = await get_current_user_ws(token)
        except:
            pass
    
    # Récupérer les infos client
    client_info = {
        "user_agent": websocket.headers.get("user-agent"),
        "client_ip": websocket.client.host if websocket.client else None,
        "connected_at": datetime.utcnow().isoformat()
    }
    
    await websocket_manager.handle_connection(
        websocket=websocket,
        user_id=user.id if user else user_id,
        client_info=client_info
    )
"""
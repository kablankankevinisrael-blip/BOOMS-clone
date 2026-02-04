# backend/app/websockets/manager.py
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional
import json
import logging
from datetime import datetime, timezone  # CORRECTION: Ajout de l'import manquant

logger = logging.getLogger(__name__)

class WebSocketManager:
    def __init__(self):
        # user_id → list[WebSocket]
        self.active_connections: Dict[int, List[WebSocket]] = {}
        # boom_id → list[WebSocket]
        self.boom_subscriptions: Dict[int, List[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        """Accepter et stocker une connexion WebSocket"""
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"WebSocket connecté - User ID: {user_id} | Total connectés: {len(self.active_connections)}")

    def disconnect(self, user_id: int, websocket: WebSocket):
        """Supprimer une connexion WebSocket"""
        if user_id in self.active_connections:
            self.active_connections[user_id] = [
                ws for ws in self.active_connections[user_id] if ws != websocket
            ]
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"WebSocket déconnecté - User ID: {user_id}")

    async def broadcast_to_user(self, user_id: int, message: dict):
        """Envoyer un message à un utilisateur spécifique"""
        if user_id in self.active_connections:
            dead_connections = []
            for websocket in self.active_connections[user_id]:
                try:
                    await websocket.send_json(message)
                except WebSocketDisconnect:
                    dead_connections.append(websocket)
                except Exception as e:
                    logger.error(f"Erreur envoi WebSocket à user {user_id}: {e}")
                    dead_connections.append(websocket)
            # Nettoyage
            for ws in dead_connections:
                self.disconnect(user_id, ws)

    async def broadcast_global(self, message: dict):
        """Envoyer un message à tous les utilisateurs connectés"""
        for user_id in list(self.active_connections.keys()):
            await self.broadcast_to_user(user_id, message)

    async def broadcast_to_boom_subscribers(self, boom_id: int, message: dict):
        """Envoyer un message à tous les abonnés d'un BOOM"""
        if boom_id in self.boom_subscriptions:
            dead_connections = []
            for websocket in self.boom_subscriptions[boom_id]:
                try:
                    await websocket.send_json(message)
                except WebSocketDisconnect:
                    dead_connections.append(websocket)
                except Exception as e:
                    logger.error(f"Erreur envoi WebSocket pour BOOM {boom_id}: {e}")
                    dead_connections.append(websocket)
            # Nettoyage
            for ws in dead_connections:
                # Trouver le user_id de cette WebSocket
                user_id = self.find_user_id_by_websocket(ws)
                if user_id:
                    self.disconnect(user_id, ws)
                # Retirer du boom_subscriptions
                if boom_id in self.boom_subscriptions and ws in self.boom_subscriptions[boom_id]:
                    self.boom_subscriptions[boom_id].remove(ws)

    async def subscribe_to_boom(self, websocket: WebSocket, boom_id: int):
        """Abonner une WebSocket aux mises à jour d'un BOOM"""
        if boom_id not in self.boom_subscriptions:
            self.boom_subscriptions[boom_id] = []
        if websocket not in self.boom_subscriptions[boom_id]:
            self.boom_subscriptions[boom_id].append(websocket)
            logger.info(f"WebSocket abonné au BOOM {boom_id}")

    async def unsubscribe_from_boom(self, websocket: WebSocket, boom_id: int):
        """Désabonner une WebSocket d'un BOOM"""
        if boom_id in self.boom_subscriptions and websocket in self.boom_subscriptions[boom_id]:
            self.boom_subscriptions[boom_id].remove(websocket)
            logger.info(f"WebSocket désabonné du BOOM {boom_id}")
            # Nettoyer si liste vide
            if not self.boom_subscriptions[boom_id]:
                del self.boom_subscriptions[boom_id]

    def get_stats(self) -> Dict:
        """Obtenir des statistiques sur les connexions"""
        total_connections = sum(len(conns) for conns in self.active_connections.values())
        total_boom_subscriptions = sum(len(subs) for subs in self.boom_subscriptions.values())
        
        return {
            "active_connections": total_connections,
            "unique_users": len(self.active_connections),
            "boom_subscriptions": total_boom_subscriptions,
            "unique_booms_subscribed": len(self.boom_subscriptions),
            "users_by_id": list(self.active_connections.keys())
        }

    def find_user_id_by_websocket(self, websocket: WebSocket) -> Optional[int]:
        """Trouver l'ID utilisateur d'une WebSocket"""
        for user_id, connections in self.active_connections.items():
            if websocket in connections:
                return user_id
        return None

    def remove_websocket(self, websocket: WebSocket):
        """Supprimer une WebSocket (méthode générique)"""
        # Trouver le user_id
        user_id = self.find_user_id_by_websocket(websocket)
        if user_id is not None:
            self.disconnect(user_id, websocket)
        
        # Retirer des abonnements aux BOOMs
        for boom_id in list(self.boom_subscriptions.keys()):
            if websocket in self.boom_subscriptions[boom_id]:
                self.boom_subscriptions[boom_id].remove(websocket)
                if not self.boom_subscriptions[boom_id]:
                    del self.boom_subscriptions[boom_id]

    # AJOUT: NOUVELLE MÉTHODE POUR L'INVALIDATION D'ÉTAT UTILISATEUR
    async def broadcast_user_state_invalidation(self, user_id: int, reason: str):
        """
        Notifie le frontend que son état est obsolète
        """
        try:
            message = {
                "type": "state_invalidation",
                "reason": reason,  # "boom_sold", "boom_bought", "balance_updated"
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "priority": "high" if reason in ["boom_sold", "boom_bought"] else "medium"
            }
            
            await self.broadcast_to_user(user_id, message)
            logger.info(f"📢 State invalidation sent - User: {user_id}, Reason: {reason}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to send state invalidation: {e}")
            return False


# Instance globale
websocket_manager = WebSocketManager()
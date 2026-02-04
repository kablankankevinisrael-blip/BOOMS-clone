"""
SERVICE DE CADEAUX BOOMS - VERSION ATOMIQUE ET SÛRE
Gestion des cadeaux avec atomicité garantie et séparation legacy/new flow
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import select, and_, or_
from decimal import Decimal, ROUND_HALF_UP
import uuid
from sqlalchemy.exc import IntegrityError, OperationalError
import asyncio
import json
import time  # Import manquant pour les retries

from app.models.user_models import User
from app.models.bom_models import BomAsset, UserBom
from app.models.gift_models import GiftTransaction, GiftStatus, Contact
from app.services.social_value_calculator import SocialValueCalculator
from app.services.social_value_utils import calculate_social_delta
from app.models.admin_models import PlatformTreasury, TreasuryTransactionLog
from app.services.wallet_service import create_gift_debit_transaction, create_transaction
from app.services.interaction_service import interaction_service

logger = logging.getLogger(__name__)

# ============ CONSTANTES DE SÉCURITÉ ============
MAX_RETRIES = 3
DEADLOCK_RETRY_DELAY = 0.1
SOCIAL_GIFT_RATE = Decimal('0.0004')  # 0.04% du boom pour les partages


class GiftService:
    def __init__(self, db: Session):
        self.db = db
    
    def send_gift(self, sender_id: int, gift_data: Dict) -> Dict:
        """
        VERSION ATOMIQUE ET SÛRE - NOUVEAU FLOW
        Flow: CREATED → PAID → DELIVERED (ou FAILED par rollback)
        Transaction unique garantissant atomicité
        """
        logger.info(f"🎁 SEND GIFT ATOMIQUE - Sender:{sender_id}, Data:{gift_data}")
        
        # 1. VALIDATIONS INITIALES (hors transaction)
        receiver_phone = gift_data.get('receiver_phone')
        bom_id = gift_data.get('bom_id')
        message = gift_data.get('message')
        quantity = gift_data.get('quantity', 1)
        
        if not receiver_phone or not bom_id:
            raise ValueError("Numéro du destinataire et ID du BOOM requis")
        
        sender = self.db.query(User).filter(User.id == sender_id).first()
        if not sender or not sender.is_active:
            raise ValueError("Expéditeur non valide")
        
        receiver = self.db.query(User).filter(User.phone == receiver_phone).first()
        if not receiver:
            raise ValueError("Destinataire non trouvé")
        
        if not receiver.is_active:
            raise ValueError("Le destinataire n'est pas actif")
        
        if sender_id == receiver.id:
            raise ValueError("Vous ne pouvez pas vous envoyer un cadeau à vous-même")
        
        user_bom = (
            self.db.query(UserBom)
            .filter(
                UserBom.user_id == sender_id,
                UserBom.bom_id == bom_id,
                UserBom.is_transferable.is_(True),
                UserBom.transferred_at.is_(None),
                UserBom.deleted_at.is_(None),
                UserBom.is_sold.is_(False)
            )
            .order_by(UserBom.acquired_at.asc())
            .first()
        )
        
        if not user_bom:
            raise ValueError("Vous ne possédez pas ce BOOM ou il n'est pas transférable")
        
        if self._has_active_transfer(user_bom.id):
            raise ValueError("Ce BOOM est déjà en cours de transfert. Veuillez attendre la fin du traitement précédent.")

        if self._has_recent_accepted_gift(user_bom.id):
            raise ValueError("Ce BOOM a déjà été offert et accepté récemment. Attendez 24h.")
        
        boom = user_bom.bom
        if not boom or not boom.is_active:
            raise ValueError("BOOM non disponible")
        
        if quantity < 1 or quantity > 10:
            raise ValueError("Quantité invalide (1-10)")
        
        # 2. CALCUL DES MONTANTS
        social_calculator = SocialValueCalculator(self.db)
        current_social_value = social_calculator.calculate_current_value(boom.id)
        
        sharing_fee = self._calculate_sharing_fee(current_social_value, sender_id)
        fee_percentage = Decimal('0.03')
        gift_fee = current_social_value * fee_percentage
        min_fee = Decimal('10.00')
        max_fee = Decimal('1000.00')
        gift_fee = max(min_fee, min(gift_fee, max_fee))
        
        total_fees = sharing_fee + gift_fee
        gross_amount = total_fees
        net_amount = current_social_value
        
        logger.info(f"💰 MONTANTS - Gross:{gross_amount}, Fee:{gift_fee}, Net:{net_amount}")
        
        # 3. TRANSACTION ATOMIQUE UNIQUE
        response_payload: Dict[str, Any] = {}
        try:
            with self.db.begin_nested():  # 🔥 COMPATIBLE AVEC AUTOBEGIN SQLAlchemy 2.0
                # === ÉTAPE 1: CRÉATION DU GIFT (CREATED) ===
                gift = GiftTransaction(
                    sender_id=sender_id,
                    receiver_id=receiver.id,
                    user_bom_id=user_bom.id,
                    message=message,
                    gross_amount=gross_amount,
                    fee_amount=gift_fee,
                    net_amount=net_amount,
                    fees=float(gift_fee),
                    status=GiftStatus.CREATED,
                    expires_at=datetime.utcnow() + timedelta(days=30)
                )
                
                gift.transaction_reference = gift.generate_transaction_reference()
                self.db.add(gift)
                self.db.flush()
                
                logger.info(f"📝 Gift CREATED: {gift.id}, Ref: {gift.transaction_reference}")
                
                # === ÉTAPE 1.5: PATCH CRITIQUE - SUSPENSION DE POSSESSION IMMÉDIATE ===
                # 🔒 LOCK du UserBom de l'expéditeur
                user_bom = (
                    self.db.query(UserBom)
                    .filter(
                        UserBom.id == gift.user_bom_id,
                        UserBom.user_id == sender_id,
                        UserBom.transferred_at.is_(None),
                        UserBom.deleted_at.is_(None),
                        UserBom.is_sold.is_(False)
                    )
                    .with_for_update()
                    .first()
                )
                
                if not user_bom:
                    raise ValueError("BOOM déjà transféré ou introuvable")
                
                # 🔥 SUSPENSION IMMÉDIATE DE LA POSSESSION
                user_bom.transferred_at = datetime.utcnow()
                user_bom.is_transferable = False
                user_bom.times_shared += 1  # ✅ AJOUTÉ ICI - unique responsabilité
                logger.info(f"🔄 Suspension possession: UserBom #{user_bom.id} transféré à {user_bom.transferred_at}")
                
                # === ÉTAPE 2: DÉBIT SENDER (PAID) ===
                debit_result = create_gift_debit_transaction(
                    db=self.db,
                    sender_id=sender_id,
                    amount=float(gross_amount),
                    gift_reference=gift.transaction_reference,
                    boom_title=boom.title,
                    receiver_phone=receiver.phone
                )
                
                if not debit_result or debit_result.get('success') != True:
                    error_msg = debit_result.get('message', 'Échec transaction wallet')
                    logger.error(f"❌ Transaction wallet échouée: {error_msg}")
                    raise ValueError(f"Échec débit wallet: {error_msg}")
                
                transaction_ids = []
                if debit_result.get('transaction_id'):
                    transaction_ids.append(debit_result['transaction_id'])
                
                gift.transition_to(GiftStatus.PAID)
                gift.paid_at = datetime.utcnow()
                gift.wallet_transaction_ids = transaction_ids
                
                self._update_contact(sender_id, receiver.id)
                
                logger.info(f"💸 Débit réussi (cadeau en attente): {gross_amount} FCFA")
                
                response_payload = {
                    "success": True,
                    "message": "🎁 Cadeau envoyé! En attente d'acceptation.",
                    "gift_id": gift.id,
                    "transaction_reference": gift.transaction_reference,
                    "financial": {
                        "gross_amount": float(gross_amount),
                        "fee_amount": float(gift_fee),
                        "net_amount": float(net_amount)
                    },
                    "timestamps": {
                        "paid_at": gift.paid_at.isoformat()
                    },
                    "status": GiftStatus.PAID.value,
                    "social_impact": None
                }

            self.db.commit()

            # Notifications async (safe) – après commit pour éviter les rollback fantômes
            try:
                from app.websockets import broadcast_user_notification
                import asyncio
                
                loop = asyncio.get_running_loop()
                loop.create_task(broadcast_user_notification(
                    user_id=receiver.id,
                    notification_type="gift_received_pending",
                    title="🎁 Cadeau en attente",
                    message=f"{sender.full_name} souhaite vous offrir '{boom.title}'. Acceptez ou refusez!",
                    data={"gift_id": gift.id}
                ))
            except RuntimeError:
                logger.warning("⚠️ No event loop, notifications skipped")
            except Exception as notify_error:
                logger.error(f"⚠️ Erreur notification cadeau: {notify_error}")

            return response_payload
        
        except Exception as e:
            self.db.rollback()
            logger.error(f"❌ Échec cadeau: {e}")
            
            logger.error(json.dumps({
                "event": "gift_failed",
                "sender_id": sender_id,
                "receiver_phone": receiver_phone,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }))
            
            raise
    
    def accept_gift(self, gift_id: int, receiver_id: int) -> Dict:
        """
        Accepter un cadeau reçu (nouveau flow + legacy)
        """
        logger.info(f"✅ ACCEPT GIFT - Gift:{gift_id}, Receiver:{receiver_id}")

        gift_preview = self.db.query(GiftTransaction).filter(
            GiftTransaction.id == gift_id,
            GiftTransaction.receiver_id == receiver_id
        ).first()

        if not gift_preview:
            raise ValueError("Cadeau non trouvé")

        if gift_preview.is_new_flow:
            return self._accept_new_flow_gift(gift_id, receiver_id)

        logger.info("➡️ Flow legacy détecté")

        retry_count = 0
        last_exception = None

        while retry_count < MAX_RETRIES:
            try:
                # =========================
                # 1️⃣ Récupération du cadeau (LOCK)
                # =========================
                gift = (
                    self.db.query(GiftTransaction)
                    .filter(
                        GiftTransaction.id == gift_id,
                        GiftTransaction.receiver_id == receiver_id,
                        GiftTransaction.status == GiftStatus.SENT,
                        self._legacy_flow_clause()
                    )
                    .with_for_update()
                    .first()
                )

                if not gift:
                    raise ValueError("Cadeau non trouvé ou déjà traité")

                if gift.expires_at and gift.expires_at < datetime.utcnow():
                    gift.transition_to(GiftStatus.EXPIRED)
                    self.db.commit()
                    raise ValueError("Ce cadeau a expiré")

                # =========================
                # 2️⃣ Données associées
                # =========================
                user_bom = gift.user_bom
                if not user_bom:
                    raise ValueError("BOOM associé non trouvé")

                sender = gift.sender

                # 🔒 Lock UserBom
                old_user_bom = (
                    self.db.query(UserBom)
                    .filter(UserBom.id == user_bom.id)
                    .with_for_update()
                    .one()
                )

                # 🔒 Lock Boom
                boom = (
                    self.db.query(BomAsset)
                    .filter(BomAsset.id == old_user_bom.bom_id)
                    .with_for_update()
                    .one()
                )

                # =========================
                # 3️⃣ Valeur sociale AVANT
                # =========================
                social_calculator = SocialValueCalculator(self.db)

                # =========================
                # 4️⃣ Création nouvelle possession
                # =========================
                new_user_bom = UserBom(
                    user_id=receiver_id,
                    bom_id=old_user_bom.bom_id,
                    sender_id=sender.id,
                    receiver_id=receiver_id,
                    transfer_id=str(uuid.uuid4()),
                    transfer_message=gift.message,
                    purchase_price=old_user_bom.purchase_price,
                    current_estimated_value=boom.get_display_total_value(),
                    times_received_as_gift=old_user_bom.times_received_as_gift + 1,
                    acquired_at=datetime.utcnow()
                )
                self.db.add(new_user_bom)

                # =========================
                # 5️⃣ Mise à jour ancienne possession
                # =========================
                old_user_bom.transferred_at = datetime.utcnow()
                old_user_bom.receiver_id = receiver_id
                old_user_bom.is_transferable = False

                # =========================
                # 6️⃣ Mise à jour du cadeau
                # =========================
                gift.transition_to(GiftStatus.ACCEPTED)
                gift.accepted_at = datetime.utcnow()

                # =========================
                # 7️⃣ Mise à jour valeur sociale
                # =========================
                purchase_hint = old_user_bom.purchase_price or boom.get_display_total_value() or Decimal('0')
                social_metadata = {
                    "channel": "gift_legacy",
                    "flow": "legacy",
                    "gift_id": gift.id,
                    "sender_id": sender.id,
                    "receiver_id": receiver_id,
                    "transaction_amount": float(purchase_hint or Decimal('0')),
                    "quantity": 1,
                    "message_present": bool(gift.message)
                }
                social_action_result, _ = social_calculator.apply_social_action(
                    boom=boom,
                    action='gift',
                    user_id=receiver_id,
                    metadata=social_metadata,
                    create_history=True
                )
                serialized_social_result = social_calculator.serialize_action_result(social_action_result)
                new_social_value = social_action_result["new_social_value"]
                previous_social_value = social_action_result["old_social_value"]
                boom.sync_social_totals()

                boom.total_gifts_accepted += 1
                if boom.total_gifts_sent > 0:
                    boom.gift_acceptance_rate = (
                        boom.total_gifts_accepted / boom.total_gifts_sent
                    )

                self._update_boom_social_metrics(boom.id)

                self._record_internal_share_interaction(
                    boom=boom,
                    sender_id=sender.id,
                    receiver_id=receiver_id,
                    gift=gift,
                    flow="legacy"
                )

                # =========================
                # 8️⃣ Notification
                # =========================
                receiver_user = self.db.query(User).filter(User.id == receiver_id).first()
                if receiver_user:
                    self._create_acceptance_notification(
                        sender.id,
                        receiver_user.full_name or receiver_user.phone,
                        boom.title
                    )

                # =========================
                # 9️⃣ COMMIT UNIQUE
                # =========================
                self.db.commit()

                logger.info(f"✅ Gift accepted (legacy): {gift_id} by {receiver_id}")
                logger.info(f"📊 Valeur sociale: {previous_social_value} → {new_social_value}")

                self._broadcast_gift_social_update(
                    boom=boom,
                    sender_id=sender.id,
                    receiver_id=receiver_id,
                    social_result=serialized_social_result,
                    gift_id=gift.id,
                    flow="legacy"
                )

                return {
                    "success": True,
                    "message": "✅ Cadeau accepté avec succès!",
                    "gift_id": gift.id,
                    "new_user_bom_id": new_user_bom.id,
                    "boom": {
                        "id": boom.id,
                        "title": boom.title,
                        "current_social_value": float(boom.get_display_total_value())
                    },
                    "financial": {
                        "gift_fee_paid": float(gift.fees) if gift.fees else 0.0
                    },
                    "social_impact": serialized_social_result
                }

            except OperationalError as e:
                self.db.rollback()
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock détecté, retry {retry_count}/{MAX_RETRIES}")
                    time.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                raise

            except Exception as e:
                self.db.rollback()
                logger.error(f"❌ Erreur accept_gift: {e}")
                raise

        if last_exception:
            raise last_exception

    def _accept_new_flow_gift(self, gift_id: int, receiver_id: int) -> Dict[str, Any]:
        """Finalize a pending new-flow gift (PAID → DELIVERED)."""
        logger.info(f"🚀 ACCEPT NEW FLOW GIFT - Gift:{gift_id}, Receiver:{receiver_id}")

        retry_count = 0
        last_exception: Optional[Exception] = None

        while retry_count < MAX_RETRIES:
            try:
                gift = (
                    self.db.query(GiftTransaction)
                    .filter(
                        GiftTransaction.id == gift_id,
                        GiftTransaction.receiver_id == receiver_id,
                        self._new_flow_clause()
                    )
                    .with_for_update()
                    .first()
                )

                if not gift:
                    raise ValueError("Cadeau non trouvé ou déjà traité")

                if gift.status == GiftStatus.DELIVERED:
                    logger.info("ℹ️ Cadeau déjà livré, aucun retraitement nécessaire")
                    return {
                        "success": True,
                        "message": "Ce cadeau a déjà été accepté",
                        "gift_id": gift_id,
                        "status": gift.status.value,
                        "wallet_transaction_ids": gift.wallet_transaction_ids or []
                    }

                if gift.status != GiftStatus.PAID:
                    raise ValueError("Ce cadeau n'est plus en attente d'acceptation")

                user_bom = (
                    self.db.query(UserBom)
                    .filter(UserBom.id == gift.user_bom_id)
                    .with_for_update()
                    .first()
                )

                if not user_bom:
                    raise ValueError("BOOM associé introuvable")

                if self._has_expired(gift.expires_at):
                    self._restore_user_bom_to_sender(user_bom)
                    gift.transition_to(GiftStatus.EXPIRED)
                    gift.failed_at = datetime.now(timezone.utc)
                    self.db.commit()
                    raise ValueError("Ce cadeau a expiré")

                boom = (
                    self.db.query(BomAsset)
                    .filter(BomAsset.id == user_bom.bom_id)
                    .with_for_update()
                    .first()
                )

                if not boom or not boom.is_active:
                    raise ValueError("BOOM introuvable ou inactif")

                social_calculator = SocialValueCalculator(self.db)

                now = datetime.now(timezone.utc)
                net_amount_decimal = Decimal(str(gift.net_amount)) if gift.net_amount is not None else Decimal('0')
                purchase_price_decimal = Decimal(str(user_bom.purchase_price)) if user_bom.purchase_price else Decimal('0')
                boom_value_decimal = Decimal(str(boom.get_display_total_value()))
                acquisition_value = net_amount_decimal if net_amount_decimal > 0 else purchase_price_decimal
                if acquisition_value <= 0:
                    acquisition_value = boom_value_decimal

                new_user_bom = UserBom(
                    user_id=receiver_id,
                    bom_id=boom.id,
                    sender_id=gift.sender_id,
                    receiver_id=receiver_id,
                    transfer_id=gift.transaction_reference or str(uuid.uuid4()),
                    transfer_message=gift.message,
                    purchase_price=acquisition_value,
                    current_value=Decimal(str(boom.get_display_total_value())),
                    is_transferable=True,
                    acquired_at=now,
                    times_received_as_gift=(user_bom.times_received_as_gift or 0) + 1
                )
                self.db.add(new_user_bom)

                user_bom.transferred_at = now
                user_bom.receiver_id = receiver_id
                user_bom.is_transferable = False
                user_bom.is_sold = True
                user_bom.deleted_at = now

                gift.transition_to(GiftStatus.DELIVERED)
                gift.accepted_at = now
                gift.delivered_at = now

                social_metadata = {
                    "channel": "gift_new_flow",
                    "flow": "new",
                    "gift_id": gift.id,
                    "sender_id": gift.sender_id,
                    "receiver_id": receiver_id,
                    "transaction_amount": float(net_amount_decimal or Decimal('0')),
                    "quantity": 1,
                    "message_present": bool(gift.message)
                }
                social_action_result, _ = social_calculator.apply_social_action(
                    boom=boom,
                    action='gift',
                    user_id=receiver_id,
                    metadata=social_metadata,
                    create_history=True
                )
                serialized_social_result = social_calculator.serialize_action_result(social_action_result)
                previous_social_value = social_action_result["old_social_value"]
                boom.sync_social_totals()
                self._update_boom_social_metrics(boom.id)

                self._record_internal_share_interaction(
                    boom=boom,
                    sender_id=gift.sender_id,
                    receiver_id=receiver_id,
                    gift=gift,
                    flow="new"
                )

                treasury_snapshot = self._credit_treasury_fee(gift, receiver_id)

                self.db.flush()

                if net_amount_decimal <= 0:
                    raise ValueError("Montant net invalide pour créditer le destinataire")

                credit_description = f"Cadeau reçu: {boom.title} ({gift.transaction_reference})"
                credit_result = create_transaction(
                    db=self.db,
                    user_id=receiver_id,
                    amount=float(net_amount_decimal),
                    transaction_type="gift_received_real",
                    description=credit_description
                )

                credit_tx_id = credit_result.get("transaction_id")
                if credit_tx_id:
                    try:
                        self._append_wallet_transaction_id(gift.id, credit_tx_id)
                    except Exception as attach_error:
                        logger.warning(f"⚠️ Impossible d'attacher la transaction wallet {credit_tx_id}: {attach_error}")

                wallet_transactions = self._fetch_wallet_transaction_ids(gift.id)

                response_payload = {
                    "success": True,
                    "message": "🎉 Cadeau accepté! BOOM ajouté à votre inventaire.",
                    "gift_id": gift.id,
                    "status": gift.status.value,
                    "new_user_bom_id": new_user_bom.id,
                    "financial": {
                        "gross_amount": float(gift.gross_amount or 0),
                        "fee_amount": float(gift.fee_amount or 0),
                        "net_amount": float(net_amount_decimal),
                        "wallet_transaction_ids": wallet_transactions,
                        "treasury_fee_recorded": float(treasury_snapshot["amount"]) if treasury_snapshot else 0.0
                    },
                    "boom": {
                        "id": boom.id,
                        "title": boom.title,
                        "current_social_value": float(boom.get_display_total_value())
                    },
                    "social_impact": serialized_social_result
                }

                self.db.commit()

                self._broadcast_gift_social_update(
                    boom=boom,
                    sender_id=gift.sender_id,
                    receiver_id=receiver_id,
                    social_result=serialized_social_result,
                    gift_id=gift.id,
                    flow="new"
                )

                if treasury_snapshot:
                    self._broadcast_treasury_snapshot(treasury_snapshot)

                self._notify_new_flow_acceptance(gift, boom, receiver_id, float(net_amount_decimal))

                logger.info(f"✅ Gift {gift_id} livré au receiver {receiver_id}")
                return response_payload

            except OperationalError as e:
                self.db.rollback()
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock accept gift (new flow), retry {retry_count}/{MAX_RETRIES}")
                    time.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                raise
            except Exception as e:
                self.db.rollback()
                logger.error(f"❌ Erreur accept_gift (new flow): {e}")
                raise

        if last_exception:
            raise last_exception

    def _decline_new_flow_gift(self, gift_id: int, receiver_id: int) -> Dict[str, Any]:
        """Decline a pending new-flow gift by restoring assets and marking failure."""
        logger.info(f"🛑 DECLINE NEW FLOW GIFT - Gift:{gift_id}, Receiver:{receiver_id}")

        retry_count = 0
        last_exception: Optional[Exception] = None

        while retry_count < MAX_RETRIES:
            try:
                gift = (
                    self.db.query(GiftTransaction)
                    .filter(
                        GiftTransaction.id == gift_id,
                        GiftTransaction.receiver_id == receiver_id,
                        self._new_flow_clause()
                    )
                    .with_for_update()
                    .first()
                )

                if not gift:
                    raise ValueError("Cadeau non trouvé ou déjà traité")

                if gift.status == GiftStatus.FAILED:
                    logger.info("ℹ️ Cadeau déjà refusé")
                    return {
                        "success": True,
                        "message": "Ce cadeau a déjà été refusé",
                        "gift_id": gift.id,
                        "status": gift.status.value
                    }

                if gift.status != GiftStatus.PAID:
                    raise ValueError("Ce cadeau n'est pas en attente de décision")

                user_bom = (
                    self.db.query(UserBom)
                    .filter(UserBom.id == gift.user_bom_id)
                    .with_for_update()
                    .first()
                )

                if not user_bom:
                    raise ValueError("BOOM associé introuvable")

                self._restore_user_bom_to_sender(user_bom)

                gift.transition_to(GiftStatus.FAILED)
                gift.failed_at = datetime.utcnow()

                self.db.commit()

                self._send_notification_async(
                    gift.sender_id,
                    "gift_declined",
                    "Cadeau refusé",
                    "Le destinataire a refusé votre cadeau.",
                    {"gift_id": gift.id}
                )

                self._send_notification_async(
                    receiver_id,
                    "gift_decline_confirmed",
                    "Cadeau refusé",
                    "Vous avez refusé ce cadeau.",
                    {"gift_id": gift.id}
                )

                logger.info(f"🛑 Gift {gift_id} refusé par {receiver_id}")

                return {
                    "success": True,
                    "message": "Cadeau refusé. Les frais déjà payés ne sont pas remboursés.",
                    "gift_id": gift.id,
                    "status": gift.status.value
                }

            except OperationalError as e:
                self.db.rollback()
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock decline gift (new flow), retry {retry_count}/{MAX_RETRIES}")
                    time.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                raise
            except Exception as e:
                self.db.rollback()
                logger.error(f"❌ Erreur decline_gift (new flow): {e}")
                raise

        if last_exception:
            raise last_exception

    
    def decline_gift(self, gift_id: int, receiver_id: int) -> Dict:
        """
        Refuser un cadeau reçu (nouveau flow + legacy)
        """
        logger.info(f"❌ DECLINE GIFT (legacy) - Gift:{gift_id}, Receiver:{receiver_id}")

        gift_preview = self.db.query(GiftTransaction).filter(
            GiftTransaction.id == gift_id,
            GiftTransaction.receiver_id == receiver_id
        ).first()

        if not gift_preview:
            raise ValueError("Cadeau non trouvé")

        if gift_preview.is_new_flow:
            return self._decline_new_flow_gift(gift_id, receiver_id)

        retry_count = 0
        last_exception = None

        while retry_count < MAX_RETRIES:
            try:
                # 🔒 Lock du cadeau (legacy only)
                gift = (
                    self.db.query(GiftTransaction)
                    .filter(
                        GiftTransaction.id == gift_id,
                        GiftTransaction.receiver_id == receiver_id,
                        GiftTransaction.status == GiftStatus.SENT,
                        self._legacy_flow_clause()
                    )
                    .with_for_update()
                    .first()
                )

                if not gift:
                    raise ValueError("Cadeau non trouvé ou déjà traité")

                # Récupérer le BOOM
                user_bom = gift.user_bom

                if user_bom:
                    # 🔒 Lock du UserBom
                    locked_user_bom = (
                        self.db.query(UserBom)
                        .filter(UserBom.id == user_bom.id)
                        .with_for_update()
                        .one()
                    )
                    
                    # 🔁 PATCH IMPORTANT - RESTAURATION DE LA POSSESSION
                    locked_user_bom.transferred_at = None
                    locked_user_bom.is_transferable = True
                    logger.info(f"🔄 Restauration possession: UserBom #{locked_user_bom.id} rendu à l'expéditeur")

                # Transition vers DECLINED
                gift.transition_to(GiftStatus.DECLINED)

                # ✅ COMMIT UNIQUE
                self.db.commit()

                logger.info(f"❌ Gift declined (legacy): {gift_id}")

                return {
                    "success": True,
                    "message": "Cadeau refusé",
                    "gift_id": gift_id,
                    "financial_note": "Les frais de cadeau ne sont pas remboursés",
                    "social_impact": "Aucun impact sur la valeur sociale (cadeau refusé)"
                }

            except OperationalError as e:
                self.db.rollback()
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock détecté, retry {retry_count}/{MAX_RETRIES}")
                    time.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                raise

            except Exception as e:
                self.db.rollback()
                logger.error(f"❌ Erreur decline_gift: {e}")
                raise

        if last_exception:
            raise last_exception

    
    def get_gift_history(self, user_id: int, gift_type: str = "received") -> List[Dict]:
        """
        Récupérer l'historique des cadeaux avec séparation legacy/new
        """
        if gift_type == "sent":
            gifts = self.db.query(GiftTransaction).filter(
                GiftTransaction.sender_id == user_id
            ).order_by(GiftTransaction.sent_at.desc()).all()
        else:  # received
            gifts = self.db.query(GiftTransaction).filter(
                GiftTransaction.receiver_id == user_id
            ).order_by(GiftTransaction.sent_at.desc()).all()
        
        result = []
        for gift in gifts:
            boom = gift.user_bom.bom if gift.user_bom else None
            sender = gift.sender
            receiver = gift.receiver
            
            gift_data = {
                "id": gift.id,
                "sender_id": gift.sender_id,
                "sender_name": sender.full_name if sender else f"User {gift.sender_id}",
                "receiver_id": gift.receiver_id,
                "receiver_name": receiver.full_name if receiver else f"User {gift.receiver_id}",
                "user_bom_id": gift.user_bom_id,
                "boom_title": boom.title if boom else "BOOM inconnu",
                "boom_image_url": boom.preview_image if boom else None,
                "message": gift.message,
                "fees": float(gift.fees) if gift.fees else 0.0,
                "status": gift.status.value,
                "is_new_flow": gift.is_new_flow,
                "sent_at": gift.sent_at.isoformat() if gift.sent_at else None,
                "accepted_at": gift.accepted_at.isoformat() if gift.accepted_at else None,
                "expires_at": gift.expires_at.isoformat() if gift.expires_at else None,
                "paid_at": gift.paid_at.isoformat() if gift.paid_at else None,
                "delivered_at": gift.delivered_at.isoformat() if gift.delivered_at else None,
                "failed_at": gift.failed_at.isoformat() if gift.failed_at else None
            }
            
            # AJOUT DES MÉTRIQUES SOCIALES
            if boom:
                gift_data["social_metrics"] = {
                    "boom_social_value": float(boom.social_value or 0),
                    "boom_share_count": boom.share_count or 0,
                    "boom_interaction_count": boom.interaction_count or 0
                }
                
                # Impact social selon le type
                if gift.is_new_flow and gift.status == GiftStatus.DELIVERED:
                    impact_delta = calculate_social_delta(boom.current_social_value or Decimal('0'), SOCIAL_GIFT_RATE)
                    gift_data["social_impact"] = {
                        "social_value_increment": float(impact_delta),
                        "impact_message": f"Ce cadeau a augmenté la valeur sociale du BOOM de +{impact_delta} FCFA"
                    }
                elif not gift.is_new_flow and gift.status == GiftStatus.ACCEPTED:
                    impact_delta = calculate_social_delta(boom.current_social_value or Decimal('0'), SOCIAL_GIFT_RATE)
                    gift_data["social_impact"] = {
                        "social_value_increment": float(impact_delta),
                        "impact_message": f"Ce cadeau legacy a augmenté la valeur sociale du BOOM de +{impact_delta} FCFA"
                    }
            
            # DÉTAILS FINANCIERS POUR NEW FLOW
            if gift.is_new_flow:
                gift_data["financial_details"] = {
                    "gross_amount": float(gift.gross_amount) if gift.gross_amount else None,
                    "fee_amount": float(gift.fee_amount) if gift.fee_amount else None,
                    "net_amount": float(gift.net_amount) if gift.net_amount else None,
                    "transaction_reference": gift.transaction_reference,
                    "wallet_transaction_ids": gift.wallet_transaction_ids or []
                }
            
            result.append(gift_data)
        
        return result
    
    def get_gift_inbox(self, user_id: int, limit: int = 50) -> Dict[str, Any]:
        """
        Vue unifiée pour la boîte aux cadeaux avec résumés live
        """
        logger.info(f"📥 Gift inbox fetch user={user_id}, limit={limit}")
        now = datetime.utcnow()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        
        raw_received_gifts = self.db.query(GiftTransaction).filter(
            GiftTransaction.receiver_id == user_id
        ).order_by(GiftTransaction.sent_at.desc()).limit(limit).all()
        
        received_gifts: List[GiftTransaction] = []
        pending_gifts: List[GiftTransaction] = []

        for gift in raw_received_gifts:
            is_new_flow_pending = gift.is_new_flow and gift.status == GiftStatus.PAID
            is_legacy_pending = (not gift.is_new_flow) and gift.status == GiftStatus.SENT

            if is_new_flow_pending or is_legacy_pending:
                pending_gifts.append(gift)
            else:
                received_gifts.append(gift)

        sent_gifts = self.db.query(GiftTransaction).filter(
            GiftTransaction.sender_id == user_id
        ).order_by(GiftTransaction.sent_at.desc()).limit(limit).all()
        
        summary = self._build_inbox_summary(
            received_gifts,
            sent_gifts,
            pending_gifts,
            start_of_day
        )
        
        return {
            "summary": summary,
            "lists": {
                "received": [
                    self._serialize_gift_entry(gift, perspective="received")
                    for gift in received_gifts
                ],
                "sent": [
                    self._serialize_gift_entry(gift, perspective="sent")
                    for gift in sent_gifts
                ],
                "pending": [
                    self._serialize_gift_entry(
                        gift,
                        perspective="received",
                        highlight_pending=True
                    )
                    for gift in pending_gifts
                ]
            }
        }
    
    def get_pending_gifts(self, user_id: int) -> List[Dict]:
        """
        Récupérer les cadeaux en attente (legacy et nouveau flow)
        """
        gifts = self.db.query(GiftTransaction).filter(
            GiftTransaction.receiver_id == user_id,
            GiftTransaction.expires_at > datetime.utcnow()
        ).order_by(GiftTransaction.sent_at.desc()).all()
        
        # Retourner format simplifié
        result = []
        for gift in gifts:
            boom = gift.user_bom.bom if gift.user_bom else None
            sender = gift.sender
            
            is_new_flow_pending = gift.is_new_flow and gift.status == GiftStatus.PAID
            is_legacy_pending = (not gift.is_new_flow) and gift.status == GiftStatus.SENT

            if not (is_new_flow_pending or is_legacy_pending):
                continue

            result.append({
                "id": gift.id,
                "sender_id": gift.sender_id,
                "sender_name": sender.full_name if sender else f"User {gift.sender_id}",
                "boom_title": boom.title if boom else "BOOM inconnu",
                "boom_image_url": boom.preview_image if boom else None,
                "message": gift.message,
                "sent_at": gift.sent_at.isoformat() if gift.sent_at else None,
                "expires_at": gift.expires_at.isoformat() if gift.expires_at else None,
                "is_new_flow": gift.is_new_flow,
                "status": gift.status.value
            })
        
        return result
    
    def expire_old_gifts(self) -> int:
        """
        Marquer les cadeaux expirés comme tels
        Traite séparément legacy et new flow
        """
        logger.info("🧹 Expiration des cadeaux anciens")
        
        expired_count = 0
        
        # 1. Cadeaux legacy expirés
        legacy_expired = self.db.query(GiftTransaction).filter(
            GiftTransaction.status == GiftStatus.SENT,
            GiftTransaction.expires_at < datetime.utcnow(),
            self._legacy_flow_clause()  # Legacy seulement
        ).all()
        
        for gift in legacy_expired:
            try:
                with self.db.begin():
                    # 🔒 Lock du cadeau
                    gift = self.db.query(GiftTransaction).filter(
                        GiftTransaction.id == gift.id
                    ).with_for_update().first()
                    
                    # Transition vers EXPIRED
                    gift.transition_to(GiftStatus.EXPIRED)
                    
                    # Rendre le BOOM à l'expéditeur
                    user_bom = gift.user_bom
                    if user_bom:
                        bom_stmt = select(UserBom).where(UserBom.id == user_bom.id).with_for_update()
                        user_bom = self.db.execute(bom_stmt).scalar_one()
                        user_bom.transferred_at = None  # 🔁 RESTAURATION
                        user_bom.is_transferable = True
                        logger.info(f"🔄 Expiration: UserBom #{user_bom.id} rendu à l'expéditeur")
                
                expired_count += 1
                
            except Exception as e:
                self.db.rollback()
                logger.warning(f"⚠️ Erreur expiration cadeau {gift.id}: {e}")
                continue
        
        # 2. Cadeaux new flow créés mais non payés (stale)
        stale_created = self.db.query(GiftTransaction).filter(
            GiftTransaction.status == GiftStatus.CREATED,
            GiftTransaction.sent_at < datetime.utcnow() - timedelta(minutes=30),
            self._new_flow_clause()
        ).all()
        
        for gift in stale_created:
            try:
                with self.db.begin():
                    gift = self.db.query(GiftTransaction).filter(
                        GiftTransaction.id == gift.id
                    ).with_for_update().first()
                    
                    # Transition vers FAILED (abandonné)
                    gift.transition_to(GiftStatus.FAILED)
                    gift.failed_at = datetime.utcnow()
                
                expired_count += 1
                
            except Exception as e:
                self.db.rollback()
                logger.warning(f"⚠️ Erreur nettoyage gift {gift.id}: {e}")
                continue
        
        logger.info(f"🧹 {expired_count} cadeaux expirés/nettoyés")
        return expired_count
    
    # === MÉTHODES PRIVÉES ===

    def _record_internal_share_interaction(
        self,
        boom: BomAsset,
        sender_id: int,
        receiver_id: int,
        gift: GiftTransaction,
        flow: str
    ) -> None:
        impact = self._compute_internal_share_impact(boom)
        if impact <= Decimal('0'):
            return

        metadata = json.dumps({
            "channel": "gift_internal_share",
            "flow": flow,
            "gift_id": gift.id,
            "sender_id": sender_id,
            "receiver_id": receiver_id,
            "accepted_at": gift.accepted_at.isoformat() if gift.accepted_at else datetime.utcnow().isoformat()
        })

        result = interaction_service.record_interaction(
            db=self.db,
            user_id=receiver_id,
            boom_id=boom.id,
            action_type='share_internal',
            metadata=metadata,
            impact_override=impact,
            auto_commit=False
        )

        if not result.get("success"):
            raise ValueError(result.get("error", "Impossible d'enregistrer l'interaction de partage interne"))

    @staticmethod
    def _compute_internal_share_impact(boom: BomAsset) -> Decimal:
        multiplier = Decimal('0.00002')  # 0,002 %
        total_value = GiftService._to_decimal(getattr(boom, 'total_value', None))
        if total_value <= 0:
            total_value = GiftService._to_decimal(boom.get_display_total_value())
        impact = (total_value * multiplier).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return max(impact, Decimal('0'))

    @staticmethod
    def _to_decimal(value: Optional[Any]) -> Decimal:
        if value is None:
            return Decimal('0')
        if isinstance(value, Decimal):
            return value
        try:
            return Decimal(str(value))
        except Exception:
            return Decimal('0')

    def _new_flow_clause(self):
        return and_(
            GiftTransaction.gross_amount.isnot(None),
            GiftTransaction.net_amount.isnot(None)
        )

    def _legacy_flow_clause(self):
        return or_(
            GiftTransaction.gross_amount.is_(None),
            GiftTransaction.net_amount.is_(None)
        )

    def _has_expired(self, expires_at: Optional[datetime]) -> bool:
        if not expires_at:
            return False

        now_utc = datetime.now(timezone.utc)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        else:
            expires_at = expires_at.astimezone(timezone.utc)

        return expires_at < now_utc

    def _credit_treasury_fee(self, gift: GiftTransaction, receiver_id: int) -> Optional[Dict[str, Decimal]]:
        fee_amount = Decimal(str(gift.fee_amount)) if gift.fee_amount else Decimal('0')
        if fee_amount <= 0:
            return None

        treasury = self.db.query(PlatformTreasury).with_for_update().first()
        if not treasury:
            treasury = PlatformTreasury(balance=Decimal('0.00'), currency="FCFA")
            self.db.add(treasury)
            self.db.flush()

        treasury.balance = (Decimal(str(treasury.balance or 0)) + fee_amount)
        treasury.total_fees_collected = (Decimal(str(treasury.total_fees_collected or 0)) + fee_amount)
        treasury.total_transactions = (treasury.total_transactions or 0) + 1
        treasury.last_transaction_at = datetime.utcnow()

        treasury_log = TreasuryTransactionLog(
            treasury_id=treasury.id,
            transaction_type="gift_fee",
            amount=fee_amount,
            currency=treasury.currency,
            description=f"Frais cadeau #{gift.id} ({gift.transaction_reference})",
            related_user_id=gift.sender_id,
            meta_data={
                "gift_id": gift.id,
                "receiver_id": receiver_id,
                "reference": gift.transaction_reference
            }
        )
        self.db.add(treasury_log)

        return {
            "amount": fee_amount,
            "treasury_id": treasury.id,
            "balance": Decimal(str(treasury.balance or 0)),
            "total_fees_collected": Decimal(str(treasury.total_fees_collected or 0))
        }

    def _broadcast_treasury_snapshot(self, snapshot: Optional[Dict[str, Decimal]]) -> None:
        if not snapshot:
            return

        payload = {
            "treasury_id": snapshot["treasury_id"],
            "balance": float(snapshot["balance"]),
            "total_fees_collected": float(snapshot["total_fees_collected"]),
            "updated_at": datetime.utcnow().isoformat()
        }

        try:
            from app.websockets import broadcast_treasury_update

            loop = asyncio.get_running_loop()
            loop.create_task(broadcast_treasury_update(payload))
        except RuntimeError:
            logger.warning("⚠️ Aucun event loop pour broadcast treasury")
        except Exception as notify_error:
            logger.error(f"⚠️ Erreur broadcast treasury: {notify_error}")

    def _broadcast_gift_social_update(
        self,
        boom: BomAsset,
        sender_id: Optional[int],
        receiver_id: Optional[int],
        social_result: Optional[Dict[str, Any]],
        gift_id: Optional[int],
        flow: str
    ) -> None:
        if not social_result or not boom:
            return

        try:
            from app.websockets import (
                broadcast_social_value_update,
                broadcast_user_notification
            )
        except ImportError:
            logger.warning("⚠️ Broadcast social indisponible pour GiftService")
            return

        import threading

        def run_broadcasts():
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

                social_task = broadcast_social_value_update(
                    boom_id=boom.id,
                    boom_title=boom.title,
                    old_value=float(social_result.get("old_social_value", 0.0)),
                    new_value=float(social_result.get("new_social_value", 0.0)),
                    delta=float(social_result.get("delta", 0.0)),
                    action="gift",
                    user_id=receiver_id
                )

                sender_task = None
                if sender_id:
                    sender_task = broadcast_user_notification(
                        user_id=sender_id,
                        notification_type="gift_social_update",
                        title="🎁 Cadeau confirmé",
                        message=f"{boom.title} a généré un impact social",
                        data={
                            "gift_id": gift_id,
                            "boom_id": boom.id,
                            "flow": flow,
                            "delta": social_result.get("delta"),
                            "new_social_value": social_result.get("new_social_value"),
                            "palier_level": social_result.get("palier_level"),
                            "treasury_pool": social_result.get("treasury_pool")
                        }
                    )

                receiver_task = None
                if receiver_id:
                    receiver_task = broadcast_user_notification(
                        user_id=receiver_id,
                        notification_type="gift_received_social",
                        title="🎉 Impact social enregistré",
                        message=f"{boom.title} progresse grâce à votre cadeau",
                        data={
                            "gift_id": gift_id,
                            "boom_id": boom.id,
                            "flow": flow,
                            "delta": social_result.get("delta"),
                            "new_social_value": social_result.get("new_social_value"),
                            "palier_level": social_result.get("palier_level")
                        }
                    )

                tasks = [social_task]
                if sender_task:
                    tasks.append(sender_task)
                if receiver_task:
                    tasks.append(receiver_task)

                loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
                loop.close()
            except Exception as ws_error:
                logger.error(f"❌ Erreur broadcast cadeau: {ws_error}")

        thread = threading.Thread(
            target=run_broadcasts,
            name=f"GiftSocialBroadcast-{boom.id}-{gift_id or 'na'}"
        )
        thread.daemon = True
        thread.start()

    def _restore_user_bom_to_sender(self, user_bom: Optional[UserBom]) -> None:
        if not user_bom:
            return
        user_bom.transferred_at = None
        user_bom.deleted_at = None
        user_bom.is_transferable = True
        user_bom.is_sold = False
        user_bom.receiver_id = None

    def _append_wallet_transaction_id(self, gift_id: int, transaction_id: Any) -> None:
        if not transaction_id:
            return
        with self.db.begin():
            gift = (
                self.db.query(GiftTransaction)
                .filter(GiftTransaction.id == gift_id)
                .with_for_update()
                .first()
            )
            if not gift:
                return
            existing_ids = list(gift.wallet_transaction_ids or [])
            if transaction_id in existing_ids:
                return
            existing_ids.append(transaction_id)
            gift.wallet_transaction_ids = existing_ids

    def _fetch_wallet_transaction_ids(self, gift_id: int) -> List[Any]:
        gift = self.db.query(GiftTransaction).filter(GiftTransaction.id == gift_id).first()
        if not gift:
            return []
        return list(gift.wallet_transaction_ids or [])

    def _notify_new_flow_acceptance(self, gift: GiftTransaction, boom: BomAsset, receiver_id: int, net_amount: float) -> None:
        sender = gift.sender or self.db.query(User).filter(User.id == gift.sender_id).first()
        receiver = gift.receiver or self.db.query(User).filter(User.id == receiver_id).first()
        sender_name = sender.full_name if sender and sender.full_name else f"User {gift.sender_id}"
        receiver_name = receiver.full_name if receiver and receiver.full_name else f"User {receiver_id}"

        notification_data = {
            "gift_id": gift.id,
            "boom_id": boom.id,
            "boom_title": boom.title,
            "net_amount": net_amount,
            "status": gift.status.value
        }

        self._send_notification_async(
            receiver_id,
            "gift_acceptance_success",
            "🎁 Cadeau confirmé",
            f"'{boom.title}' a été ajouté à votre inventaire.",
            notification_data
        )

        self._send_notification_async(
            gift.sender_id,
            "gift_delivered",
            f"{receiver_name} a accepté votre cadeau",
            f"'{boom.title}' est désormais livré.",
            {**notification_data, "receiver_name": receiver_name, "sender_name": sender_name}
        )

    def _send_notification_async(
        self,
        user_id: Optional[int],
        notification_type: str,
        title: str,
        message: str,
        data: Optional[Dict[str, Any]] = None
    ) -> None:
        if not user_id:
            return
        try:
            from app.websockets import broadcast_user_notification

            loop = asyncio.get_running_loop()
            loop.create_task(broadcast_user_notification(
                user_id=user_id,
                notification_type=notification_type,
                title=title,
                message=message,
                data=data or {}
            ))
        except RuntimeError:
            logger.warning(f"⚠️ Aucun event loop pour notification user {user_id}")
        except Exception as notify_error:
            logger.error(f"⚠️ Erreur notification user {user_id}: {notify_error}")
    
    def _build_inbox_summary(
        self,
        received_gifts: List[GiftTransaction],
        sent_gifts: List[GiftTransaction],
        pending_gifts: List[GiftTransaction],
        start_of_day: datetime
    ) -> Dict[str, Any]:
        total_received_value = Decimal('0')
        total_fees_paid = Decimal('0')
        received_today = 0
        sent_today = 0
        delivered_count = 0
        new_flow_received = 0
        last_received_at = None
        
        for gift in received_gifts:
            sent_at_norm = self._normalize_datetime(gift.sent_at)
            if sent_at_norm and sent_at_norm >= start_of_day:
                received_today += 1
            if gift.status in (GiftStatus.DELIVERED, GiftStatus.ACCEPTED):
                delivered_count += 1
                if gift.net_amount:
                    total_received_value += gift.net_amount
                elif gift.user_bom and gift.user_bom.bom:
                    total_received_value += Decimal(str(gift.user_bom.bom.get_display_total_value()))
            if gift.is_new_flow:
                new_flow_received += 1
            if not last_received_at and gift.sent_at:
                last_received_at = gift.sent_at
        
        for gift in sent_gifts:
            sent_at_norm = self._normalize_datetime(gift.sent_at)
            if sent_at_norm and sent_at_norm >= start_of_day:
                sent_today += 1
            if gift.is_new_flow and gift.fee_amount:
                total_fees_paid += gift.fee_amount
            elif gift.fees:
                total_fees_paid += gift.fees
        
        return {
            "pending_count": len(pending_gifts),
            "received_today": received_today,
            "sent_today": sent_today,
            "delivered_count": delivered_count,
            "new_flow_received": new_flow_received,
            "total_value_received": self._format_decimal(total_received_value),
            "total_fees_paid": self._format_decimal(total_fees_paid),
            "last_received_at": last_received_at.isoformat() if last_received_at else None,
            "needs_attention": len(pending_gifts) > 0
        }

    def _serialize_gift_entry(
        self,
        gift: GiftTransaction,
        perspective: str,
        highlight_pending: bool = False
    ) -> Dict[str, Any]:
        boom = gift.user_bom.bom if gift.user_bom else None
        status_meta = self._status_metadata(gift.status)
        direction = "incoming" if perspective == "received" else "outgoing"
        
        financial_block: Dict[str, Any]
        if gift.is_new_flow:
            financial_block = {
                "gross_amount": self._format_decimal(gift.gross_amount),
                "fee_amount": self._format_decimal(gift.fee_amount),
                "net_amount": self._format_decimal(gift.net_amount),
                "currency": "FCFA",
                "transaction_reference": gift.transaction_reference,
                "wallet_transaction_ids": gift.wallet_transaction_ids or []
            }
        else:
            current_value = Decimal(str(boom.get_display_total_value())) if boom else None
            financial_block = {
                "estimated_value": self._format_decimal(current_value),
                "fee_amount": self._format_decimal(gift.fees),
                "currency": "FCFA",
                "transaction_reference": gift.transaction_reference
            }
        
        social_block = None
        if boom:
            social_block = {
                "social_value": self._format_decimal(boom.social_value),
                "current_market_value": self._format_decimal(boom.get_display_total_value()),
                "share_count": boom.share_count or 0,
                "interaction_count": boom.interaction_count or 0
            }
        
        people_block = {
            "sender": {
                "id": gift.sender_id,
                "name": gift.sender.full_name if gift.sender else f"User {gift.sender_id}"
            },
            "receiver": {
                "id": gift.receiver_id,
                "name": gift.receiver.full_name if gift.receiver else f"User {gift.receiver_id}"
            }
        }
        
        is_new_flow_pending = gift.is_new_flow and gift.status == GiftStatus.PAID
        is_legacy_pending = (not gift.is_new_flow) and gift.status == GiftStatus.SENT

        actions_block = {
            "can_accept": direction == "incoming" and (is_new_flow_pending or is_legacy_pending),
            "can_decline": direction == "incoming" and (is_new_flow_pending or is_legacy_pending),
            "can_view_details": True
        }
        
        decline_ts = None
        if gift.status in (GiftStatus.DECLINED, GiftStatus.FAILED) and gift.failed_at:
            decline_ts = gift.failed_at.isoformat()

        timeline_block = {
            "sent_at": gift.sent_at.isoformat() if gift.sent_at else None,
            "paid_at": gift.paid_at.isoformat() if gift.paid_at else None,
            "delivered_at": gift.delivered_at.isoformat() if gift.delivered_at else None,
            "accepted_at": gift.accepted_at.isoformat() if gift.accepted_at else None,
            "declined_at": decline_ts,
            "expires_at": gift.expires_at.isoformat() if gift.expires_at else None
        }
        
        boom_payload = None
        if boom:
            boom_payload = {
                "id": boom.id,
                "title": boom.title,
                "preview_image": boom.preview_image,
                "collection": getattr(boom, "collection_name", None) or "Non classé",
                "category": boom.category,
                "animation_url": boom.animation_url,
                "rarity": getattr(boom, "rarity", None)
            }
        
        return {
            "id": gift.id,
            "status": gift.status.value,
            "status_label": status_meta["label"],
            "status_tone": status_meta["tone"],
            "is_new_flow": gift.is_new_flow,
            "message": gift.message,
            "direction": direction,
            "highlight_pending": highlight_pending,
            "quantity": getattr(gift.user_bom, "quantity", 1),
            "people": people_block,
            "financial": financial_block,
            "social": social_block,
            "boom": boom_payload,
            "timeline": timeline_block,
            "actions": actions_block
        }

    def _status_metadata(self, status: GiftStatus) -> Dict[str, str]:
        mapping = {
            GiftStatus.SENT: {"label": "En attente", "tone": "info"},
            GiftStatus.CREATED: {"label": "Créé", "tone": "info"},
            GiftStatus.PAID: {"label": "Payé", "tone": "info"},
            GiftStatus.DELIVERED: {"label": "Livré", "tone": "success"},
            GiftStatus.ACCEPTED: {"label": "Accepté", "tone": "success"},
            GiftStatus.DECLINED: {"label": "Refusé", "tone": "danger"},
            GiftStatus.EXPIRED: {"label": "Expiré", "tone": "muted"},
            GiftStatus.FAILED: {"label": "Échec", "tone": "danger"}
        }
        return mapping.get(status, {"label": status.value.title(), "tone": "info"})

    def _format_decimal(self, value: Optional[Decimal]) -> Optional[float]:
        if value is None:
            return None
        return float(value)

    def _normalize_datetime(self, value: Optional[datetime]) -> Optional[datetime]:
        if not value:
            return None
        if value.tzinfo:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def _has_recent_accepted_gift(self, user_bom_id: int) -> bool:
        """
        Vérifie si ce BOOM a déjà été offert et accepté dans les 24h
        Empêche le spam de cadeaux
        """
        recent = self.db.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id == user_bom_id,
            GiftTransaction.sent_at >= datetime.utcnow() - timedelta(hours=24),
            GiftTransaction.status.in_([GiftStatus.ACCEPTED, GiftStatus.DELIVERED])
        ).first()
        
        return recent is not None

    def _has_active_transfer(self, user_bom_id: int) -> bool:
        """Empêche plusieurs cadeaux simultanés sur la même possession."""
        active_statuses = [
            GiftStatus.CREATED,
            GiftStatus.PAID,
            GiftStatus.SENT
        ]
        existing = self.db.query(GiftTransaction.id).filter(
            GiftTransaction.user_bom_id == user_bom_id,
            GiftTransaction.status.in_(active_statuses)
        ).first()
        return existing is not None
    
    def _calculate_sharing_fee(self, boom_value: Decimal, sender_id: int) -> Decimal:
        """
        Calculer les frais de partage
        Basé sur la valeur du BOOM et le niveau de l'utilisateur
        """
        base_fee = boom_value * Decimal('0.02')
        
        user_level = self._get_user_level(sender_id)
        reduction_multiplier = {
            "bronze": 1.0,
            "silver": 0.9,
            "gold": 0.85,
            "platinum": 0.8
        }.get(user_level, 1.0)
        
        final_fee = base_fee * Decimal(str(reduction_multiplier))
        
        min_fee = Decimal('100.00')
        max_fee = Decimal('5000.00')
        
        return max(min_fee, min(final_fee, max_fee))
    
    def _get_user_level(self, user_id: int) -> str:
        """
        Déterminer le niveau de l'utilisateur
        """
        from app.models.bom_models import UserBom
        
        boom_count = self.db.query(UserBom).filter(
            UserBom.user_id == user_id,
            UserBom.is_transferable == True,
            UserBom.transferred_at.is_(None)  # 🔥 FILTRE CRITIQUE
        ).count()
        
        if boom_count >= 50:
            return "platinum"
        elif boom_count >= 20:
            return "gold"
        elif boom_count >= 5:
            return "silver"
        else:
            return "bronze"
    
    def _update_boom_social_metrics(self, boom_id: int):
        """
        Mettre à jour les métriques sociales d'un BOOM
        """
        boom = self.db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if boom:
            boom.update_social_metrics(self.db)
    
    def _calculate_value_change(self, boom_id: int) -> float:
        """
        Calculer le changement de valeur dû à l'interaction sociale
        """
        boom = self.db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if not boom:
            return 0.0
        
        share_bonus = min(boom.share_count_24h * 0.01, 0.15)
        
        if boom.gift_acceptance_rate:
            acceptance_rate = float(boom.gift_acceptance_rate)
            acceptance_bonus = max(0, (acceptance_rate - 0.5) * 0.1)
        else:
            acceptance_bonus = 0.0
        
        total_bonus = share_bonus + acceptance_bonus
        
        return total_bonus
    
    def _update_contact(self, user_id: int, contact_user_id: int):
        """
        Créer ou mettre à jour un contact
        """
        existing = self.db.query(Contact).filter(
            Contact.user_id == user_id,
            Contact.contact_user_id == contact_user_id
        ).first()
        
        if not existing:
            contact = Contact(
                user_id=user_id,
                contact_user_id=contact_user_id
            )
            self.db.add(contact)
    
    def _create_acceptance_notification(self, sender_id: int, receiver_name: str, boom_title: str):
        """
        Créer une notification pour l'expéditeur
        À implémenter avec votre système de notifications
        """
        pass
"""
SERVICE D'ACHAT BOOMS - VERSION SOCIALE 100% SÉCURISÉE
Gestion des achats avec impact sur la valeur sociale
Version atomique avec locks exclusifs et retry sur deadlock
"""

import logging
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, IntegrityError
import uuid
import asyncio
import time
import threading

from app.models.user_models import User, Wallet
from app.models.bom_models import BomAsset, UserBom, NFTCollection
from app.models.admin_models import PlatformTreasury
from app.models.transaction_models import Transaction
from app.models.payment_models import CashBalance 
from app.services.wallet_service import has_sufficient_funds
from app.services.wallet_service import get_platform_treasury 
from app.services.social_value_calculator import SocialValueCalculator
from app.services.social_value_utils import (
    calculate_social_delta,
)
from app.websockets.websockets import broadcast_balance_update

from app.services.treasury_debug import (
    trace_treasury_movement,
    trace_boom_purchase_decomposition
)
# Import WebSocket avec gestion d'erreur
try:
    from app.websockets import (
        broadcast_social_value_update, 
        broadcast_user_notification,
        broadcast_market_update,
        websocket_manager
    )
    WEBSOCKET_ENABLED = True
    logger = logging.getLogger(__name__)
    logger.info("✅ WebSocket imports disponibles pour PurchaseService")
except ImportError as e:
    WEBSOCKET_ENABLED = False
    logger = logging.getLogger(__name__)
    logger.warning(f"⚠️ WebSocket imports non disponibles: {e}")

logger = logging.getLogger(__name__)

# ============ CONSTANTES DE SÉCURITÉ ============
MAX_RETRIES = 3
DEADLOCK_RETRY_DELAY = 0.1
LOCK_TIMEOUT = 30  # secondes

# ============ CONSTANTES FINANCIÈRES ============
DECIMAL_2 = Decimal("0.01")
DECIMAL_6 = Decimal("0.000001")
FEE_RATE = Decimal("0.05")  # 5%
SOCIAL_PRIMARY_BUY_RATE = Decimal("0.0025")   # 0.25% du coût total
SOCIAL_SECONDARY_BUY_RATE = Decimal("0.0015")  # 0.15% en marché secondaire
SOCIAL_TRANSFER_RATE = Decimal("0.0005")      # 0.05% pour un transfert/partage


class PurchaseService:
    def __init__(self, db: Session):
        self.db = db
        self.websocket_enabled = WEBSOCKET_ENABLED
        logger.info(f"✅ PurchaseService initialisé (DB session: {id(db)}, WebSocket: {'ACTIVÉ' if self.websocket_enabled else 'DÉSACTIVÉ'})")
    
    async def purchase_bom(self, user_id: int, bom_id: int, token_id: str = None, quantity: int = 1) -> Dict:
        """
        Acheter un BOOM avec calcul de valeur sociale
        Version 100% sécurisée avec transactions atomiques et locks
        """
        transaction_start = datetime.utcnow()
        logger.info(f"🛒 PURCHASE START - User:{user_id}, Boom:{bom_id}, Token:{token_id}, Qty:{quantity}")
        logger.debug(f"   Transaction ID: {str(uuid.uuid4())[:8]}")
        social_action_result = None
        
        # === DÉBUT DU DEBUG TRÉSORERIE ===
        try:
            from app.services.treasury_debug import (
                trace_treasury_movement,
                trace_boom_purchase_decomposition
            )
            DEBUG_ENABLED = True
            logger.info("🔍 DEBUG TRÉSORERIE ACTIVÉ dans purchase_service")
        except ImportError:
            DEBUG_ENABLED = False
            logger.warning("⚠️ Module treasury_debug non disponible, tracing désactivé")
        # === FIN DU DEBUG TRÉSORERIE ===
        
        # === TRANSACTION ATOMIQUE AVEC RETRY ===
        retry_count = 0
        last_exception = None
        
        while retry_count < MAX_RETRIES:
            try:
                # Début de la transaction atomique globale
                with self.db.begin_nested():
                    
                    # === ORDRE DÉTERMINISTE DES LOCKS (POUR ÉVITER LES DEADLOCKS) ===
                    
                    # 1. Chercher le BOOM avec lock
                    if token_id:
                        boom_stmt = select(BomAsset).where(
                            BomAsset.token_id == token_id,
                            BomAsset.is_active == True,
                            BomAsset.is_tradable == True
                        ).with_for_update()
                    else:
                        boom_stmt = select(BomAsset).where(
                            BomAsset.id == bom_id,
                            BomAsset.is_active == True,
                            BomAsset.is_tradable == True
                        ).with_for_update()
                    
                    boom = self.db.execute(boom_stmt).scalar_one_or_none()
                    
                    if not boom:
                        logger.error(f"❌ BOOM non trouvé (ID:{bom_id}, Token:{token_id})")
                        raise ValueError("BOOM non trouvé ou indisponible")
                    
                    logger.info(f"🎨 BOOM trouvé et locké: {boom.title} (ID:{boom.id})")
                    
                    # 2. Vérifier disponibilité (après lock)
                    self._check_availability(boom, quantity)
                    logger.debug("✅ Disponibilité vérifiée après lock")
                    
                    # 3. Calculer la valeur sociale actuelle
                    social_calculator = SocialValueCalculator(self.db)
                    current_social_value = social_calculator.calculate_current_value(boom.id)
                    
                    logger.debug(f"💰 Valeur sociale actuelle: {current_social_value} FCFA")
                    
                    # 4. Calculer le prix d'achat (valeur sociale uniquement)
                    # CORRECTION: _calculate_purchase_price retourne UNIQUEMENT la valeur sociale
                    social_value_price = self._calculate_purchase_price(current_social_value, user_id)
                    
                    # CORRECTION FINANCIÈRE: Utiliser Decimal pour tous les calculs
                    social_value_price_decimal = Decimal(str(social_value_price)).quantize(DECIMAL_2, ROUND_HALF_UP)
                    quantity_decimal = Decimal(str(quantity)).quantize(DECIMAL_2, ROUND_HALF_UP)
                    current_social_value_decimal = Decimal(str(current_social_value)).quantize(DECIMAL_6, ROUND_HALF_UP)
                    
                    # CALCULS FINANCIERS CORRECTS
                    # CORRECTION: total_cost = (valeur sociale + frais) * quantité
                    social_total = (social_value_price_decimal * quantity_decimal).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    # CORRECTION: Appliquer la réduction de frais selon le niveau utilisateur
                    fee_reduction = self._get_user_fee_reduction(user_id)
                    fees_amount = (social_total * FEE_RATE * (Decimal("1.0") - fee_reduction)).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    # CORRECTION CRITIQUE: Le total payé = valeur sociale + frais
                    total_cost = (social_total + fees_amount).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    # CORRECTION: Valeur sociale à verser dans locked_social_value
                    social_amount = social_total  # C'est déjà socialTotal
                    
                    logger.info(f"💰 Calculs financiers (CORRIGÉS):")
                    logger.info(f"   Valeur sociale: {current_social_value_decimal} FCFA")
                    logger.info(f"   Social total: {social_total} FCFA")
                    logger.info(f"   Frais BOOMS: {fees_amount} FCFA")
                    logger.info(f"   Total coût: {total_cost} FCFA")
                    logger.info(f"   Valeur sociale: {social_amount} FCFA")
                    logger.info(f"   Vérification: {social_amount} + {fees_amount} = {social_amount + fees_amount} FCFA")
                    
                    # 5. Lock du wallet utilisateur - PATCH APPLIQUÉ
                    wallet_stmt = select(Wallet).where(Wallet.user_id == user_id).with_for_update()
                    wallet = self.db.execute(wallet_stmt).scalar_one_or_none()
                    
                    if not wallet:
                        logger.warning(f"💳 Création wallet pour user {user_id}")
                        # PATCH APPLIQUÉ: Suppression de wallet_type
                        wallet = Wallet(user_id=user_id, balance=Decimal('0.00'), currency="FCFA")
                        self.db.add(wallet)
                    
                    logger.info(f"👛 Wallet trouvé et locké pour user {user_id}")
                    
                    # 6. Vérifier les fonds RÉELS (APRÈS lock) - CORRECTION CRITIQUE
                    # Récupérer solde RÉEL (CashBalance) avec lock
                    cash_stmt = select(CashBalance).where(CashBalance.user_id == user_id).with_for_update()
                    cash_balance = self.db.execute(cash_stmt).scalar_one_or_none()
                    
                    if not cash_balance:
                        # Créer CashBalance si inexistant
                        cash_balance = CashBalance(
                            user_id=user_id,
                            available_balance=Decimal('0.00'),
                            locked_balance=Decimal('0.00'),
                            currency="FCFA",
                            created_at=datetime.utcnow()
                        )
                        self.db.add(cash_balance)
                    
                    real_balance = cash_balance.available_balance or Decimal('0.00')
                    
                    if real_balance < total_cost:
                        missing = total_cost - real_balance
                        logger.error(f"❌ Solde RÉEL insuffisant pour user {user_id}. Nécessaire: {total_cost} FCFA, Disponible: {real_balance} FCFA")
                        raise ValueError(f"Solde RÉEL insuffisant. Manquant: {missing} FCFA")
                    
                    logger.info(f"✅ Solde RÉEL suffisant pour user {user_id}: {real_balance} FCFA")
                    
                    # 7. Récupérer l'utilisateur
                    user = self.db.query(User).filter(User.id == user_id).first()
                    if not user:
                        logger.error(f"❌ Utilisateur {user_id} non trouvé")
                        raise ValueError("Utilisateur non trouvé")
                    
                    user_display = f"User_{user.id} (phone: {user.phone})"
                    logger.debug(f"👤 Utilisateur trouvé: {user_display}")
                    
                    # 8. Lock de la trésorerie
                    treasury_stmt = select(PlatformTreasury).with_for_update()
                    treasury = self.db.execute(treasury_stmt).scalar_one_or_none()
                    
                    if not treasury:
                        # CORRECTION: Initialiser sans locked_social_value
                        treasury = PlatformTreasury(
                            balance=Decimal('0.00'), 
                            currency="FCFA"
                        )
                        self.db.add(treasury)
                    
                    # Sauvegarder les valeurs avant modification
                    old_social_value = boom.social_value or Decimal('0.000000')
                    old_owner_id = boom.owner_id
                    old_edition = boom.current_edition
                    old_real_balance = real_balance
                    old_treasury_balance = treasury.balance
                    
                    # === TRACING DÉTAILLÉ DE LA DÉCOMPOSITION ===
                    if DEBUG_ENABLED:
                        trace_boom_purchase_decomposition(
                            db=self.db,
                            user_id=user_id,
                            boom_id=boom.id,
                            buy_price=social_value_price,
                            social_value=current_social_value,
                            quantity=quantity
                        )
                    
                    # === TRACING AVANT TRANSACTION ===
                    if DEBUG_ENABLED:
                        trace_treasury_movement(
                            db=self.db,
                            operation="purchase_service_start",
                            amount=Decimal('0'),
                            description=f"DEBUG: Début transaction achat BOOM #{boom.id}",
                            user_id=user_id
                        )
                    
                    # CORRECTION CRITIQUE: MOUVEMENTS FINANCIERS COMPLETS
                    # 9. DÉBIT CASHBALANCE UNIQUEMENT - CORRECTION APPLIQUÉE
                    old_real_balance = real_balance
                    cash_balance.available_balance = (real_balance - total_cost).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    # NE PAS TOUCHER AU WALLET VIRTUEL ICI
                    # Le wallet.balance reste inchangé (argent virtuel)
                    
                    logger.info(f"💳 DÉBIT CASHBALANCE (RÉEL): {old_real_balance} → {cash_balance.available_balance} FCFA (-{total_cost})")
                    logger.info(f"📝 WALLET VIRTUEL: Aucun mouvement (resté à {wallet.balance} FCFA)")
                    
                    # CORRECTION CRITIQUE: GESTION DE LA VALEUR SOCIALE
                    # 10. CRÉDIT TRÉSORERIE DES FRAIS
                    treasury.balance = (treasury.balance + fees_amount).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    # 11. CRÉDIT DES FRAIS COLLECTÉS
                    platform_fee = (total_cost - social_amount).quantize(DECIMAL_2, ROUND_HALF_UP)
                    if hasattr(treasury, 'fees_collected'):
                        treasury.fees_collected = (treasury.fees_collected + platform_fee).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    logger.info(f"💰 Trésorerie mise à jour:")
                    logger.info(f"   Balance: {old_treasury_balance} → {treasury.balance} FCFA (+{fees_amount})")
                    logger.info(f"   Frais collectés: +{platform_fee} FCFA")
                    
                    # === TRACING APRÈS CRÉDIT TRÉSORIE ===
                    if DEBUG_ENABLED:
                        trace_treasury_movement(
                            db=self.db,
                            operation="purchase_service_fees_AFTER",
                            amount=fees_amount,
                            description=f"CRÉDIT RÉEL: Frais via PurchaseService | Ancien solde: {old_treasury_balance}",
                            user_id=user_id
                        )
                    
                    # 12. Créer la transaction - CORRECTION : DIRECTEMENT dans PurchaseService
                    transaction = Transaction(
                        user_id=user_id,
                        type="boom_purchase",  # ✅ FIXE: Champ type obligatoire
                        amount=float(total_cost),  # CORRECTION: Pour le modèle, mais Decimal en interne
                        transaction_type="boom_purchase",
                        description=(
                            f"Achat BOOM: {boom.title} "
                            f"(Token: {boom.token_id}) | "
                            f"Valeur sociale: {social_amount} FCFA | "
                            f"Frais BOOMS: {fees_amount} FCFA | "
                            f"Total débité: {total_cost} FCFA"
                        ),
                        status="completed",
                        created_at=datetime.utcnow()
                    )
                    
                    self.db.add(transaction)
                    self.db.flush()   # 🔴 CRITIQUE: flush pour obtenir l'ID (si besoin plus bas)
                    
                    logger.info(f"💳 Transaction créée directement: {transaction.id}")
                    logger.info(f"📝 Description transaction: {transaction.description}")
                    
                    # 13. Mettre à jour la propriété si édition unique
                    if boom.max_editions == 1:
                        boom.owner_id = user_id
                        boom.current_edition = 1
                        logger.info(f"👤 Propriétaire unique mis à jour: {old_owner_id} → {user_id}")
                    else:
                        # Incrémenter le numéro d'édition
                        boom.current_edition = (boom.current_edition or 0) + quantity
                        
                        # Mettre à jour les éditions disponibles
                        if boom.available_editions is not None:
                            boom.available_editions = max(0, boom.available_editions - quantity)
                    
                    logger.debug(f"📊 Édition mise à jour: {old_edition} → {boom.current_edition}/{boom.max_editions}")
                    
                    # 14. Créer les enregistrements de possession
                    user_boms = []
                    per_unit_fee = Decimal('0.00')
                    if quantity_decimal > 0:
                        per_unit_fee = (fees_amount / quantity_decimal).quantize(DECIMAL_2, ROUND_HALF_UP)

                    starting_market_value = Decimal(str(boom.get_display_total_value()))

                    for i in range(quantity):
                        user_bom = UserBom(
                            user_id=user_id,
                            bom_id=boom.id,
                            transfer_id=str(uuid.uuid4()),
                            purchase_price=social_value_price_decimal,
                            current_value=starting_market_value,
                            fees_paid=per_unit_fee,
                            acquired_at=datetime.utcnow()
                        )
                        self.db.add(user_bom)
                        user_boms.append(user_bom)
                        logger.debug(f"📦 UserBom créé #{i+1} (ID: {user_bom.id}) pour user {user_id}")
                    
                    # 15. Mettre à jour les statistiques de collection
                    self._update_collection_stats(boom, quantity, social_amount)
                    
                    # ✅ 16. MISE À JOUR DE LA VALEUR SOCIALE
                    social_metadata = {
                        "transaction_amount": float(total_cost),
                        "quantity": quantity,
                        "channel": "primary_purchase"
                    }
                    social_action_result, _ = social_calculator.apply_social_action(
                        boom=boom,
                        action='buy',
                        user_id=user_id,
                        metadata=social_metadata,
                        create_history=True
                    )
                    social_increment = social_action_result["delta"]

                    updated_market_value = Decimal(str(boom.get_display_total_value()))
                    for created_bom in user_boms:
                        created_bom.current_value = updated_market_value
                    
                    # 17. Mettre à jour le score social
                    boom.social_score = Decimal('1.000')
                    
                    # 18. Mettre à jour les métriques sociales
                    if hasattr(boom, 'update_social_metrics'):
                        try:
                            boom.update_social_metrics(self.db)
                            logger.debug("✅ Métriques sociales mises à jour")
                        except Exception as metrics_error:
                            logger.warning(f"⚠️ Erreur mise à jour métriques sociales: {metrics_error}")
                    
                    # === TRACING AVANT COMMIT ===
                    if DEBUG_ENABLED:
                        logger.info("📝 RÉSUMÉ PURCHASE_SERVICE AVANT COMMIT:")
                        logger.info(f"   BOOM: {boom.title} (ID: {boom.id})")
                        logger.info(f"   Total payé: {total_cost} FCFA")
                        logger.info(f"   Frais collectés: {fees_amount} FCFA")
                        logger.info(f"   Valeur sociale: {social_amount} FCFA")
                        logger.info(f"   DÉCOMPOSITION: {total_cost} = {fees_amount} + {social_amount}")
                        logger.info(f"   Valeur sociale: {old_social_value} → {boom.social_value}")
                        logger.info(f"   CashBalance user: {old_real_balance} → {cash_balance.available_balance}")
                        logger.info(f"   Treasury balance: {old_treasury_balance} → {treasury.balance}")
                
                # === COMMIT GLOBAL ===
                try:
                    self.db.commit()
                except Exception as commit_error:
                    self.db.rollback()
                    logger.error(f"❌ Erreur commit: {commit_error}")
                    raise
                
                # === TRACING APRÈS COMMIT ===
                if DEBUG_ENABLED:
                    logger.info("✅ PURCHASE_SERVICE COMMIT RÉUSSI")
                    trace_treasury_movement(
                        db=self.db,
                        operation="purchase_service_complete",
                        amount=Decimal('0'),
                        description=f"Transaction complète BOOM #{boom.id} | Frais: {fees_amount}",
                        user_id=user_id
                    )
                
                transaction_duration = (datetime.utcnow() - transaction_start).total_seconds()
                logger.info(f"✅ Achat BOOM réussi en {transaction_duration:.2f}s")
                logger.info(f"   🎨 BOOM: {boom.title}")
                user_display = f"User_{user_id} (phone: {user.phone})"
                logger.info(f"👤 Utilisateur: {user_display}")
                logger.info(f"   💰 Coût total: {total_cost} FCFA")
                logger.info(f"   🏆 Édition: {boom.current_edition}/{boom.max_editions}")
                logger.info(f"   📊 Valeur sociale: {old_social_value} → {boom.social_value}")
                logger.info(f"   📈 Incrément social: +{social_increment} FCFA")
                logger.info(f"   🏷️ Frais payés: {fees_amount} FCFA")
                logger.info(f"   💳 Débité (RÉEL): {old_real_balance} → {cash_balance.available_balance} FCFA")
                
                # 19. Récupérer et broadcast le nouveau solde
                if self.websocket_enabled:
                    try:
                        from app.websockets.websockets import broadcast_balance_update
                        
                        def broadcast_balance_async():
                            try:
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                                # PATCH 1: Envoyer le solde RÉEL (CashBalance)
                                loop.run_until_complete(broadcast_balance_update(user_id, str(cash_balance.available_balance)))
                                loop.close()
                                logger.info(f"💰 Broadcast solde RÉEL envoyé: user {user_id} → {cash_balance.available_balance} FCFA")
                            except Exception as broadcast_error:
                                logger.warning(f"⚠️ Erreur broadcast solde: {broadcast_error}")
                        
                        balance_thread = threading.Thread(
                            target=broadcast_balance_async,
                            name=f"Balance-Broadcast-User-{user_id}"
                        )
                        balance_thread.daemon = True
                        balance_thread.start()
                    except Exception as ws_error:
                        logger.warning(f"⚠️ Erreur préparation broadcast solde: {ws_error}")
                
                # 20. BROADCAST WEB SOCKET (asynchrone, non bloquant)
                self._trigger_websocket_broadcasts(
                    boom=boom,
                    user_id=user_id,
                    social_result=social_action_result,
                    quantity=quantity,
                    total_cost=total_cost
                )
                
                # 21. Rafraîchir les objets
                self.db.refresh(boom)
                for ub in user_boms:
                    self.db.refresh(ub)
                
                # 22. Préparer réponse
                response = self._prepare_purchase_response(
                    boom=boom,
                    user_id=user_id,
                    quantity=quantity,
                    social_value_price=social_value_price_decimal,
                    social_value=current_social_value_decimal,
                    fees_amount=fees_amount,
                    social_amount=social_amount,
                    total_cost=total_cost,
                    user_boms=user_boms,
                    transaction_duration=transaction_duration,
                    cash_balance_after=cash_balance.available_balance,
                    treasury_balance=treasury.balance,
                    social_increment=social_increment,
                    old_social_value=old_social_value,
                    transaction_id=transaction.id
                )
                
                # === AJOUT DES DONNÉES DEBUG À LA RÉPONSE ===
                if DEBUG_ENABLED:
                    response["purchase_service_debug"] = {
                        "tracing_enabled": True,
                        "service": "PurchaseService",
                        "financial_correction_applied": True,
                        "fees_correctly_attributed": float(fees_amount),
                        "social_value": float(social_amount),
                        "decomposition_verified": True,
                        "decomposition_details": {
                            "total_paid": float(total_cost),
                            "social_value_portion": float(social_amount),
                            "fees_portion": float(fees_amount),
                            "check_total": float(social_amount + fees_amount)
                        },
                        "balance_changes": {
                            "wallet_old": float(old_real_balance),
                            "wallet_new": float(cash_balance.available_balance),
                            "wallet_delta": -float(total_cost),
                            "treasury_old": float(old_treasury_balance),
                            "treasury_new": float(treasury.balance),
                            "treasury_delta": float(fees_amount)
                        },
                        "debug_timestamp": datetime.utcnow().isoformat()
                    }
                    
                    # Vérification automatique
                    expected_total = social_amount + fees_amount
                    if total_cost == expected_total:
                        response["purchase_service_debug"]["financial_check"] = "✅ CORRECT"
                    else:
                        response["purchase_service_debug"]["financial_check"] = f"❌ ERREUR: {total_cost} ≠ {expected_total}"
                
                return response
                    
            except OperationalError as e:
                self.db.rollback()
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock détecté dans purchase_bom, retry {retry_count}/{MAX_RETRIES}")
                    await asyncio.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                else:
                    logger.error(f"❌ Erreur opérationnelle purchase_bom: {e}")
                    raise
            except IntegrityError as e:
                self.db.rollback()
                logger.error(f"❌ Erreur intégrité purchase_bom: {e}")
                raise ValueError(f"Erreur achat (intégrité): {str(e)}")
            except Exception as e:
                self.db.rollback()
                logger.error(f"❌ Erreur transaction achat: {str(e)}", exc_info=True)
                
                # === TRACING EN CAS D'ERREUR ===
                if DEBUG_ENABLED:
                    trace_treasury_movement(
                        db=self.db,
                        operation="purchase_service_error",
                        amount=Decimal('0'),
                        description=f"ERREUR: {str(e)[:100]}",
                        user_id=user_id
                    )
                
                raise
        
        if last_exception:
            logger.error(f"❌ Échec après {MAX_RETRIES} retries pour purchase_bom")
            raise last_exception
    
    async def execute_sell(self, seller_id: int, buyer_id: int, user_bom_id: int, sell_price: float) -> Dict:
        """
        Vente BOOM — SYMÉTRIQUE À L'ACHAT
        RÈGLES :
        - Débit acheteur
        - Crédit vendeur (net)
        - Wallet virtuel : JAMAIS touché
        - Frais → trésorerie
        """
        logger.info(f"💰 SELL START - Seller:{seller_id}, Buyer:{buyer_id}, UserBom:{user_bom_id}, Price:{sell_price}")
        sell_start = datetime.utcnow()
        social_calculator = SocialValueCalculator(self.db)
        social_action_result = None
        serialized_social_result = None
        
        # === TRANSACTION ATOMIQUE AVEC RETRY ===
        retry_count = 0
        last_exception = None
        
        while retry_count < MAX_RETRIES:
            try:
                with self.db.begin_nested():
                    # === ORDRE DÉTERMINISTE DES LOCKS ===
                    
                    # 1. Lock du UserBom du vendeur
                    user_bom_stmt = select(UserBom).where(
                        UserBom.id == user_bom_id,
                        UserBom.user_id == seller_id,
                        UserBom.transferred_at.is_(None)
                    ).with_for_update()
                    
                    user_bom = self.db.execute(user_bom_stmt).scalar_one_or_none()
                    
                    if not user_bom:
                        logger.error(f"❌ UserBom {user_bom_id} non trouvé ou non disponible pour la vente")
                        raise ValueError("BOOM non disponible pour la vente")
                    
                    logger.info(f"📦 UserBom trouvé et locké: ID {user_bom.id}")
                    
                    # 2. Récupérer le BOOM associé
                    boom = self.db.query(BomAsset).filter(BomAsset.id == user_bom.bom_id).first()
                    if not boom:
                        logger.error(f"❌ BOOM non trouvé pour UserBom {user_bom_id}")
                        raise ValueError("BOOM non trouvé")
                    
                    logger.info(f"🎨 BOOM trouvé: {boom.title} (ID: {boom.id})")
                    
                    # 3. Vérifier l'acheteur
                    buyer = self.db.query(User).filter(User.id == buyer_id, User.is_active == True).first()
                    if not buyer:
                        logger.error(f"❌ Acheteur {buyer_id} non trouvé ou inactif")
                        raise ValueError("Acheteur non trouvé")
                    
                    # CORRECTION: Utiliser phone au lieu de username
                    buyer_display = f"User_{buyer.id} (phone: {buyer.phone})"
                    logger.debug(f"👤 Acheteur trouvé: {buyer_display}")
                    
                    # 4. Calculs financiers
                    sell_price_decimal = Decimal(str(sell_price)).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    if sell_price_decimal <= Decimal('0'):
                        logger.error(f"❌ Prix de vente invalide: {sell_price_decimal}")
                        raise ValueError("Le prix de vente doit être positif")
                    
                    # Calcul des frais
                    fees_amount = (sell_price_decimal * FEE_RATE).quantize(DECIMAL_2, ROUND_HALF_UP)
                    net_amount = (sell_price_decimal - fees_amount).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    if net_amount <= Decimal("0"):
                        raise ValueError("Montant net invalide après frais")
                    
                    # Valeur de marché actuelle
                    market_value = Decimal(str(boom.get_display_total_value())).quantize(DECIMAL_2, ROUND_HALF_UP)

                    logger.info(f"💰 Calculs financiers SELL:")
                    logger.info(f"   Prix de vente: {sell_price_decimal} FCFA")
                    logger.info(f"   Frais BOOMS: {fees_amount} FCFA")
                    logger.info(f"   Net pour vendeur: {net_amount} FCFA")
                    logger.info(f"   Valeur marché actuelle: {market_value} FCFA")
                    
                    # PATCH 3: Lock CashBalance acheteur (argent RÉEL)
                    buyer_cash_stmt = select(CashBalance).where(
                        CashBalance.user_id == buyer_id
                    ).with_for_update()

                    buyer_cash_balance = self.db.execute(buyer_cash_stmt).scalar_one_or_none()

                    if not buyer_cash_balance:
                        logger.warning(f"💳 Création CashBalance pour acheteur {buyer_id}")
                        buyer_cash_balance = CashBalance(
                            user_id=buyer_id,
                            available_balance=Decimal('0.00'),
                            locked_balance=Decimal('0.00'),
                            currency="FCFA",
                            created_at=datetime.utcnow()
                        )
                        self.db.add(buyer_cash_balance)

                    # Vérifier solde RÉEL acheteur
                    old_buyer_cash_balance = buyer_cash_balance.available_balance or Decimal('0.00')

                    if old_buyer_cash_balance < sell_price_decimal:
                        missing = sell_price_decimal - old_buyer_cash_balance
                        logger.error(f"❌ Solde RÉEL insuffisant pour acheteur {buyer_id}. Nécessaire: {sell_price_decimal} FCFA, Disponible: {old_buyer_cash_balance} FCFA")
                        raise ValueError(f"Solde RÉEL acheteur insuffisant. Manquant: {missing} FCFA")

                    # Wallet virtuel acheteur (pour logs seulement)
                    buyer_wallet = self.db.query(Wallet).filter(Wallet.user_id == buyer_id).first()
                    if not buyer_wallet:
                        buyer_wallet = Wallet(user_id=buyer_id, balance=Decimal('0.00'), currency="FCFA")
                        self.db.add(buyer_wallet)
                    
                    # PATCH 3: Lock CashBalance vendeur (argent RÉEL)
                    seller_cash_stmt = select(CashBalance).where(
                        CashBalance.user_id == seller_id
                    ).with_for_update()

                    seller_cash_balance = self.db.execute(seller_cash_stmt).scalar_one_or_none()

                    if not seller_cash_balance:
                        logger.warning(f"💳 Création CashBalance pour vendeur {seller_id}")
                        seller_cash_balance = CashBalance(
                            user_id=seller_id,
                            available_balance=Decimal('0.00'),
                            locked_balance=Decimal('0.00'),
                            currency="FCFA",
                            created_at=datetime.utcnow()
                        )
                        self.db.add(seller_cash_balance)

                    old_seller_cash_balance = seller_cash_balance.available_balance or Decimal('0.00')

                    # Wallet virtuel vendeur (pour logs seulement)
                    seller_wallet = self.db.query(Wallet).filter(Wallet.user_id == seller_id).first()
                    if not seller_wallet:
                        seller_wallet = Wallet(user_id=seller_id, balance=Decimal('0.00'), currency="FCFA")
                        self.db.add(seller_wallet)
                    
                    # 7. Lock de la trésorerie
                    treasury_stmt = select(PlatformTreasury).with_for_update()
                    treasury = self.db.execute(treasury_stmt).scalar_one_or_none()
                    
                    if not treasury:
                        treasury = PlatformTreasury(
                            balance=Decimal('0.00'), 
                            currency="FCFA"
                        )
                        self.db.add(treasury)
                    
                    old_treasury_balance = treasury.balance
                    
                    # === MOUVEMENTS FINANCIERS ===
                    # PATCH 2: Utilisation des CashBalance (argent RÉEL)
                    
                    # DÉBIT RÉEL acheteur (CashBalance)
                    buyer_cash_balance.available_balance = old_buyer_cash_balance - sell_price_decimal
                    logger.info(f"💳 DÉBIT RÉEL ACHETEUR: {old_buyer_cash_balance} → {buyer_cash_balance.available_balance} FCFA (-{sell_price_decimal})")

                    # CRÉDIT RÉEL vendeur (CashBalance)
                    seller_cash_balance.available_balance = old_seller_cash_balance + net_amount
                    logger.info(f"💳 CRÉDIT RÉEL VENDEUR: {old_seller_cash_balance} → {seller_cash_balance.available_balance} FCFA (+{net_amount})")

                    # WALLET VIRTUEL : JAMAIS TOUCHÉ (RÈGLE MÉTIER)
                    logger.info(f"📝 WALLET VIRTUEL: Aucun mouvement (acheteur: {buyer_wallet.balance}, vendeur: {seller_wallet.balance})")
                    
                    # Trésorerie : frais
                    treasury.balance = (treasury.balance + fees_amount).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    # Crédit des frais collectés
                    if hasattr(treasury, 'fees_collected'):
                        treasury.fees_collected = (treasury.fees_collected + fees_amount).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    logger.info(f"💰 Trésorerie mise à jour:")
                    logger.info(f"   Balance: {old_treasury_balance} → {treasury.balance} FCFA (+{fees_amount})")
                    
                    # === TRANSFERT DE PROPRIÉTÉ ===
                    user_bom.transferred_at = datetime.utcnow()
                    user_bom.is_transferable = False
                    user_bom.receiver_id = buyer_id
                    user_bom.is_sold = True
                    user_bom.deleted_at = datetime.utcnow()
                    
                    # Mise à jour propriétaire BOOM
                    old_owner_id = boom.owner_id
                    boom.owner_id = buyer_id

                    # Ajustement valeur sociale via micro-impact engine
                    sell_metadata = {
                        "transaction_amount": float(sell_price_decimal),
                        "quantity": 1,
                        "channel": "secondary_sale"
                    }
                    social_action_result, _ = social_calculator.apply_social_action(
                        boom=boom,
                        action='sell',
                        user_id=seller_id,
                        metadata=sell_metadata,
                        create_history=True
                    )
                    serialized_social_result = social_calculator.serialize_action_result(social_action_result)
                    
                    # Nouveau UserBom acheteur
                    new_user_bom = UserBom(
                        user_id=buyer_id,
                        bom_id=boom.id,
                        sender_id=seller_id,
                        receiver_id=buyer_id,
                        transfer_id=str(uuid.uuid4()),
                        transfer_message=f"Achat de {boom.title}",
                        purchase_price=sell_price_decimal,
                        current_value=market_value,
                        is_transferable=True,
                        acquired_at=datetime.utcnow()
                    )
                    self.db.add(new_user_bom)
                    
                    # Transaction SELL
                    transaction = Transaction(
                        user_id=seller_id,
                        type="boom_sell",  # ✅ FIXE: Champ type obligatoire
                        amount=float(net_amount),
                        transaction_type="boom_sell",
                        description=(
                            f"Vente BOOM: {boom.title} "
                            f"(Token: {boom.token_id}) | "
                            f"Prix de vente: {sell_price_decimal} FCFA | "
                            f"Frais BOOMS: {fees_amount} FCFA | "
                            f"Net reçu: {net_amount} FCFA"
                        ),
                        status="completed",
                        created_at=datetime.utcnow()
                    )
                    
                    self.db.add(transaction)
                    self.db.flush()
                
                try:
                    self.db.commit()
                except Exception as commit_error:
                    self.db.rollback()
                    logger.error(f"❌ Erreur commit vente: {commit_error}")
                    raise
                
                sell_duration = (datetime.utcnow() - sell_start).total_seconds()
                logger.info(f"✅ Vente BOOM réussie en {sell_duration:.2f}s")
                logger.info(f"   🎨 BOOM: {boom.title}")
                logger.info(f"   👤 Vendeur: User_{seller_id} → Acheteur: User_{buyer_id}")
                logger.info(f"   💰 Prix: {sell_price_decimal} FCFA")
                logger.info(f"   🏷️ Frais: {fees_amount} FCFA")
                
                # BROADCAST WEB SOCKET
                if self.websocket_enabled:
                    try:
                        # PATCH 2: Broadcast des soldes RÉELS (CashBalance)
                        try:
                            from app.websockets import broadcast_balance_update
                            # Envoyer les soldes RÉELS (CashBalance)
                            asyncio.create_task(broadcast_balance_update(
                                buyer_id, 
                                str(buyer_cash_balance.available_balance),
                                balance_type="real"
                            ))
                            asyncio.create_task(broadcast_balance_update(
                                seller_id, 
                                str(seller_cash_balance.available_balance),
                                balance_type="real"
                            ))
                        except ImportError:
                            pass
                            
                        self._trigger_sell_websocket_broadcasts(
                            boom=boom,
                            seller_id=seller_id,
                            buyer_id=buyer_id,
                            sell_price=float(sell_price_decimal),
                            fees_amount=float(fees_amount),
                            social_result=serialized_social_result
                        )
                    except Exception as ws_error:
                        logger.warning(f"⚠️ Erreur WebSocket vente: {ws_error}")
                
                return {
                    "success": True,
                    "message": "✅ BOOM vendu avec succès",
                    "transaction_id": transaction.id,
                    "sell_duration": sell_duration,
                    "social_impact": serialized_social_result,
                    "financial": {
                        "sell_price": float(sell_price_decimal),
                        "fees_paid": float(fees_amount),
                        "net_received": float(net_amount),
                        "social_value": float(market_value),
                        "seller_real_balance_before": float(old_seller_cash_balance),
                        "seller_real_balance_after": float(seller_cash_balance.available_balance),
                        "buyer_real_balance_before": float(old_buyer_cash_balance),
                        "buyer_real_balance_after": float(buyer_cash_balance.available_balance),
                        "treasury_before": float(old_treasury_balance),
                        "treasury_after": float(treasury.balance)
                    },
                    "ownership_change": {
                        "old_owner": int(old_owner_id) if old_owner_id else None,
                        "new_owner": int(buyer_id),
                        "user_bom_id": user_bom.id,
                        "new_user_bom_id": new_user_bom.id
                    },
                    "websocket_broadcast": "sent" if self.websocket_enabled else "disabled"
                }
                
            except OperationalError as e:
                self.db.rollback()
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock détecté dans execute_sell, retry {retry_count}/{MAX_RETRIES}")
                    time.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                else:
                    logger.error(f"❌ Erreur opérationnelle execute_sell: {e}")
                    raise
            except Exception as e:
                self.db.rollback()
                sell_duration = (datetime.utcnow() - sell_start).total_seconds()
                logger.error(f"❌ Erreur vente après {sell_duration:.2f}s: {str(e)}", exc_info=True)
                raise
        
        if last_exception:
            logger.error(f"❌ Échec après {MAX_RETRIES} retries pour execute_sell")
            raise last_exception
    
    def get_user_inventory(self, user_id: int) -> List[Dict]:
        """
        Récupérer l'inventaire BOOM de l'utilisateur avec valeurs sociales
        OPTIMISÉ : Utilise joinedload pour éviter le N+1 query problem
        """
        logger.info(f"📦 INVENTAIRE START - User: {user_id}")
        inventory_start = datetime.utcnow()
        
        try:
            # OPTIMISATION: Charger les BOOMs avec les UserBoms en une seule requête
            from sqlalchemy.orm import joinedload
            
            # ✅ CORRECTION CRITIQUE: Filtrer les BOOMs envoyés (transferred_at IS NULL)
            user_boms = self.db.query(UserBom).options(
                joinedload(UserBom.bom).joinedload(BomAsset.collection)
            ).filter(
                UserBom.user_id == user_id,
                UserBom.is_sold.is_(False),
                UserBom.deleted_at.is_(None),
                UserBom.transferred_at.is_(None)  # ← PATCH APPLIQUÉ
            ).all()
            
            logger.info(f"📦 {len(user_boms)} UserBoms trouvés pour user {user_id}")
            logger.debug(f"   Filtre: transferred_at IS NULL")
            
            if not user_boms:
                logger.info("📦 Aucun BOOM trouvé dans l'inventaire")
                return []
            
            inventory = []
            processed_count = 0
            error_count = 0
            
            for user_bom in user_boms:
                try:
                    # ✅ CORRECTION CRITIQUE: Utiliser user_bom.bom (relation SQLAlchemy)
                    boom = user_bom.bom
                    
                    if not boom:
                        logger.warning(f"⚠️ BOOM non trouvé pour UserBom {user_bom.id}")
                        error_count += 1
                        continue
                    
                    # Calculer la valeur totale (base + sociale + micro)
                    raw_value = boom.get_display_total_value()
                    
                    # CORRECTION: Utiliser Decimal pour tous les calculs
                    purchase_price_decimal = Decimal(str(user_bom.purchase_price or boom.purchase_price or Decimal('0')))
                    fees_decimal = Decimal(str(user_bom.fees_paid or Decimal('0')))
                    entry_price_decimal = purchase_price_decimal + fees_decimal
                    current_value_decimal = Decimal(str(raw_value))

                    # Calculer gain/perte en incluant les frais
                    profit_loss = current_value_decimal - entry_price_decimal
                    profit_loss_percent = (
                        (profit_loss / entry_price_decimal) * Decimal('100')
                    ) if entry_price_decimal > 0 else Decimal('0')
                    
                    # CORRECTION: Obtenir base_value en Decimal
                    base_value = Decimal(str(getattr(boom, 'base_value', boom.base_price or Decimal('0'))))
                    
                    # Créer l'objet inventaire avec la structure CORRECTE
                    inventory_item = {
                        "id": user_bom.id,
                        "user_id": user_bom.user_id,
                        "bom_id": user_bom.bom_id,
                        "token_id": boom.token_id,
                        "quantity": 1,
                        "is_transferable": user_bom.is_transferable,
                        "is_favorite": user_bom.is_favorite,
                        "acquired_at": user_bom.acquired_at.isoformat() if user_bom.acquired_at else None,
                        "hold_days": user_bom.hold_days,
                        "times_shared": user_bom.times_shared,
                        # ✅ CORRECTION: Utiliser "boom_data" au lieu de "bom_asset"
                        "boom_data": {
                            "id": boom.id,
                            "token_id": boom.token_id,
                            "title": boom.title,
                            "description": boom.description,
                            "artist": boom.artist,
                            "category": boom.category,
                            "animation_url": boom.animation_url,
                            "preview_image": boom.preview_image,
                            "edition_type": boom.edition_type,
                            "current_edition": boom.current_edition,
                            "max_editions": boom.max_editions,
                            "collection_name": boom.collection.name if boom.collection else None
                        },
                        "financial": {
                            "purchase_price": float(purchase_price_decimal),
                            "fees_paid": float(fees_decimal),
                            "entry_price": float(entry_price_decimal),
                            "current_social_value": float(current_value_decimal),
                            "profit_loss": float(profit_loss),
                            "profit_loss_percent": float(profit_loss_percent),
                            "estimated_value": float(current_value_decimal)
                        },
                        "social_metrics": {
                            "social_value": float(getattr(boom, 'social_value', 0) or 0),
                            # ✅ CORRECTION: Utiliser Decimal pour base_value
                            "base_value": float(base_value),
                            "total_value": float(current_value_decimal),
                            "buy_count": getattr(boom, 'buy_count', 0) or 0,
                            "sell_count": getattr(boom, 'sell_count', 0) or 0,
                            "share_count": getattr(boom, 'share_count', 0) or 0,
                            "interaction_count": getattr(boom, 'interaction_count', 0) or 0,
                            "social_score": float(getattr(boom, 'social_score', 1.0) or 1.0),
                            "share_count_24h": getattr(boom, 'share_count_24h', 0) or 0,
                            "sell_count_24h": getattr(boom, 'sell_count_24h', 0) or 0,
                            "unique_holders": getattr(boom, 'unique_holders_count', 1) or 1,
                            "acceptance_rate": float(getattr(boom, 'gift_acceptance_rate', 1.0) or 1.0),
                            "social_event": getattr(boom, 'social_event', None),
                            "daily_interaction_score": float(getattr(boom, 'daily_interaction_score', 1.0) or 1.0)
                        }
                    }
                    
                    inventory.append(inventory_item)
                    processed_count += 1
                    logger.debug(f"✅ BOOM ajouté à l'inventaire: {boom.title} (ID: {boom.id})")
                    
                except Exception as item_error:
                    # ✅ Amélioration du message d'erreur pour identifier la source
                    error_msg = str(item_error)
                    if "'UserBom' object has no attribute 'bom_asset'" in error_msg:
                        logger.error(f"❌ ERREUR CRITIQUE UserBom {user_bom.id}: Le code utilise encore 'bom_asset'. "
                                    f"Veuillez utiliser 'bom' ou ajouter la propriété bom_asset dans le modèle UserBom.")
                    else:
                        logger.warning(f"⚠️ Erreur sur UserBom {user_bom.id}: {error_msg}")
                    error_count += 1
                    continue
            
            inventory_duration = (datetime.utcnow() - inventory_start).total_seconds()
            logger.info(f"✅ INVENTAIRE COMPLET - {processed_count} BOOMs traités, {error_count} erreurs")
            logger.info(f"   ⏱️  Durée: {inventory_duration:.2f}s")
            if inventory:
                logger.info(f"   📊 Total valeur: {sum(item['financial']['current_social_value'] for item in inventory):.2f} FCFA")
            else:
                logger.info(f"   📊 Total valeur: 0 FCFA")
            
            return inventory
            
        except Exception as e:
            inventory_duration = (datetime.utcnow() - inventory_start).total_seconds()
            logger.error(f"❌ ERREUR INVENTAIRE après {inventory_duration:.2f}s: {str(e)}", exc_info=True)
            return []
    
    def transfer_bom(self, sender_id: int, token_id: str, receiver_id: int, message: str = None) -> Dict:
        """
        Transférer un BOOM à un autre utilisateur
        Version 100% sécurisée avec transactions atomiques
        """
        logger.info(f"🔄 TRANSFERT START - Sender:{sender_id}, Receiver:{receiver_id}, Token:{token_id}")
        transfer_start = datetime.utcnow()
        social_calculator = SocialValueCalculator(self.db)
        serialized_social_result: Optional[Dict[str, Any]] = None
        social_action_result: Optional[Dict[str, Any]] = None
        
        # === TRANSACTION ATOMIQUE AVEC RETRY ===
        retry_count = 0
        last_exception = None
        
        while retry_count < MAX_RETRIES:
            try:
                with self.db.begin_nested():
                    # === ORDRE DÉTERMINISTE DES LOCKS ===
                    
                    # 1. Lock du BOOM
                    boom_stmt = select(BomAsset).where(
                        BomAsset.token_id == token_id,
                        BomAsset.is_active == True
                    ).with_for_update()
                    
                    boom = self.db.execute(boom_stmt).scalar_one_or_none()
                    
                    if not boom or boom.owner_id != sender_id:
                        logger.error(f"❌ BOOM non trouvé ou non propriété de {sender_id}")
                        raise ValueError("BOOM non trouvé ou vous n'en êtes pas propriétaire")
                    
                    logger.info(f"🎨 BOOM trouvé: {boom.title} (ID: {boom.id})")
                    
                    # 2. Lock du UserBom de l'expéditeur
                    user_bom_stmt = select(UserBom).where(
                        UserBom.user_id == sender_id,
                        UserBom.bom_id == boom.id
                    ).with_for_update()
                    
                    user_bom = self.db.execute(user_bom_stmt).scalar_one_or_none()
                    
                    if not user_bom or not user_bom.is_transferable:
                        logger.error(f"❌ UserBom non trouvé ou non transférable pour {sender_id}")
                        raise ValueError("Ce BOOM n'est pas transférable")
                    
                    logger.debug(f"📦 UserBom trouvé: {user_bom.id}")
                    
                    # 3. Vérifier le destinataire
                    receiver = self.db.query(User).filter(User.id == receiver_id, User.is_active == True).first()
                    if not receiver:
                        logger.error(f"❌ Destinataire {receiver_id} non trouvé ou inactif")
                        raise ValueError("Destinataire non trouvé")
                    
                    # CORRECTION: User n'a PAS username, utiliser phone
                    receiver_display = f"User_{receiver.id} (phone: {receiver.phone})"
                    logger.debug(f"👤 Destinataire trouvé: {receiver_display}")
                    
                    # Sauvegarder les valeurs avant modification
                    old_owner_id = boom.owner_id
                    
                    # 4. Mettre à jour le propriétaire
                    boom.owner_id = receiver_id
                    
                    # 5. Créer un nouvel enregistrement pour le receveur
                    new_user_bom = UserBom(
                        user_id=receiver_id,
                        bom_id=boom.id,
                        sender_id=sender_id,
                        receiver_id=receiver_id,
                        transfer_id=str(uuid.uuid4()),
                        transfer_message=message,
                        purchase_price=user_bom.purchase_price,
                        current_value=Decimal(str(boom.get_display_total_value())),
                        is_transferable=True,
                        acquired_at=datetime.utcnow()
                    )
                    self.db.add(new_user_bom)
                    
                    # 6. Marquer l'ancien comme transféré
                    user_bom.transferred_at = datetime.utcnow()
                    user_bom.receiver_id = receiver_id
                    user_bom.is_transferable = False
                    
                    # ✅ 7. MISE À JOUR DE LA VALEUR SOCIALE
                    reference_value = boom.get_display_total_value()
                    impact_override = calculate_social_delta(reference_value, SOCIAL_TRANSFER_RATE)
                    social_metadata = {
                        "channel": "direct_transfer",
                        "sender_id": sender_id,
                        "receiver_id": receiver_id,
                        "transfer_message": message,
                        "token_id": token_id,
                        "transaction_amount": float(reference_value or Decimal('0')),
                        "override_social_impact": float(impact_override or Decimal('0')),
                        "quantity": 1
                    }
                    social_action_result, _ = social_calculator.apply_social_action(
                        boom=boom,
                        action='share',
                        user_id=receiver_id,
                        metadata=social_metadata,
                        create_history=True
                    )
                    serialized_social_result = social_calculator.serialize_action_result(social_action_result)
                    boom.sync_social_totals()
                    
                    # 8. Mettre à jour les métriques sociales
                    if hasattr(boom, 'update_social_metrics'):
                        boom.update_social_metrics(self.db)
                
                try:
                    self.db.commit()
                except Exception as commit_error:
                    self.db.rollback()
                    logger.error(f"❌ Erreur commit transfert: {commit_error}")
                    raise
                
                transfer_duration = (datetime.utcnow() - transfer_start).total_seconds()
                logger.info(f"✅ Transfert réussi en {transfer_duration:.2f}s")
                logger.info(f"   🎨 BOOM: {boom.title}")
                logger.info(f"   👤 De: {sender_id} → À: {receiver_id}")
                logger.info(f"   🆔 Token: {token_id}")
                social_increment = social_action_result["delta"] if social_action_result else Decimal('0')
                logger.info(f"   📈 Incrément social: +{social_increment} FCFA")
                logger.info(f"   📊 Ancien propriétaire: {old_owner_id}")
                
                # 9. BROADCAST WEB SOCKET
                self._trigger_transfer_websocket_broadcasts(
                    boom=boom,
                    sender_id=sender_id,
                    receiver_id=receiver_id,
                    social_result=serialized_social_result
                )
                
                return {
                    "success": True,
                    "message": "BOOM transféré avec succès",
                    "transfer_id": new_user_bom.transfer_id,
                    "transfer_duration": transfer_duration,
                    "social_impact": serialized_social_result,
                    "websocket_broadcast": "sent" if self.websocket_enabled else "disabled"
                }
                
            except OperationalError as e:
                self.db.rollback()
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock détecté dans transfer_bom, retry {retry_count}/{MAX_RETRIES}")
                    time.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                else:
                    logger.error(f"❌ Erreur opérationnelle transfer_bom: {e}")
                    raise
            except Exception as e:
                self.db.rollback()
                transfer_duration = (datetime.utcnow() - transfer_start).total_seconds()
                logger.error(f"❌ Erreur transfert après {transfer_duration:.2f}s: {str(e)}", exc_info=True)
                raise
        
        if last_exception:
            logger.error(f"❌ Échec après {MAX_RETRIES} retries pour transfer_bom")
            raise last_exception
    
    def list_bom_for_trade(self, user_id: int, token_id: str, asking_price: float) -> Dict:
        """
        Mettre un BOOM en vente sur le marché
        Version 100% sécurisée avec transactions atomiques
        """
        logger.info(f"🏪 MISE EN VENTE START - User:{user_id}, Token:{token_id}, Price:{asking_price}")
        listing_start = datetime.utcnow()
        
        # === TRANSACTION ATOMIQUE AVEC RETRY ===
        retry_count = 0
        last_exception = None
        
        while retry_count < MAX_RETRIES:
            try:
                with self.db.begin_nested():
                    # 1. Lock du BOOM
                    boom_stmt = select(BomAsset).where(
                        BomAsset.token_id == token_id
                    ).with_for_update()
                    
                    boom = self.db.execute(boom_stmt).scalar_one_or_none()
                    
                    if not boom or boom.owner_id != user_id:
                        logger.error(f"❌ BOOM {token_id} non possédé par user {user_id}")
                        raise ValueError("Vous ne possédez pas ce BOOM")
                    
                    logger.info(f"🎨 BOOM trouvé et locké: {boom.title} (ID: {boom.id})")
                    
                    # 2. Vérifier le prix
                    asking_price_decimal = Decimal(str(asking_price)).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    if asking_price_decimal <= Decimal('0'):
                        logger.error(f"❌ Prix invalide: {asking_price_decimal}")
                        raise ValueError("Le prix doit être positif")
                    
                    # ✅ 3. Calculer la valeur sociale actuelle
                    social_calculator = SocialValueCalculator(self.db)
                    current_social_value = social_calculator.calculate_current_value(boom.id)
                    current_social_value_decimal = Decimal(str(current_social_value)).quantize(DECIMAL_2, ROUND_HALF_UP)
                    
                    logger.debug(f"💰 Valeur sociale actuelle: {current_social_value} FCFA")
                    logger.debug(f"💰 Prix demandé: {asking_price_decimal} FCFA")
                    
                    # 4. Vérifier que le prix est raisonnable
                    min_price = (current_social_value_decimal * Decimal('0.8')).quantize(DECIMAL_2, ROUND_HALF_UP)   # -20% max
                    max_price = (current_social_value_decimal * Decimal('2.0')).quantize(DECIMAL_2, ROUND_HALF_UP)   # +100% max
                    
                    if asking_price_decimal < min_price:
                        error_msg = f"Prix trop bas. Minimum recommandé: {min_price} FCFA"
                        logger.error(f"❌ {error_msg}")
                        raise ValueError(error_msg)
                    
                    if asking_price_decimal > max_price:
                        error_msg = f"Prix trop élevé. Maximum recommandé: {max_price} FCFA"
                        logger.error(f"❌ {error_msg}")
                        raise ValueError(error_msg)
                    
                    # 5. Lock du UserBom
                    user_bom_stmt = select(UserBom).where(
                        UserBom.user_id == user_id,
                        UserBom.bom_id == boom.id
                    ).with_for_update()
                    
                    user_bom = self.db.execute(user_bom_stmt).scalar_one_or_none()
                    
                    if not user_bom:
                        logger.error(f"❌ UserBom non trouvé pour user {user_id}, boom {boom.id}")
                        raise ValueError("BOOM non trouvé dans votre inventaire")
                    
                    # 6. Mettre en vente
                    user_bom.is_listed_for_trade = True
                    user_bom.asking_price = asking_price_decimal
                
                try:
                    self.db.commit()
                except Exception as commit_error:
                    self.db.rollback()
                    logger.error(f"❌ Erreur commit mise en vente: {commit_error}")
                    raise
                
                listing_duration = (datetime.utcnow() - listing_start).total_seconds()
                logger.info(f"✅ BOOM mis en vente en {listing_duration:.2f}s")
                logger.info(f"   🎨 {boom.title} - {asking_price_decimal} FCFA")
                logger.info(f"   📊 Valeur sociale actuelle: {current_social_value}")
                
                # CORRECTION: Calcul Decimal pour price_premium
                price_premium_decimal = Decimal('0')
                if current_social_value_decimal > 0:
                    price_premium_decimal = ((asking_price_decimal - current_social_value_decimal) / current_social_value_decimal * Decimal('100')).quantize(DECIMAL_2, ROUND_HALF_UP)
                
                logger.info(f"   📈 Marge: {float(price_premium_decimal):.2f}%")
                
                # 7. BROADCAST WEB SOCKET
                self._trigger_listing_websocket_broadcasts(
                    boom=boom,
                    user_id=user_id,
                    asking_price=float(asking_price_decimal)
                )
                
                return {
                    "success": True,
                    "message": "BOOM mis en vente avec succès",
                    "listing_duration": listing_duration,
                    "asking_price": float(asking_price_decimal),
                    "current_social_value": float(current_social_value),
                    "price_premium": float(price_premium_decimal),
                    "social_metrics": {
                        "buy_count": getattr(boom, 'buy_count', 0) or 0,
                        "sell_count": getattr(boom, 'sell_count', 0) or 0,
                        "share_count": getattr(boom, 'share_count', 0) or 0,
                        "interaction_count": getattr(boom, 'interaction_count', 0) or 0
                    },
                    "websocket_broadcast": "sent" if self.websocket_enabled else "disabled"
                }
                
            except OperationalError as e:
                self.db.rollback()
                if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                    retry_count += 1
                    last_exception = e
                    logger.warning(f"🔄 Deadlock détecté dans list_bom_for_trade, retry {retry_count}/{MAX_RETRIES}")
                    time.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                    continue
                else:
                    logger.error(f"❌ Erreur opérationnelle list_bom_for_trade: {e}")
                    raise
            except Exception as e:
                self.db.rollback()
                listing_duration = (datetime.utcnow() - listing_start).total_seconds()
                logger.error(f"❌ Erreur mise en vente après {listing_duration:.2f}s: {str(e)}", exc_info=True)
                raise
        
        if last_exception:
            logger.error(f"❌ Échec après {MAX_RETRIES} retries pour list_bom_for_trade")
            raise last_exception
    
    # === MÉTHODES PRIVÉES ===
    
    def _trigger_websocket_broadcasts(
        self,
        boom: BomAsset,
        user_id: int,
        quantity: int,
        total_cost: Decimal,
        social_result: Optional[Dict] = None,
        old_social_value: Optional[Decimal] = None,
        social_increment: Optional[Decimal] = None
    ):
        """Déclencher les broadcasts WebSocket de manière asynchrone et non bloquante"""
        if not self.websocket_enabled:
            logger.debug("🔌 WebSocket désactivé, pas de broadcast")
            return
        
        try:
            logger.info(f"🔌 Préparation broadcasts WebSocket pour BOOM #{boom.id}")
            
            # Exécuter les broadcasts dans un thread séparé pour ne pas bloquer
            import threading
            
            def run_broadcasts():
                try:
                    # Créer une nouvelle boucle d'événements pour ce thread
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    
                    # 1. Broadcast mise à jour sociale
                    result_payload = social_result or {}
                    old_value = float(old_social_value) if old_social_value is not None else float(result_payload.get("old_social_value", boom.social_value or 0))
                    new_value = float(result_payload.get("new_social_value", boom.social_value or 0))
                    delta_value = float(social_increment) if social_increment is not None else float(result_payload.get("delta", 0))

                    social_update_task = broadcast_social_value_update(
                        boom_id=boom.id,
                        boom_title=boom.title,
                        old_value=old_value,
                        new_value=new_value,
                        delta=delta_value,
                        action="buy",
                        user_id=user_id
                    )
                    
                    # 2. Broadcast notification utilisateur
                    user_notification_task = broadcast_user_notification(
                        user_id=user_id,
                        notification_type="boom_purchased",
                        title="🎉 Achat réussi!",
                        message=f"Vous avez acheté {boom.title} pour {total_cost} FCFA",
                        data={
                            "boom_id": boom.id,
                            "boom_title": boom.title,
                            "purchase_price": float(boom.purchase_price),
                            "quantity": quantity,
                            "total_cost": float(total_cost),
                            "new_social_value": new_value,
                            "transaction_time": datetime.utcnow().isoformat()
                        }
                    )
                    
                    # Exécuter les tâches
                    loop.run_until_complete(asyncio.gather(
                        social_update_task,
                        user_notification_task,
                        return_exceptions=True
                    ))
                    
                    logger.info(f"🔌 Broadcasts WebSocket terminés pour BOOM #{boom.id}")
                    loop.close()
                    
                except Exception as ws_error:
                    logger.error(f"❌ Erreur dans thread WebSocket: {ws_error}")
            
            # Démarrer le thread
            broadcast_thread = threading.Thread(
                target=run_broadcasts,
                name=f"WebSocket-Broadcast-BOOM-{boom.id}"
            )
            broadcast_thread.daemon = True  # Thread démon pour ne pas bloquer l'arrêt
            broadcast_thread.start()
            
            logger.debug(f"🔌 Thread WebSocket démarré: {broadcast_thread.name}")
            
        except Exception as ws_error:
            logger.error(f"❌ Erreur préparation WebSocket (non bloquant): {ws_error}")
    
    def _trigger_transfer_websocket_broadcasts(
        self,
        boom: BomAsset,
        sender_id: int,
        receiver_id: int,
        social_result: Optional[Dict] = None
    ):
        """Déclencher les broadcasts WebSocket pour un transfert"""
        if not self.websocket_enabled:
            return
        
        try:
            # Exécuter dans un thread séparé
            import threading
            
            def run_transfer_broadcasts():
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    
                    # Broadcast mise à jour sociale
                    result_payload = social_result or {}
                    fallback_value = float(boom.social_value or 0)
                    old_value = float(result_payload.get("old_social_value", fallback_value))
                    new_value = float(result_payload.get("new_social_value", fallback_value))
                    delta_value = float(result_payload.get("delta", new_value - old_value))
                    social_task = broadcast_social_value_update(
                        boom_id=boom.id,
                        boom_title=boom.title,
                        old_value=old_value,
                        new_value=new_value,
                        delta=delta_value,
                        action="share",
                        user_id=sender_id
                    )
                    
                    # Notification envoyeur
                    sender_task = broadcast_user_notification(
                        user_id=sender_id,
                        notification_type="boom_sent",
                        title="🎁 BOOM envoyé!",
                        message=f"Vous avez envoyé {boom.title}",
                        data={
                            "boom_id": boom.id,
                            "boom_title": boom.title,
                            "receiver_id": receiver_id,
                            "social_increment": delta_value
                        }
                    )
                    
                    # Notification receveur
                    receiver_task = broadcast_user_notification(
                        user_id=receiver_id,
                        notification_type="boom_received",
                        title="🎁 BOOM reçu!",
                        message=f"Vous avez reçu {boom.title}",
                        data={
                            "boom_id": boom.id,
                            "boom_title": boom.title,
                            "sender_id": sender_id,
                            "social_value": new_value
                        }
                    )
                    
                    loop.run_until_complete(asyncio.gather(
                        social_task, sender_task, receiver_task,
                        return_exceptions=True
                    ))
                    
                    logger.info(f"🔌 Broadcasts transfert terminés pour BOOM #{boom.id}")
                    loop.close()
                    
                except Exception as ws_error:
                    logger.error(f"❌ Erreur WebSocket transfert: {ws_error}")
            
            thread = threading.Thread(
                target=run_transfer_broadcasts,
                name=f"WebSocket-Transfer-BOOM-{boom.id}"
            )
            thread.daemon = True
            thread.start()
            
        except Exception as ws_error:
            logger.error(f"❌ Erreur préparation WebSocket transfert: {ws_error}")
    
    def _trigger_sell_websocket_broadcasts(
        self,
        boom: BomAsset,
        seller_id: int,
        buyer_id: int,
        sell_price: float,
        fees_amount: float,
        social_result: Optional[Dict] = None
    ):
        """Déclencher les broadcasts WebSocket pour une vente"""
        if not self.websocket_enabled:
            return
        
        try:
            # Exécuter dans un thread séparé
            import threading
            
            def run_sell_broadcasts():
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    
                    # Broadcast mise à jour sociale
                    result_payload = social_result or {}
                    fallback_value = float(boom.social_value or 0)
                    old_value = float(result_payload.get("old_social_value", fallback_value))
                    new_value = float(result_payload.get("new_social_value", fallback_value))
                    delta_value = float(result_payload.get("delta", new_value - old_value))
                    social_task = broadcast_social_value_update(
                        boom_id=boom.id,
                        boom_title=boom.title,
                        old_value=old_value,
                        new_value=new_value,
                        delta=delta_value,
                        action="sell",
                        user_id=seller_id
                    )
                    
                    # Notification vendeur
                    seller_task = broadcast_user_notification(
                        user_id=seller_id,
                        notification_type="boom_sold",
                        title="💰 BOOM vendu!",
                        message=f"Vous avez vendu {boom.title} pour {sell_price} FCFA",
                        data={
                            "boom_id": boom.id,
                            "boom_title": boom.title,
                            "sell_price": sell_price,
                            "fees_paid": fees_amount,
                            "net_received": sell_price - fees_amount,
                            "buyer_id": buyer_id,
                            "transaction_time": datetime.utcnow().isoformat()
                        }
                    )
                    
                    # Notification acheteur
                    buyer_task = broadcast_user_notification(
                        user_id=buyer_id,
                        notification_type="boom_purchased_market",
                        title="🎉 BOOM acheté!",
                        message=f"Vous avez acheté {boom.title} sur le marché",
                        data={
                            "boom_id": boom.id,
                            "boom_title": boom.title,
                            "purchase_price": sell_price,
                            "seller_id": seller_id,
                            "transaction_time": datetime.utcnow().isoformat()
                        }
                    )
                    
                    # Broadcast marché
                    market_task = broadcast_market_update(
                        boom_id=boom.id,
                        update_type="sold",
                        price=sell_price,
                        seller_id=seller_id,
                        buyer_id=buyer_id
                    )
                    
                    loop.run_until_complete(asyncio.gather(
                        social_task, seller_task, buyer_task, market_task,
                        return_exceptions=True
                    ))
                    
                    logger.info(f"🔌 Broadcasts vente terminés pour BOOM #{boom.id}")
                    loop.close()
                    
                except Exception as ws_error:
                    logger.error(f"❌ Erreur WebSocket vente: {ws_error}")
            
            thread = threading.Thread(
                target=run_sell_broadcasts,
                name=f"WebSocket-Sell-BOOM-{boom.id}"
            )
            thread.daemon = True
            thread.start()
            
        except Exception as ws_error:
            logger.error(f"❌ Erreur préparation WebSocket vente: {ws_error}")
    
    def _trigger_listing_websocket_broadcasts(self, boom: BomAsset, user_id: int, asking_price: float):
        """Déclencher les broadcasts WebSocket pour une mise en vente"""
        if not self.websocket_enabled:
            return
        
        try:
            import threading
            
            def run_listing_broadcasts():
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    
                    # Broadcast marché
                    market_task = broadcast_market_update(
                        boom_id=boom.id,
                        update_type="listed",
                        price=asking_price,
                        seller_id=user_id
                    )
                    
                    # Notification vendeur
                    notification_task = broadcast_user_notification(
                        user_id=user_id,
                        notification_type="boom_listed",
                        title="🏪 BOOM en vente!",
                        message=f"Votre BOOM {boom.title} est maintenant en vente",
                        data={
                            "boom_id": boom.id,
                            "boom_title": boom.title,
                            "asking_price": asking_price,
                            "listed_at": datetime.utcnow().isoformat()
                        }
                    )
                    
                    loop.run_until_complete(asyncio.gather(
                        market_task, notification_task,
                        return_exceptions=True
                    ))
                    
                    logger.info(f"🔌 Broadcasts mise en vente terminés pour BOOM #{boom.id}")
                    loop.close()
                    
                except Exception as ws_error:
                    logger.error(f"❌ Erreur WebSocket mise en vente: {ws_error}")
            
            thread = threading.Thread(
                target=run_listing_broadcasts,
                name=f"WebSocket-Listing-BOOM-{boom.id}"
            )
            thread.daemon = True
            thread.start()
            
        except Exception as ws_error:
            logger.error(f"❌ Erreur préparation WebSocket mise en vente: {ws_error}")
    
    def _check_availability(self, boom: BomAsset, quantity: int):
        """Vérifier la disponibilité du BOOM avec logs"""
        logger.debug(f"📊 Vérification disponibilité: quantité={quantity}")
        
        if boom.max_editions is not None:
            if boom.current_edition >= boom.max_editions:
                error_msg = "Toutes les éditions de ce BOOM sont épuisées"
                logger.error(f"❌ {error_msg} ({boom.current_edition}/{boom.max_editions})")
                raise ValueError(error_msg)
            
            available = boom.max_editions - boom.current_edition
            if quantity > available:
                error_msg = f"Seulement {available} édition(s) disponible(s)"
                logger.error(f"❌ {error_msg} (demandé: {quantity})")
                raise ValueError(error_msg)
            logger.debug(f"✅ Éditions disponibles: {available}")
        
        if boom.max_editions == 1 and boom.owner_id is not None:
            error_msg = "Cette édition unique est déjà vendue"
            logger.error(f"❌ {error_msg} (propriétaire: {boom.owner_id})")
            raise ValueError(error_msg)
    
    def _calculate_purchase_price(self, social_value: Decimal, user_id: int) -> Decimal:
        """
        CORRECTION: Retourner UNIQUEMENT la valeur sociale
        Les frais sont calculés séparément avec réduction selon le niveau
        """
        # Convertir en Decimal
        social_value_decimal = Decimal(str(social_value)).quantize(DECIMAL_2, ROUND_HALF_UP)
        
        # CORRECTION: Retourner UNIQUEMENT la valeur sociale
        purchase_price = social_value_decimal
        
        logger.debug(f"💰 Calcul prix achat CORRIGÉ: valeur sociale={social_value_decimal}")
        logger.debug(f"   Prix BOOM (sans frais): {purchase_price}")
        logger.debug(f"   NOTE: Frais calculés séparément avec réduction niveau utilisateur")
        
        return purchase_price
    
    def _get_user_fee_reduction(self, user_id: int) -> Decimal:
        """Retourner la réduction de frais selon le niveau utilisateur"""
        user_level = self._get_user_level(user_id)
        
        # TAUX DE RÉDUCTION selon le niveau
        fee_reduction = {
            "bronze": Decimal('0.00'),    # 0% réduction
            "silver": Decimal('0.01'),    # 1% réduction
            "gold": Decimal('0.02'),      # 2% réduction
            "platinum": Decimal('0.03')   # 3% réduction
        }.get(user_level, Decimal('0.00'))
        
        logger.debug(f"👤 Réduction frais user {user_id}: {(fee_reduction * 100)}% (niveau: {user_level})")
        
        return fee_reduction
    
    def _get_user_level(self, user_id: int) -> str:
        """Déterminer le niveau de l'utilisateur avec logs"""
        boom_count = self.db.query(UserBom).filter(
            UserBom.user_id == user_id,
            UserBom.is_transferable == True
        ).count()
        
        if boom_count >= 50:
            level = "platinum"
        elif boom_count >= 20:
            level = "gold"
        elif boom_count >= 5:
            level = "silver"
        else:
            level = "bronze"
        
        logger.debug(f"👤 Niveau utilisateur {user_id}: {level} (BOOMs: {boom_count})")
        
        return level
    
    def _update_collection_stats(self, boom: BomAsset, quantity: int, social_amount: Decimal):
        """Mettre à jour les statistiques de collection avec logs"""
        if boom.collection_id:
            collection = self.db.query(NFTCollection).filter(NFTCollection.id == boom.collection_id).first()
            if collection:
                old_total = collection.total_items
                
                # CORRECTION CRITIQUE: Éviter Decimal + float
                # Supposons que total_social_value est soit Decimal soit float
                old_value_decimal = Decimal(str(collection.total_social_value or 0))
                
                # CORRECTION: Utiliser Decimal
                social_value_increment = Decimal(str(boom.current_social_value)) * Decimal(str(quantity))
                
                collection.total_items += quantity
                
                # CORRECTION: S'assurer que c'est Decimal
                new_total_social_value = (old_value_decimal + social_value_increment).quantize(DECIMAL_6, ROUND_HALF_UP)
                collection.total_social_value = float(new_total_social_value)
                
                # Recalculer le score moyen
                collection_booms = self.db.query(BomAsset).filter(
                    BomAsset.collection_id == boom.collection_id
                ).all()
                
                if collection_booms:
                    avg_score = sum(float(b.social_score) for b in collection_booms) / len(collection_booms)
                    collection.average_social_score = avg_score
                
                logger.info(f"📚 Collection mise à jour: {collection.name}")
                logger.debug(f"   Items: {old_total} → {collection.total_items}")
                logger.debug(f"   Valeur: {float(old_value_decimal)} → {collection.total_social_value}")
                logger.debug(f"   Score moyen: {collection.average_social_score:.2f}")
    
    def _prepare_purchase_response(self, boom: BomAsset, user_id: int, quantity: int,
                                 social_value_price: Decimal, social_value: Decimal,
                                 fees_amount: Decimal, social_amount: Decimal,
                                 total_cost: Decimal, user_boms: List[UserBom], 
                                 transaction_duration: float, cash_balance_after: Decimal,
                                 treasury_balance: Decimal, social_increment: Decimal,
                                 old_social_value: Decimal, transaction_id: int) -> Dict:
        """Préparer la réponse d'achat avec métriques détaillées"""
        
        logger.debug(f"📤 Préparation réponse achat BOOM #{boom.id}")
        
        # CORRECTION: total_cost est déjà calculé correctement (social + frais)
        # On l'utilise directement car il est correct
        
        # CORRECTION: Calcul net_social_value
        net_social_decimal = social_value * Decimal(str(quantity))
        
        # CORRECTION: Obtenir base_value en Decimal
        base_value_decimal = Decimal(str(getattr(boom, 'base_value', boom.base_price or Decimal('0'))))
        
        # CORRECTION: Calcul value_appreciation en Decimal
        value_appreciation_decimal = Decimal('0')
        if base_value_decimal > 0:
            value_appreciation_decimal = (
                (social_value - base_value_decimal) / base_value_decimal * Decimal('100')
            ).quantize(DECIMAL_2, ROUND_HALF_UP)
        
        # CORRECTION: Calcul fees_percentage en Decimal
        fees_percentage_decimal = Decimal('0')
        if total_cost > 0:
            fees_percentage_decimal = (fees_amount / total_cost * Decimal('100')).quantize(DECIMAL_2, ROUND_HALF_UP)
        
        response = {
            "success": True,
            "message": f"✅ BOOM acheté avec succès!",
            "transaction_id": transaction_id,
            "transaction_time": transaction_duration,
            "timestamp": datetime.utcnow().isoformat(),
            # ✅ CORRECTION: Utiliser "boom" au lieu de "nft" pour correspondre au response_model FastAPI
            "boom": {
                "id": boom.id,
                "token_id": boom.token_id,
                "title": boom.title,
                "artist": boom.artist,
                "edition": f"{boom.current_edition}/{boom.max_editions}",
                "purchase_price": float(social_value_price),
                "social_value": float(social_value),
                "total_cost": float(total_cost),
                "base_price": float(base_value_decimal),
                "social_score": float(boom.social_score or 1.0)
            },
            "financial": {
                "fees_paid": float(fees_amount),
                "social_value": float(social_amount),
                "fees_percentage": float(fees_percentage_decimal),
                "net_social_value": float(net_social_decimal),
                "total_paid": float(total_cost),
                "new_wallet_balance": float(cash_balance_after),
                "new_treasury_balance": float(treasury_balance)
            },
            "social_impact": {
                "social_value_increment": float(social_increment),
                "old_social_value": float(old_social_value),
                "new_social_value": float(boom.social_value or 0),
                "social_score": float(boom.social_score or 1.0),
                "share_count_24h": boom.share_count_24h or 0,
                "social_event": boom.social_event,
                "value_appreciation": float(value_appreciation_decimal),
                "interaction_summary": {
                    "total_buys": getattr(boom, 'buy_count', 0) or 0,
                    "total_sells": getattr(boom, 'sell_count', 0) or 0,
                    "total_shares": getattr(boom, 'share_count', 0) or 0,
                    "interaction_count": getattr(boom, 'interaction_count', 0) or 0,
                    "last_interaction": boom.last_interaction_at.isoformat() if boom.last_interaction_at else None
                }
            },
            "user_boms": [{
                "id": ub.id,
                "transfer_id": ub.transfer_id,
                "acquired_at": ub.acquired_at.isoformat() if ub.acquired_at else None,
                "estimated_value": float(ub.current_value or 0),
                "purchase_price": float(ub.purchase_price or 0)
            } for ub in user_boms],
            "websocket": {
                "enabled": self.websocket_enabled,
                "status": "broadcast_initiated" if self.websocket_enabled else "disabled"
            },
            "performance": {
                "processing_time": transaction_duration,
                "items_processed": quantity,
                "database_operations": 5 + quantity  # Estimation
            },
            "security": {
                "transaction_atomic": True,
                "locks_acquired": ["BomAsset", "Wallet", "PlatformTreasury"],
                "deadlock_protection": True,
                "retry_count": 0
            }
        }
        
        logger.debug(f"📤 Réponse achat préparée pour BOOM #{boom.id} ({len(response['user_boms'])} items)")
        logger.debug(f"   Structure financière: Total:{total_cost} = Frais:{fees_amount} + Social:{social_amount}")
        
        return response
    
    # === MÉTHODES EXISTANTES (inchangées) ===
    
    def get_boom_stats(self) -> Dict:
        """
        Récupérer les statistiques globales des BOOMS
        """
        logger.info(f"📊 STATISTIQUES BOOMS START")
        stats_start = datetime.utcnow()
        
        try:
            # Compteurs de base
            total_booms = self.db.query(BomAsset).filter(BomAsset.is_active == True).count()
            total_collections = self.db.query(NFTCollection).count()
            total_artists = self.db.query(BomAsset.artist).distinct().count()
            
            logger.debug(f"📊 Total BOOMS: {total_booms}")
            logger.debug(f"📊 Total collections: {total_collections}")
            logger.debug(f"📊 Total artistes: {total_artists}")
            
            # Valeur sociale totale
            total_social_value = self.db.query(BomAsset.social_value).filter(
                BomAsset.is_active == True
            ).all()
            total_social_sum = sum([float(val[0]) for val in total_social_value if val[0]])
            
            # ✅ CORRECTION: Gérer base_value qui peut ne pas exister
            try:
                # Essayer de récupérer base_value
                total_base_value = self.db.query(BomAsset.base_value).filter(
                    BomAsset.is_active == True
                ).all()
                total_base_sum = sum([float(val[0]) for val in total_base_value if val[0]])
            except Exception as base_value_error:
                logger.warning(f"⚠️ base_value non disponible, utilisation de base_price: {base_value_error}")
                # Fallback à base_price
                total_base_value = self.db.query(BomAsset.base_price).filter(
                    BomAsset.is_active == True
                ).all()
                total_base_sum = sum([float(val[0]) for val in total_base_value if val[0]])
            
            # Interactions totales
            total_interactions = self.db.query(BomAsset.interaction_count).filter(
                BomAsset.is_active == True
            ).all()
            total_interactions_sum = sum([val[0] for val in total_interactions if val[0]])
            
            logger.debug(f"💰 Valeur sociale totale: {total_social_sum}")
            logger.debug(f"💰 Valeur de base totale: {total_base_sum}")
            logger.debug(f"📈 Interactions totales: {total_interactions_sum}")
            
            # BOOMS par catégorie
            categories = self.db.query(
                BomAsset.category, 
                self.db.func.count(BomAsset.id)
            ).filter(
                BomAsset.is_active == True
            ).group_by(BomAsset.category).all()
            
            # BOOMS viraux
            viral_booms = self.db.query(BomAsset).filter(
                BomAsset.social_event == 'viral'
            ).count()
            
            # Achats aujourd'hui
            today = datetime.utcnow().date()
            purchases_today = self.db.query(UserBom).filter(
                self.db.func.date(UserBom.acquired_at) == today
            ).count()
            
            # Score social moyen
            avg_social_score = self.db.query(self.db.func.avg(BomAsset.social_score)).filter(
                BomAsset.is_active == True
            ).scalar() or 0
            
            # ✅ NOUVELLES MÉTRIQUES SOCIALES
            total_buys = self.db.query(self.db.func.sum(BomAsset.buy_count)).filter(
                BomAsset.is_active == True
            ).scalar() or 0
            
            total_sells = self.db.query(self.db.func.sum(BomAsset.sell_count)).filter(
                BomAsset.is_active == True
            ).scalar() or 0
            
            total_shares = self.db.query(self.db.func.sum(BomAsset.share_count)).filter(
                BomAsset.is_active == True
            ).scalar() or 0
            
            stats_duration = (datetime.utcnow() - stats_start).total_seconds()
            logger.info(f"✅ Statistiques récupérées en {stats_duration:.2f}s")
            logger.info(f"   📈 Aujourd'hui: {purchases_today} achats")
            logger.info(f"   🔥 BOOMS viraux: {viral_booms}")
            logger.info(f"   ⭐ Score moyen: {avg_social_score:.2f}")
            
            return {
                "total_booms": total_booms,
                "total_collections": total_collections,
                "total_artists": total_artists,
                "total_base_value": total_base_sum,
                "total_social_value": total_social_sum,
                "total_value": total_base_sum + total_social_sum,
                "total_interactions": total_interactions_sum,
                "social_activity": {
                    "total_buys": total_buys,
                    "total_sells": total_sells,
                    "total_shares": total_shares,
                    "buy_sell_ratio": total_buys / total_sells if total_sells > 0 else float('inf')
                },
                "average_social_score": float(avg_social_score),
                "purchases_today": purchases_today,
                "viral_booms": viral_booms,
                "categories": {cat: count for cat, count in categories},
                "calculation_time": stats_duration,
                "timestamp": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            stats_duration = (datetime.utcnow() - stats_start).total_seconds()
            logger.error(f"❌ Erreur statistiques après {stats_duration:.2f}s: {str(e)}", exc_info=True)
            return {
                "total_booms": 0,
                "total_collections": 0,
                "total_artists": 0,
                "total_base_value": 0,
                "total_social_value": 0,
                "total_value": 0,
                "total_interactions": 0,
                "social_activity": {
                    "total_buys": 0,
                    "total_sells": 0,
                    "total_shares": 0,
                    "buy_sell_ratio": 0
                },
                "average_social_score": 0,
                "purchases_today": 0,
                "viral_booms": 0,
                "categories": {},
                "calculation_time": stats_duration,
                "timestamp": datetime.utcnow().isoformat(),
                "error": str(e)
            }
    
    def get_service_stats(self) -> Dict:
        """
        Récupérer les statistiques du service PurchaseService
        """
        logger.debug("📊 Récupération statistiques service")
        
        try:
            # Statistiques de performance (à implémenter avec un cache ou DB)
            stats = {
                "service_name": "PurchaseService",
                "status": "active",
                "websocket_enabled": self.websocket_enabled,
                "database_session": f"session_{id(self.db)}",
                "methods_available": [
                    "purchase_bom",
                    "get_user_inventory",
                    "transfer_bom",
                    "list_bom_for_trade",
                    "execute_sell",  # ✅ NOUVELLE MÉTHODE AJOUTÉE
                    "get_boom_stats"
                ],
                "security_features": {
                    "atomic_transactions": True,
                    "exclusive_locks": True,
                    "deadlock_retry": True,
                    "lock_timeout": LOCK_TIMEOUT,
                    "max_retries": MAX_RETRIES
                },
                "timestamp": datetime.utcnow().isoformat(),
                "memory_info": "N/A"
            }
            
            logger.debug(f"📊 Statistiques service récupérées")
            return stats
            
        except Exception as e:
            logger.error(f"❌ Erreur statistiques service: {e}")
            return {
                "service_name": "PurchaseService",
                "status": "error",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
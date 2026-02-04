"""
SERVICE DE MARCHÉ SOCIAL BOOMS
Système de trading social avec valeur basée sur les interactions sociales
Version 100% sécurisée contre les races conditions
Seule modification : utiliser les bons types de transaction
"""
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import math
import random
from typing import Dict, List, Optional
import logging
import asyncio
import threading
from sqlalchemy import select, func
from sqlalchemy.exc import OperationalError, IntegrityError

from app.models.bom_models import BomAsset, UserBom
from app.models.user_models import User, Wallet
from app.models.gift_models import GiftTransaction, GiftStatus
from app.models.admin_models import PlatformTreasury
from app.models.transaction_models import Transaction
from app.services.social_value_calculator import SocialValueCalculator
from app.services.wallet_service import get_platform_treasury 
from app.services.social_value_utils import calculate_social_delta
from app.websockets.websockets import broadcast_balance_update
from app.models.payment_models import CashBalance

from app.services.treasury_debug import (
    trace_treasury_movement,
    trace_boom_purchase_decomposition
)

logger = logging.getLogger(__name__)

# ============ CONSTANTES DE SÉCURITÉ ============
MAX_RETRIES = 3
DEADLOCK_RETRY_DELAY = 0.1
LOCK_TIMEOUT = 30  # secondes
SOCIAL_MARKET_BUY_RATE = Decimal('0.0015')   # 0.15% du coût total
SOCIAL_MARKET_SELL_RATE = Decimal('0.0010')  # 0.10% retiré lors d'une vente


class MarketService:
    def __init__(self, db: Session):
        self.db = db
        # ============ LOCKS PAR UTILISATEUR ============
        self._user_locks = {}
        self._user_lock = threading.Lock()
        
    def _get_user_lock(self, user_id: int) -> threading.Lock:
        """Obtenir un lock unique par utilisateur"""
        with self._user_lock:
            if user_id not in self._user_locks:
                self._user_locks[user_id] = threading.Lock()
            return self._user_locks[user_id]
    
    # AJOUT: Méthode de broadcast sécurisée
    def _safe_broadcast(self, user_id: int, amount: float, balance_type: str = "real"):
        """Broadcast sécurisé sans erreur de variable"""
        try:
            from app.websockets.websockets import broadcast_balance_update
            import asyncio
            import threading
            
            def _broadcast_internal():
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    loop.run_until_complete(
                        broadcast_balance_update(user_id, amount, balance_type)
                    )
                    loop.close()
                    print(f"📡 Broadcast {balance_type} sécurisé: user {user_id} → {amount}")
                except Exception as e:
                    print(f"⚠️ Erreur broadcast sécurisé: {e}")
            
            thread = threading.Thread(target=_broadcast_internal, daemon=True)
            thread.start()
            
        except Exception as e:
            print(f"❌ Erreur création broadcast sécurisé: {e}")
    
    # === LOGIQUE SOCIAL TRADING - VALEUR BASÉE SUR INTERACTIONS ===
    
    def calculate_social_value(self, boom_id: int) -> Decimal:
        """Calculer la valeur sociale d'un BOOM basée sur les interactions"""
        boom = self.db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if not boom:
            raise ValueError(f"Boom {boom_id} non trouvé")
        
        # ✅ UTILISER LE CALCULATEUR SOCIAL EXISTANT
        social_calculator = SocialValueCalculator(self.db)
        return social_calculator.calculate_current_value(boom_id)
    
    def _calculate_share_factor(self, boom: BomAsset) -> Decimal:
        """Facteur basé sur les partages 7 derniers jours"""
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        
        share_count = self.db.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id.in_(
                self.db.query(UserBom.id).filter(UserBom.bom_id == boom.id)
            ),
            GiftTransaction.sent_at >= week_ago,
            GiftTransaction.status == GiftStatus.ACCEPTED
        ).count()
        
        # Logarithme pour éviter l'explosion
        if share_count == 0:
            return Decimal('0.8')
        
        share_factor = min(1.0 + (math.log10(share_count + 1) * 0.15), 1.5)
        return Decimal(str(share_factor))
    
    def _calculate_holder_factor(self, boom: BomAsset) -> Decimal:
        """Facteur basé sur le nombre de détenteurs uniques ACTIFS"""
        
        # ✅ CORRECTION: Seulement les détenteurs ACTIFS (non transférés)
        unique_holders = self.db.query(UserBom.user_id).filter(
            UserBom.bom_id == boom.id,
            UserBom.transferred_at.is_(None),  # ← PATCH APPLIQUÉ
            UserBom.is_transferable == True
        ).distinct().count()
        
        # Plus de détenteurs = plus stable/valuable
        if unique_holders == 0:
            return Decimal('0.9')
        
        holder_factor = min(1.0 + (unique_holders / 20 * 0.3), 1.3)
        return Decimal(str(holder_factor))
    
    def _calculate_acceptance_factor(self, boom: BomAsset) -> Decimal:
        """Facteur basé sur le taux d'acceptation des cadeaux"""
        gifts = self.db.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id.in_(
                self.db.query(UserBom.id).filter(UserBom.bom_id == boom.id)
            )
        ).all()
        
        if not gifts:
            return Decimal('1.0')
        
        accepted = sum(1 for g in gifts if g.status == GiftStatus.ACCEPTED)
        total = len(gifts)
        
        acceptance_rate = accepted / total if total > 0 else 0
        
        # 50% = neutre (1.0), 100% = +20%, 0% = -20%
        acceptance_factor = 0.8 + (acceptance_rate * 0.4)
        return Decimal(str(acceptance_factor))
    
    def _calculate_time_factor(self, boom: BomAsset) -> Decimal:
        """Facteur basé sur l'âge du BOOM"""
        if not boom.created_at:
            return Decimal('1.0')
        
        age_days = (datetime.now(timezone.utc) - boom.created_at).days
        
        # Plus vieux = plus stable (mais moins "nouveau")
        if age_days < 7:
            # Nouveau : légère prime
            return Decimal('1.1')
        elif age_days < 30:
            # Jeune : neutre
            return Decimal('1.0')
        else:
            # Vieux : prime de stabilité
            stability = min(age_days / 100, 0.2)  # Max +20%
            return Decimal(str(1.0 + stability))
    
    def _calculate_social_score(self, boom: BomAsset) -> Decimal:
        """Calculer un score social global"""
        share_factor = self._calculate_share_factor(boom)
        holder_factor = self._calculate_holder_factor(boom)
        acceptance_factor = self._calculate_acceptance_factor(boom)
        
        return (share_factor + holder_factor + acceptance_factor) / Decimal('3')
    
    def get_boom_market_data(self, boom_id: int) -> Dict:
        """Obtenir les données marché sociales pour un BOOM"""
        boom = self.db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if not boom:
            raise ValueError(f"Boom {boom_id} non trouvé")
        
        # ✅ CALCULER LA VALEUR SOCIALE ACTUELLE
        current_social_value = self.calculate_social_value(boom_id)
        
        # Calculer les prix avec frais sociaux
        buy_price = self.get_buy_price(boom_id)
        sell_price = self.get_sell_price(boom_id)
        
        # Statistiques sociales
        share_count_24h = self._get_share_count_24h(boom_id)
        
        # ✅ CORRECTION: Détenteurs uniques ACTIFS seulement
        unique_holders = self.db.query(UserBom.user_id).filter(
            UserBom.bom_id == boom_id,
            UserBom.transferred_at.is_(None)  # ← PATCH APPLIQUÉ
        ).distinct().count()
        
        # Score social
        social_score = float(self._calculate_social_score(boom))
        
        # Historique des prix (simulation basée sur activité sociale)
        price_history = self._generate_social_price_history(boom)
        
        # Événement social actif
        social_event = None
        if hasattr(boom, 'social_event') and boom.social_event:
            social_event = {
                "type": boom.social_event,
                "message": getattr(boom, 'social_event_message', 'Événement social actif'),
                "expires_at": getattr(boom, 'social_event_expires_at', None),
                "boost_percentage": self._get_social_event_boost(boom.social_event)
            }
        
        # Recommendation sociale
        recommendation = self._get_social_recommendation(social_score, share_count_24h, unique_holders)
        
        # ✅ CORRECTION: Gestion sécurisée des attributs optionnels
        base_price_value = getattr(boom, 'base_price', None)
        if base_price_value is None:
            base_price_value = getattr(boom, 'purchase_price', 0)
        
        base_value = getattr(boom, 'base_value', base_price_value or 0) or 0
        social_value = getattr(boom, 'social_value', Decimal('0')) or Decimal('0')
        
        # === AJOUT DES 4 CHAMPS MANQUANTS POUR BoomMarketData ===
        prices = {
            "current": float(current_social_value),
            "buy": float(buy_price),
            "sell": float(sell_price),
            "base": float(base_price_value or 0)
        }

        market_stats = {
            "volume_24h": getattr(boom, 'total_volume_24h', 0) or 0,
            "trade_count": getattr(boom, 'trade_count', 0) or 0,
            "unique_holders": unique_holders,
            "share_count_24h": share_count_24h
        }

        change = {
            "24h": 2.5,  # Tu peux calculer dynamiquement plus tard
            "7d": 8.3,
            "30d": 15.7
        }

        event = social_event  # Réutilise l'événement social déjà calculé
        
        return {
            "boom_id": boom.id,
            "title": boom.title,
            "artist": boom.artist,
            "collection": boom.collection.name if boom.collection else None,
            "current_social_value": float(current_social_value),
            "base_price": float(base_price_value),
            "buy_price": float(buy_price),
            "sell_price": float(sell_price),
            "spreads": {
                "buy_spread_percent": float((buy_price - current_social_value) / current_social_value * 100) if current_social_value > 0 else 0,
                "sell_spread_percent": float((current_social_value - sell_price) / current_social_value * 100) if current_social_value > 0 else 0
            },
            "social_metrics": {
                "social_value": float(social_value),
                "base_value": float(base_value),
                "total_value": float(Decimal(str(base_value)) + social_value),
                "buy_count": getattr(boom, 'buy_count', 0) or 0,
                "sell_count": getattr(boom, 'sell_count', 0) or 0,
                "share_count": getattr(boom, 'share_count', 0) or 0,
                "interaction_count": getattr(boom, 'interaction_count', 0) or 0,
                "social_score": social_score,
                "share_count_24h": share_count_24h,
                "unique_holders": unique_holders,
                "gift_acceptance_rate": float(boom.gift_acceptance_rate) if hasattr(boom, 'gift_acceptance_rate') and boom.gift_acceptance_rate else 0.0,
                "daily_interaction_score": float(boom.daily_interaction_score) if hasattr(boom, 'daily_interaction_score') and boom.daily_interaction_score else 0.0,
                "community_engagement": self._get_community_engagement_level(social_score)
            },
            "market_analysis": {
                "sentiment": self._get_market_sentiment(social_score),
                "recommendation": recommendation,
                "social_trend": self._get_social_trend(boom_id),
                "risk_level": self._get_social_risk_level(boom)
            },
            "social_event": social_event,
            "price_history": price_history,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            # CORRECTION: Ajout des champs manquants pour BoomMarketData
            "prices": prices,
            "market_stats": market_stats,
            "change": change,
            "event": event
        }
    
    def get_buy_price(self, boom_id: int) -> Decimal:
        """Prix d'achat avec frais sociaux"""
        current_social_value = self.calculate_social_value(boom_id)
        
        # Frais sociaux: 5% (3% pour BOOMS, 2% pour l'artiste)
        buy_price = current_social_value * Decimal('1.05')
        
        return buy_price.quantize(Decimal('0.01'))
    
    def get_sell_price(self, boom_id: int) -> Decimal:
        """Prix de vente avec frais de retrait progressifs"""
        current_social_value = self.calculate_social_value(boom_id)
        
        boom = self.db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if boom and boom.created_at:
            age_days = (datetime.now(timezone.utc) - boom.created_at).days
            # Plus ancien = frais réduits (8-12%)
            withdrawal_fee = max(0.08, min(0.12, 0.12 - (age_days / 365 * 0.04)))
        else:
            withdrawal_fee = Decimal('0.10')  # 10% par défaut
        
        sell_price = current_social_value * (Decimal('1') - Decimal(str(withdrawal_fee)))
        
        return sell_price.quantize(Decimal('0.01'))
    
    async def execute_buy(self, db: Session, user_id: int, boom_id: int, quantity: int = 1) -> Dict:
        """
        Exécuter un achat de BOOM - Version corrigée avec création unique de transaction
        """
      
        # 🔒 LOCK UTILISATEUR POUR EMPÊCHER LES PARALLÈLES
        user_lock = self._get_user_lock(user_id)
        
        with user_lock:
            print(f"🔒 Lock utilisateur {user_id} acquis - Transactions sécurisées")
            print(f"\n{'='*80}")
            print(f"🔍 EXECUTE_BUY - DÉBUT")
            print(f"   User ID: {user_id}")
            print(f"   Boom ID: {boom_id}")
            print(f"   Quantité: {quantity}")
            print(f"{'='*80}")
        
            try:
                # === DEBUG TRÉSORERIE (si disponible) ===
                DEBUG_ENABLED = False
                try:
                    from app.services.treasury_debug import (
                        trace_treasury_movement,
                        trace_boom_purchase_decomposition
                    )
                    DEBUG_ENABLED = True
                    print(f"✅ Module treasury_debug disponible")
                except ImportError:
                    print(f"⚠️ Module treasury_debug non disponible")
                
                # 1. Vérifier l'utilisateur
                user = db.query(User).filter(User.id == user_id).first()
                if not user:
                    raise ValueError(f"Utilisateur {user_id} non trouvé")
                
                print(f"\n👤 UTILISATEUR:")
                print(f"   ID: {user.id}")
                print(f"   Phone: {user.phone}")
                print(f"   Nom: {user.full_name}")
                
                # 2. Vérifier le BOOM
                boom = db.query(BomAsset).filter(
                    BomAsset.id == boom_id,
                    BomAsset.is_active == True
                ).first()
                
                if not boom:
                    raise ValueError(f"Boom {boom_id} non disponible")
                
                print(f"\n🎯 BOOM À ACHETER:")
                print(f"   ID: {boom.id}")
                print(f"   Titre: {boom.title}")
                print(f"   Artiste: {boom.artist}")
                print(f"   Éditions max: {boom.max_editions}")
                print(f"   Éditions disponibles: {boom.available_editions}")
                
                # 3. Vérifier disponibilité
                if boom.max_editions and boom.available_editions and boom.available_editions < quantity:
                    raise ValueError(f"Stock insuffisant. Disponible: {boom.available_editions}")
                
                # 4. Calculer prix
                current_social_value = self.calculate_social_value(boom_id)
                buy_price = self.get_buy_price(boom_id)
                total_cost = buy_price * quantity
                
                print(f"\n💰 CALCULS FINANCIERS:")
                print(f"   Valeur sociale unitaire: {current_social_value} FCFA")
                print(f"   Prix d'achat unitaire: {buy_price} FCFA")
                print(f"   Quantité: {quantity}")
                print(f"   TOTAL À PAYER: {total_cost} FCFA")
                
                # === DEBUG DÉCOMPOSITION ACHAT ===
                if DEBUG_ENABLED:
                    trace_boom_purchase_decomposition(
                        db=db,
                        user_id=user_id,
                        boom_id=boom_id,
                        buy_price=buy_price,
                        social_value=current_social_value,
                        quantity=quantity
                    )
                
                # === COLLECTER LES FRAIS SOCIAUX ===
                fees_amount = (buy_price - current_social_value) * quantity
                print(f"\n💸 FRAIS SOCIAUX:")
                print(f"   Frais unitaires: {(buy_price - current_social_value)} FCFA")
                print(f"   Total frais: {fees_amount} FCFA")
                social_calculator = SocialValueCalculator(db)
                serialized_social_result = None
                
                # === TRANSACTION ATOMIQUE AVEC RETRY ===
                retry_count = 0
                last_exception = None
                
                while retry_count < MAX_RETRIES:
                    try:
                        print(f"\n{'~'*40}")
                        print(f"🔄 TENTATIVE {retry_count + 1}/{MAX_RETRIES}")
                        print(f"{'~'*40}")
                        
                        # === DEBUG TRÉSORERIE AVANT ===
                        if DEBUG_ENABLED:
                            trace_treasury_movement(
                                db=db,
                                operation="boom_purchase_start",
                                amount=Decimal('0.00'),
                                description=f"Début achat BOOM #{boom_id} ({boom.title})",
                                user_id=user_id
                            )
                        
                        # === ACQUISITION DES LOCKS ===
                        print(f"\n🔒 ACQUISITION DES LOCKS:")
                        
                        # 1. Lock Wallet (argent virtuel)
                        wallet_stmt = select(Wallet).where(Wallet.user_id == user_id).with_for_update()
                        wallet = db.execute(wallet_stmt).scalar_one_or_none()
                        
                        if not wallet:
                            raise ValueError("Portefeuille Wallet non trouvé")
                        
                        print(f"   ✅ Wallet locké:")
                        print(f"      ID: {wallet.id}")
                        print(f"      User ID: {wallet.user_id}")
                        print(f"      Solde (virtuel): {wallet.balance} FCFA")
                        print(f"      Devise: {wallet.currency}")
                        
                        # 2. Lock CashBalance (argent réel)
                        cash_stmt = select(CashBalance).where(CashBalance.user_id == user_id).with_for_update()
                        cash_balance = db.execute(cash_stmt).scalar_one_or_none()
                        
                        if not cash_balance:
                            raise ValueError("Compte CashBalance (argent réel) non trouvé")
                        
                        print(f"   ✅ CashBalance locké:")
                        print(f"      ID: {cash_balance.id}")
                        print(f"      User ID: {cash_balance.user_id}")
                        print(f"      Solde disponible (réel): {cash_balance.available_balance} FCFA")
                        print(f"      Solde bloqué: {cash_balance.locked_balance} FCFA")
                        print(f"      Devise: {cash_balance.currency}")
                        
                        # 3. Vérifier solde RÉEL
                        real_balance = cash_balance.available_balance
                        if real_balance is None:
                            real_balance = Decimal('0.00')
                            print(f"      ⚠️ Solde réel était NULL, corrigé à 0.00")
                        
                        # 4. Lock Boom
                        boom_stmt = select(BomAsset).where(
                            BomAsset.id == boom_id,
                            BomAsset.is_active == True
                        ).with_for_update()
                        boom = db.execute(boom_stmt).scalar_one_or_none()
                        
                        if not boom:
                            raise ValueError(f"Boom {boom_id} non disponible après lock")
                        
                        print(f"   ✅ Boom locké:")
                        print(f"      ID: {boom.id}")
                        print(f"      Titre: {boom.title}")
                        print(f"      Prix actuel: {boom.current_price} FCFA")
                        print(f"      Valeur sociale: {boom.social_value} FCFA")
                        
                        # 5. Lock Trésorerie
                        treasury_stmt = select(PlatformTreasury).with_for_update()
                        treasury = db.execute(treasury_stmt).scalar_one_or_none()
                        
                        if not treasury:
                            treasury = PlatformTreasury(balance=Decimal('0.00'), currency="FCFA")
                            db.add(treasury)
                            print(f"   ✅ Trésorerie créée (inexistante)")
                        else:
                            print(f"   ✅ Trésorerie lockée:")
                            print(f"      ID: {treasury.id}")
                            print(f"      Solde actuel: {treasury.balance} FCFA")
                            print(f"      Frais collectés: {treasury.total_fees_collected} FCFA")
                            print(f"      Transactions: {treasury.total_transactions}")
                        
                        # === VÉRIFICATION SOLDE RÉEL ===
                        print(f"\n🔍 VÉRIFICATION SOLDE RÉEL:")
                        print(f"   Argent RÉEL disponible: {real_balance} FCFA")
                        print(f"   Coût achat: {total_cost} FCFA")
                        print(f"   Différence: {real_balance - total_cost} FCFA")
                        print(f"   Suffisant? {'✅ OUI' if real_balance >= total_cost else '❌ NON'}")
                        
                        if real_balance < total_cost:
                            missing = total_cost - real_balance
                            print(f"\n❌ SOLDE RÉEL INSUFFISANT!")
                            print(f"   Manquant: {missing} FCFA")
                            print(f"   Argent VIRTUEL disponible: {wallet.balance} FCFA")
                            
                            raise ValueError(
                                f"💸 Solde RÉEL insuffisant pour achat BOOM. "
                                f"Disponible: {real_balance} FCFA, "
                                f"Nécessaire: {total_cost} FCFA, "
                                f"Manquant: {missing} FCFA"
                            )
                        
                        # === DEBUG TRÉSORERIE AVANT DÉBIT ===
                        if DEBUG_ENABLED:
                            trace_treasury_movement(
                                db=db,
                                operation="boom_purchase_fees_BEFORE",
                                amount=fees_amount,
                                description=f"DEBUG: Frais avant crédit pour BOOM #{boom_id} ({boom.title})",
                                user_id=user_id
                            )
                        
                        # === EXÉCUTION DE L'ACHAT ===
                        print(f"\n💸 EXÉCUTION DE L'ACHAT:")
                        
                        # A. Débiter CashBalance (argent réel)
                        old_cash = real_balance
                        cash_balance.available_balance = old_cash - total_cost
                        new_cash = cash_balance.available_balance
                        
                        print(f"   💰 DÉBIT ARGENT RÉEL:")
                        print(f"      Avant: {old_cash} FCFA")
                        print(f"      Après: {new_cash} FCFA")
                        print(f"      Différence: -{total_cost} FCFA")
                        
                        # B. Wallet reste inchangé (argent virtuel)
                        wallet_balance = wallet.balance
                        print(f"   💳 ARGENT VIRTUEL (inchangé):")
                        print(f"      Solde: {wallet_balance} FCFA")
                        
                        # C. Créditer la trésorerie (frais)
                        old_treasury = treasury.balance
                        treasury.balance += Decimal(str(fees_amount))  # ✅ PATCH APPLIQUÉ
                        treasury.total_fees_collected += Decimal(str(fees_amount))  # ✅ PATCH APPLIQUÉ
                        treasury.total_transactions += 1
                        treasury.last_transaction_at = func.now()
                        
                        print(f"   🏦 TRÉSORERIE:")
                        print(f"      Ancien solde: {old_treasury} FCFA")
                        print(f"      Nouveau solde: {treasury.balance} FCFA")
                        print(f"      Frais ajoutés: +{fees_amount} FCFA")
                        print(f"      Total frais collectés: {treasury.total_fees_collected} FCFA")
                        
                        # === DEBUG TRÉSORERIE APRÈS CRÉDIT ===
                        if DEBUG_ENABLED:
                            trace_treasury_movement(
                                db=db,
                                operation="boom_purchase_fees_AFTER",
                                amount=fees_amount,
                                description=f"CRÉDIT RÉEL: Frais achat BOOM #{boom_id} | Ancien solde: {old_treasury}",
                                user_id=user_id
                            )
                        
                        # D. Créer UserBom(s)
                        user_boms = []
                        for i in range(quantity):
                            user_bom = UserBom(
                                user_id=user_id,
                                bom_id=boom_id,
                                purchase_price=buy_price,
                                acquired_at=datetime.now(timezone.utc)
                            )
                            db.add(user_bom)
                            user_boms.append(user_bom)
                        
                        print(f"   🎯 USERBOMS CRÉÉS:")
                        print(f"      Quantité: {quantity}")
                        print(f"      IDs: {[ub.id for ub in user_boms if hasattr(ub, 'id')]}")
                        
                        # E. Créer transaction - UNIQUEMENT ICI (pas via wallet_service)
                        boom_transaction = Transaction(
                            user_id=user_id,
                            type="boom_purchase_real",  # ✅ FIXE: Champ type obligatoire
                            amount=float(total_cost),
                            transaction_type="boom_purchase_real",
                            description=(
                                f"Achat {quantity}x '{boom.title}' | "
                                f"Valeur sociale: {current_social_value} FCFA | "
                                f"Frais: {fees_amount:.2f} FCFA | Argent RÉEL utilisé"
                            ),
                            status="completed",
                            created_at=datetime.now(timezone.utc)
                        )
                        
                        db.add(boom_transaction)
                        db.flush()   # 🔴 CRITIQUE: flush pour obtenir l'ID
                        transaction_id = boom_transaction.id
                        
                        print(f"   📄 TRANSACTION BOOM (créée directement):")
                        print(f"      ID: {transaction_id}")
                        print(f"      Montant: {total_cost} FCFA")
                        print(f"      Type: boom_purchase_real")
                        print(f"      💡 Info: Transaction créée directement dans MarketService (évite double débit)")
                        
                        # F. Mettre à jour le BOOM
                        social_metadata = {
                            "channel": "market_buy",
                            "transaction_amount": float(total_cost),
                            "quantity": quantity,
                            "buyer_id": user_id,
                            "fees_amount": float(fees_amount)
                        }
                        social_action_result, _ = social_calculator.apply_social_action(
                            boom=boom,
                            action='buy',
                            user_id=user_id,
                            metadata=social_metadata,
                            create_history=True
                        )
                        serialized_social_result = social_calculator.serialize_action_result(social_action_result)
                        old_social_value = social_action_result["old_social_value"]
                        new_social_value = social_action_result["new_social_value"]
                        old_price = social_action_result["old_total_value"]
                        new_total_value = social_action_result["new_total_value"]
                        boom.current_price = new_total_value
                        if quantity > 1:
                            extra = max(0, quantity - 1)
                            boom.buy_count = (boom.buy_count or 0) + extra
                            boom.interaction_count = (boom.interaction_count or 0) + extra
                        print(f"   📈 BOOM MIS À JOUR:")
                        print(f"      Valeur sociale: {old_social_value} → {new_social_value}")
                        print(f"      Prix: {old_price} → {new_total_value}")
                        print(f"      Achats totaux: {boom.buy_count}")
                        print(f"      Interactions: {boom.interaction_count}")
                        
                        # G. Impact social
                        total_volume = getattr(boom, 'total_volume_24h', Decimal('0')) or Decimal('0')
                        setattr(boom, 'total_volume_24h', total_volume + Decimal(str(total_cost)))
                        
                        trade_count = getattr(boom, 'trade_count', 0) or 0
                        setattr(boom, 'trade_count', trade_count + 1)
                        
                        # Vérifier si BOOM devient viral
                        self._check_viral_status(boom)
                        
                        # === VALIDATION FINALE ===
                        db.flush()
                        db.commit()
                        
                        print(f"\n✅ VALIDATION RÉUSSIE:")
                        print(f"   Tous les objets flushés avec succès")
                        print(f"   UserBoms: {len(user_boms)} créé(s)")
                        print(f"   Transaction: {transaction_id} enregistrée")
                        
                        # === PRÉPARATION DE LA RÉPONSE ===
                        response = {
                            "success": True,
                            "message": f"Achat réussi de {quantity} {boom.title}",
                            "transaction_id": str(transaction_id),
                            "financial": {
                                "amount_paid": float(total_cost),
                                "fees": float(fees_amount),
                                "new_cash_balance": float(new_cash),
                                "wallet_balance": float(wallet_balance),
                                "cash_balance_before": float(old_cash),
                                "treasury_balance": float(treasury.balance)
                            },
                            "boom": {
                                "id": boom.id,
                                "title": boom.title,
                                "artist": boom.artist,
                                "new_social_value": float(boom.social_value),
                                "new_price": float(boom.current_price),
                                "buy_count": boom.buy_count,
                                "interaction_count": boom.interaction_count
                            },
                            "user": {
                                "id": user.id,
                                "phone": user.phone,
                                "full_name": user.full_name
                            },
                            "quantity": quantity,
                            "social_impact": serialized_social_result,
                            "debug_info": {
                                "tracing_enabled": DEBUG_ENABLED,
                                "attempts": retry_count + 1,
                                "cashbalance_change": float(old_cash - new_cash),
                                "treasury_change": float(fees_amount),
                                "social_delta": float(serialized_social_result["delta"]) if serialized_social_result else 0.0
                            },
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        
                        # CORRECTION: Utilisation de la méthode de broadcast sécurisée
                        self._safe_broadcast(user_id, float(new_cash), "real")
                        
                        print(f"\n📤 RÉPONSE PRÊTE:")
                        print(f"   Transaction ID: {response['transaction_id']}")
                        print(f"   Message: {response['message']}")
                        print(f"{'='*80}\n")
                        
                        return response
                            
                    except OperationalError as e:
                        if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                            retry_count += 1
                            last_exception = e
                            print(f"\n🔄 DEADLOCK DÉTECTÉ:")
                            print(f"   Retry {retry_count}/{MAX_RETRIES}")
                            print(f"   Erreur: {e}")
                            db.rollback()
                            await asyncio.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                            continue
                        else:
                            print(f"\n❌ ERREUR OPÉRATIONNELLE:")
                            print(f"   {e}")
                            db.rollback()
                            raise
                    
                    except (IntegrityError, ValueError) as e:
                        print(f"\n❌ ERREUR D'INTÉGRITÉ/VALEUR:")
                        print(f"   {e}")
                        db.rollback()
                        raise
                    
                    except Exception as e:
                        print(f"\n❌ ERREUR INATTENDUE:")
                        print(f"   {e}")
                        import traceback
                        traceback.print_exc()
                        db.rollback()
                        raise
                
                if last_exception:
                    raise Exception(f"Échec après {MAX_RETRIES} tentatives: {last_exception}")
                
            except Exception as e:
                print(f"\n{'='*80}")
                print(f"❌ ERREUR FATALE DANS EXECUTE_BUY")
                print(f"   User: {user_id}, Boom: {boom_id}")
                print(f"   Erreur: {e}")
                print(f"{'='*80}")
                import traceback
                traceback.print_exc()
                raise


    async def execute_sell(self, db: Session, user_id: int, user_bom_id: int, quantity: int = 1) -> Dict:
        """
        Exécuter une vente de BOOM - Version CORRIGÉE sans création de UserBom
        """
        
        # 🔒 LOCK UTILISATEUR POUR EMPÊCHER LES PARALLÈLES
        user_lock = self._get_user_lock(user_id)
        
        with user_lock:
            print(f"🔒 Lock utilisateur {user_id} acquis - Transactions sécurisées")
            print(f"\n{'='*80}")
            print(f"📤 EXECUTE_SELL - DÉBUT")
            print(f"   User ID: {user_id}")
            print(f"   UserBom ID: {user_bom_id}")
            print(f"   Quantité: {quantity}")
            print(f"{'='*80}")
        
            try:
                # === DEBUG TRÉSORERIE (si disponible) ===
                DEBUG_ENABLED = False
                try:
                    from app.services.treasury_debug import (
                        trace_treasury_movement,
                        trace_boom_purchase_decomposition
                    )
                    DEBUG_ENABLED = True
                    print(f"✅ Module treasury_debug disponible")
                except ImportError:
                    print(f"⚠️ Module treasury_debug non disponible")
                social_calculator = SocialValueCalculator(db)
                serialized_social_result = None
                
                # === TRANSACTION ATOMIQUE AVEC RETRY ===
                retry_count = 0
                last_exception = None
                
                while retry_count < MAX_RETRIES:
                    try:
                        print(f"\n{'~'*40}")
                        print(f"🔄 TENTATIVE {retry_count + 1}/{MAX_RETRIES}")
                        print(f"{'~'*40}")
                        
                        # === DEBUG TRÉSORERIE AVANT ===
                        if DEBUG_ENABLED:
                            trace_treasury_movement(
                                db=db,
                                operation="boom_sell_start",
                                amount=Decimal('0.00'),
                                description=f"Début vente UserBom #{user_bom_id}",
                                user_id=user_id
                            )
                        
                        # === ACQUISITION DES LOCKS ===
                        print(f"\n🔒 ACQUISITION DES LOCKS:")
                        
                        # 1. Lock du UserBom
                        user_bom_stmt = select(UserBom).where(
                            UserBom.id == user_bom_id,
                            UserBom.user_id == user_id
                        ).with_for_update()
                        
                        user_bom = db.execute(user_bom_stmt).scalar_one_or_none()
                        
                        if not user_bom:
                            raise ValueError("BOOM non trouvé dans votre inventaire")
                        
                        # Vérifier si déjà vendu
                        if hasattr(user_bom, 'is_sold') and user_bom.is_sold:
                            raise ValueError("Ce BOOM a déjà été vendu")
                        
                        # Vérifier soft delete
                        if hasattr(user_bom, 'deleted_at') and user_bom.deleted_at is not None:
                            raise ValueError("Ce BOOM n'est plus disponible à la vente")
                        
                        print(f"   ✅ UserBom locké:")
                        print(f"      ID: {user_bom.id}")
                        print(f"      User ID: {user_bom.user_id}")
                        print(f"      Boom ID: {user_bom.bom_id}")
                        print(f"      Prix d'achat: {user_bom.purchase_price} FCFA")
                        print(f"      Date acquisition: {user_bom.acquired_at}")
                        
                        # Récupérer le BOOM associé
                        boom = user_bom.bom
                        if not boom:
                            raise ValueError(f"Boom associé non trouvé")
                        
                        print(f"   ✅ Boom associé:")
                        print(f"      ID: {boom.id}")
                        print(f"      Titre: {boom.title}")
                        print(f"      Artiste: {boom.artist}")
                        print(f"      Valeur sociale actuelle: {boom.social_value}")
                        print(f"      Prix actuel: {boom.current_price}")
                        
                        # 2. Lock du BOOM
                        boom_stmt = select(BomAsset).where(BomAsset.id == boom.id).with_for_update()
                        boom = db.execute(boom_stmt).scalar_one()
                        
                        # 3. Lock du wallet utilisateur (argent VIRTUEL)
                        wallet_stmt = select(Wallet).where(Wallet.user_id == user_id).with_for_update()
                        wallet = db.execute(wallet_stmt).scalar_one_or_none()
                        
                        if not wallet:
                            wallet = Wallet(user_id=user_id, balance=Decimal('0.00'), currency="FCFA")
                            db.add(wallet)
                            print(f"   ✅ Wallet créé (inexistant)")
                        else:
                            print(f"   ✅ Wallet locké (argent VIRTUEL):")
                            print(f"      ID: {wallet.id}")
                            print(f"      User ID: {wallet.user_id}")
                            print(f"      Solde virtuel: {wallet.balance} FCFA")
                            print(f"      Devise: {wallet.currency}")
                        
                        # 4. Lock du CashBalance (argent RÉEL)
                        cash_stmt = select(CashBalance).where(CashBalance.user_id == user_id).with_for_update()
                        cash_balance = db.execute(cash_stmt).scalar_one_or_none()
                        
                        if not cash_balance:
                            cash_balance = CashBalance(
                                user_id=user_id,
                                available_balance=Decimal('0.00'),
                                currency="FCFA"
                            )
                            db.add(cash_balance)
                            print(f"   ✅ CashBalance créé (inexistant)")
                        else:
                            print(f"   ✅ CashBalance locké (argent RÉEL):")
                            print(f"      ID: {cash_balance.id}")
                            print(f"      User ID: {cash_balance.user_id}")
                            print(f"      Solde réel disponible: {cash_balance.available_balance} FCFA")
                            print(f"      Solde bloqué: {cash_balance.locked_balance} FCFA")
                            print(f"      Devise: {cash_balance.currency}")
                        
                        # 5. Lock de la trésorerie
                        treasury_stmt = select(PlatformTreasury).with_for_update()
                        treasury = db.execute(treasury_stmt).scalar_one_or_none()
                        
                        if not treasury:
                            treasury = PlatformTreasury(balance=Decimal('0.00'), currency="FCFA")
                            db.add(treasury)
                            print(f"   ✅ Trésorerie créée (inexistante)")
                        else:
                            print(f"   ✅ Trésorerie lockée:")
                            print(f"      ID: {treasury.id}")
                            print(f"      Solde actuel: {treasury.balance} FCFA")
                            print(f"      Frais collectés: {treasury.total_fees_collected} FCFA")
                            print(f"      Transactions: {treasury.total_transactions}")
                        
                        # === CALCULS FINANCIERS ===
                        print(f"\n💰 CALCULS FINANCIERS:")
                        
                        # Valeur sociale actuelle
                        current_social_value = self.calculate_social_value(boom.id)
                        print(f"   Valeur sociale actuelle: {current_social_value} FCFA")
                        
                        # Prix de vente avec frais
                        sell_price = self.get_sell_price(boom.id)
                        print(f"   Prix de vente (après frais): {sell_price} FCFA")
                        
                        # Frais de retrait
                        fees_amount = current_social_value - sell_price
                        print(f"   Frais de retrait: {fees_amount} FCFA")
                        print(f"   Taux frais: {(fees_amount / current_social_value * 100) if current_social_value > 0 else 0:.2f}%")
                        
                        # Prix d'achat original
                        purchase_price = user_bom.purchase_price or boom.purchase_price or Decimal('0.00')
                        print(f"   Prix d'achat original: {purchase_price} FCFA")
                        
                        # Gain/Perte
                        profit_loss = Decimal(str(sell_price)) - Decimal(str(purchase_price))
                        profit_percentage = (profit_loss / Decimal(str(purchase_price)) * 100) if Decimal(str(purchase_price)) > 0 else 0
                        print(f"   Gain/Perte: {profit_loss} FCFA ({profit_percentage:.2f}%)")
                        print(f"\n   📊 RÉSUMÉ TRANSACTION:")
                        print(f"      Acheté à: {purchase_price} FCFA")
                        print(f"      Vendu à: {sell_price} FCFA")
                        print(f"      Frais: {fees_amount} FCFA")
                        print(f"      Net: {profit_loss} FCFA")
                        
                        # === DEBUG TRÉSORERIE AVANT CRÉDIT ===
                        if DEBUG_ENABLED:
                            trace_treasury_movement(
                                db=db,
                                operation="boom_sell_fees_BEFORE",
                                amount=fees_amount,
                                description=f"DEBUG: Frais avant crédit vente BOOM #{boom.id} ({boom.title})",
                                user_id=user_id
                            )
                        
                        # === EXÉCUTION DE LA VENTE ===
                        print(f"\n💸 EXÉCUTION DE LA VENTE:")
                        
                        # A. Créditer la trésorerie (frais)
                        old_treasury_balance = treasury.balance
                        treasury.balance += Decimal(str(fees_amount))
                        treasury.total_fees_collected += Decimal(str(fees_amount))
                        treasury.total_transactions += 1
                        treasury.last_transaction_at = func.now()
                        
                        print(f"   🏦 TRÉSORERIE CRÉDITÉE (frais):")
                        print(f"      Ancien solde: {old_treasury_balance} FCFA")
                        print(f"      Nouveau solde: {treasury.balance} FCFA")
                        print(f"      Frais ajoutés: +{fees_amount} FCFA")
                        print(f"      Total frais collectés: {treasury.total_fees_collected} FCFA")
                        
                        # B. Créditer CashBalance (argent RÉEL)
                        old_cash_balance = cash_balance.available_balance or Decimal('0.00')
                        cash_balance.available_balance = old_cash_balance + Decimal(str(sell_price))
                        new_cash_balance = cash_balance.available_balance
                        
                        print(f"   💰 CASHBALANCE CRÉDITÉ (argent RÉEL):")
                        print(f"      Ancien solde: {old_cash_balance} FCFA")
                        print(f"      Nouveau solde: {new_cash_balance} FCFA")
                        print(f"      Montant crédité: +{sell_price} FCFA")
                        print(f"      💡 Note: La vente crédite l'argent RÉEL")
                        
                        # C. Wallet (argent VIRTUEL) reste inchangé
                        wallet_balance = wallet.balance
                        print(f"   💳 WALLET (argent VIRTUEL inchangé):")
                        print(f"      Solde: {wallet_balance} FCFA")
                        
                        # === DEBUG TRÉSORERIE APRÈS CRÉDIT ===
                        if DEBUG_ENABLED:
                            trace_treasury_movement(
                                db=db,
                                operation="boom_sell_fees_AFTER",
                                amount=fees_amount,
                                description=f"CRÉDIT RÉEL: Frais vente BOOM #{boom.id} | Ancien solde: {old_treasury_balance}",
                                user_id=user_id
                            )
                        
                        # D. Créer transaction
                        boom_sell_transaction = Transaction(
                            user_id=user_id,
                            type="boom_sell_real",  # ✅ FIXE: Champ type obligatoire
                            amount=float(sell_price),
                            transaction_type="boom_sell_real",
                            description=(
                                f"Vente '{boom.title}' | "
                                f"Frais: {fees_amount:.2f} FCFA | "
                                f"Gain: {profit_loss:.2f} FCFA | Argent RÉEL crédité"
                            ),
                            status="completed",
                            created_at=datetime.now(timezone.utc)
                        )
                        
                        db.add(boom_sell_transaction)
                        db.flush()
                        transaction_id = boom_sell_transaction.id
                        
                        print(f"   📄 TRANSACTION BOOM VENTE (créée directement):")
                        print(f"      ID: {transaction_id}")
                        print(f"      Montant: {sell_price} FCFA")
                        print(f"      Type: boom_sell_real")
                        
                        # E. MARQUER COMME VENDU (soft delete)
                        if hasattr(user_bom, 'is_sold'):
                            user_bom.is_sold = True
                        
                        if hasattr(user_bom, 'deleted_at'):
                            user_bom.deleted_at = datetime.now(timezone.utc)
                        
                        db.flush()
                        
                        print(f"   🗑️  UserBom marqué comme VENDU:")
                        print(f"      ID: {user_bom_id}")
                        print(f"      Boom: {boom.title}")
                        print(f"      is_sold: {getattr(user_bom, 'is_sold', 'N/A')}")
                        print(f"      deleted_at: {getattr(user_bom, 'deleted_at', 'N/A')}")
                        
                        # F. Mettre à jour le BOOM
                        social_metadata = {
                            "channel": "market_sell",
                            "transaction_amount": float(sell_price),
                            "quantity": quantity,
                            "seller_id": user_id,
                            "fees_amount": float(fees_amount),
                            "profit_loss": float(profit_loss)
                        }
                        social_action_result, _ = social_calculator.apply_social_action(
                            boom=boom,
                            action='sell',
                            user_id=user_id,
                            metadata=social_metadata,
                            create_history=True
                        )
                        serialized_social_result = social_calculator.serialize_action_result(social_action_result)
                        old_social_value = social_action_result["old_social_value"]
                        new_social_value = social_action_result["new_social_value"]
                        old_price = social_action_result["old_total_value"]
                        new_total_value = social_action_result["new_total_value"]
                        boom.current_price = new_total_value
                        if quantity > 1:
                            extra = max(0, quantity - 1)
                            boom.sell_count = (boom.sell_count or 0) + extra
                            boom.interaction_count = (boom.interaction_count or 0) + extra
                        print(f"   📈 BOOM MIS À JOUR:")
                        print(f"      Valeur sociale: {old_social_value} → {new_social_value}")
                        print(f"      Prix: {old_price} → {new_total_value}")
                        print(f"      Ventes totales: {boom.sell_count}")
                        print(f"      Interactions: {boom.interaction_count}")
                        
                        # G. Remettre en stock si édition limitée
                        if boom.max_editions and boom.available_editions is not None:
                            old_available = boom.available_editions
                            boom.available_editions = min(boom.max_editions, boom.available_editions + 1)
                            print(f"   📦 STOCK MIS À JOUR:")
                            print(f"      Ancien disponible: {old_available}")
                            print(f"      Nouveau disponible: {boom.available_editions}")
                            print(f"      💡 Le BOOM retourne au marché")
                        
                        # H. Impact social
                        total_volume = getattr(boom, 'total_volume_24h', Decimal('0')) or Decimal('0')
                        setattr(boom, 'total_volume_24h', total_volume + Decimal(str(sell_price)))
                        
                        # === VALIDATION FINALE ===
                        db.flush()
                        db.commit()
                        
                        print(f"\n✅ VENTE RÉUSSIE!")
                        print(f"   UserBom #{user_bom_id} vendu")
                        print(f"   Montant reçu (RÉEL): {sell_price} FCFA")
                        print(f"   Frais retenus: {fees_amount} FCFA")
                        print(f"   Gain/Perte: {profit_loss} FCFA")
                        print(f"   Nouveau solde RÉEL: {new_cash_balance} FCFA")
                        print(f"   Solde VIRTUEL inchangé: {wallet_balance} FCFA")
                        
                        # === PRÉPARATION DE LA RÉPONSE ===
                        response = {
                            "success": True,
                            "message": f"Vente de '{boom.title}' réussie",
                            "transaction_id": str(transaction_id),
                            "financial": {
                                "amount_received": float(sell_price),
                                "fees": float(fees_amount),
                                "profit_loss": float(profit_loss),
                                "profit_percentage": float(profit_percentage),
                                "new_cash_balance": float(new_cash_balance),
                                "cash_balance_before": float(old_cash_balance),
                                "wallet_balance": float(wallet_balance),
                                "treasury_balance": float(treasury.balance)
                            },
                            "boom": {
                                "id": boom.id,
                                "title": boom.title,
                                "artist": boom.artist,
                                "new_social_value": float(boom.social_value),
                                "new_price": float(boom.current_price),
                                "sell_count": boom.sell_count,
                                "interaction_count": boom.interaction_count,
                                "available_editions": boom.available_editions if hasattr(boom, 'available_editions') else None
                            },
                            "original_purchase": {
                                "price": float(purchase_price),
                                "date": user_bom.acquired_at.isoformat() if user_bom.acquired_at else None
                            },
                            "balances": {
                                "real_balance": float(new_cash_balance),
                                "virtual_balance": float(wallet_balance),
                                "real_balance_change": float(sell_price),
                                "virtual_balance_change": 0.0
                            },
                            "social_impact": serialized_social_result,
                            "debug_info": {
                                "tracing_enabled": DEBUG_ENABLED,
                                "attempts": retry_count + 1,
                                "cash_balance_change": float(sell_price),
                                "treasury_change": float(fees_amount),
                                "social_delta": float(serialized_social_result["delta"]) if serialized_social_result else 0.0
                            },
                            "timestamp": datetime.now(timezone.utc).isoformat()
                        }
                        
                        # CORRECTION: Broadcast sécurisé
                        self._safe_broadcast(user_id, float(new_cash_balance), "real")
                        
                        print(f"\n📤 RÉPONSE PRÊTE:")
                        print(f"   Transaction ID: {response['transaction_id']}")
                        print(f"   Argent RÉEL crédité: {sell_price} FCFA")
                        print(f"   Nouveau solde RÉEL: {new_cash_balance} FCFA")
                        print(f"   💡 Le BOOM retourne au marché (disponible: {boom.available_editions})")
                        print(f"{'='*80}\n")
                        
                        return response
                            
                    except OperationalError as e:
                        if "deadlock" in str(e).lower() and retry_count < MAX_RETRIES - 1:
                            retry_count += 1
                            last_exception = e
                            print(f"\n🔄 DEADLOCK DÉTECTÉ:")
                            print(f"   Retry {retry_count}/{MAX_RETRIES}")
                            print(f"   Erreur: {e}")
                            db.rollback()
                            await asyncio.sleep(DEADLOCK_RETRY_DELAY * retry_count)
                            continue
                        else:
                            print(f"\n❌ ERREUR OPÉRATIONNELLE:")
                            print(f"   {e}")
                            db.rollback()
                            raise
                    
                    except (IntegrityError, ValueError) as e:
                        print(f"\n❌ ERREUR D'INTÉGRITÉ/VALEUR:")
                        print(f"   {e}")
                        db.rollback()
                        raise
                    
                    except Exception as e:
                        print(f"\n❌ ERREUR INATTENDUE:")
                        print(f"   {e}")
                        import traceback
                        traceback.print_exc()
                        db.rollback()
                        raise
                
                if last_exception:
                    raise Exception(f"Échec après {MAX_RETRIES} tentatives: {last_exception}")
                
            except Exception as e:
                print(f"\n{'='*80}")
                print(f"❌ ERREUR FATALE DANS EXECUTE_SELL")
                print(f"   User: {user_id}, UserBom: {user_bom_id}")
                print(f"   Erreur: {e}")
                print(f"{'='*80}")
                import traceback
                traceback.print_exc()
                raise
    
    def get_market_overview(self) -> Dict:
        """Obtenir aperçu du marché social"""
        booms = self.db.query(BomAsset).filter(
            BomAsset.is_active == True
        ).all()
        
        if not booms:
            return {
                "total_market_cap": 0,
                "total_volume_24h": 0,
                "active_nfts": 0,
                "total_social_score": 0,
                "trending_booms": [],
                "most_shared": [],
                "viral_booms": [],
                "average_acceptance_rate": 0
            }
        
        # Calculer valeurs sociales
        social_values = []
        base_values = []
        total_values = []
        social_scores = []
        acceptance_rates = []
        
        # ✅ NOUVELLES MÉTRIQUES SOCIALES
        total_social_value_sum = Decimal('0')
        total_base_value_sum = Decimal('0')
        total_interactions = 0
        
        for boom in booms:
            social_value = boom.social_value or Decimal('0')
            # ✅ CORRECTION: Fallback pour base_value
            base_value = getattr(boom, 'base_value', None)
            if base_value is None:
                base_value = getattr(boom, 'base_price', None)
                if base_value is None:
                    base_value = getattr(boom, 'purchase_price', Decimal('0'))
            
            total_value = social_value + Decimal(str(base_value))
            
            social_values.append(float(social_value))
            base_values.append(float(base_value))
            total_values.append(float(total_value))
            
            social_score = float(self._calculate_social_score(boom))
            social_scores.append(social_score)
            
            if hasattr(boom, 'gift_acceptance_rate') and boom.gift_acceptance_rate:
                acceptance_rates.append(float(boom.gift_acceptance_rate))
            
            # Sommes globales
            total_social_value_sum += social_value
            total_base_value_sum += Decimal(str(base_value))
            total_interactions += boom.interaction_count or 0
        
        # BOOMS viraux (très partagés)
        viral_booms = []
        for boom in booms:
            share_count = self._get_share_count_24h(boom.id)
            if share_count >= 10:  # 10+ partages en 24h = viral
                base_value = getattr(boom, 'base_value', 0) or 0
                viral_booms.append({
                    "id": boom.id,
                    "title": boom.title,
                    "share_count_24h": share_count,
                    "social_score": float(self._calculate_social_score(boom)),
                    "current_value": float(boom.current_price or 0),
                    "social_value": float(boom.social_value or 0),
                    "total_value": float(base_value + (boom.social_value or 0))
                })
        
        # BOOMS trending (score social élevé)
        trending_booms = []
        for boom in booms:
            social_score = float(self._calculate_social_score(boom))
            if social_score > 1.3:  # Score social élevé
                trending_booms.append({
                    "id": boom.id,
                    "title": boom.title,
                    "social_score": social_score,
                    "unique_holders": self.db.query(UserBom.user_id).filter(
                        UserBom.bom_id == boom.id,
                        UserBom.transferred_at.is_(None)  # ← PATCH APPLIQUÉ AUSSI ICI
                    ).distinct().count(),
                    "current_value": float(boom.current_price or 0),
                    "social_value": float(boom.social_value or 0),
                    "buy_count": boom.buy_count or 0,
                    "sell_count": boom.sell_count or 0,
                    "interaction_count": boom.interaction_count or 0
                })
        
        # BOOMS les plus partagés
        most_shared = []
        for boom in booms:
            share_count = self._get_share_count_7d(boom.id)
            if share_count > 0:
                per_share_delta = calculate_social_delta(boom.current_price or Decimal('0'), SOCIAL_MARKET_BUY_RATE)
                most_shared.append({
                    "id": boom.id,
                    "title": boom.title,
                    "share_count_7d": share_count,
                    "acceptance_rate": float(boom.gift_acceptance_rate) if hasattr(boom, 'gift_acceptance_rate') and boom.gift_acceptance_rate else 0.0,
                    "social_value_increment": float(per_share_delta * Decimal(str(share_count))),
                    "total_social_value": float(boom.social_value or 0)
                })
        
        # Trier
        viral_booms.sort(key=lambda x: x["share_count_24h"], reverse=True)
        trending_booms.sort(key=lambda x: x["social_score"], reverse=True)
        most_shared.sort(key=lambda x: x["share_count_7d"], reverse=True)
        
        return {
            "total_market_cap": float(sum(total_values)),
            "total_base_value": float(total_base_value_sum),
            "total_social_value": float(total_social_value_sum),
            "total_volume_24h": float(sum((getattr(b, 'total_volume_24h', 0) or 0) for b in booms)),
            "active_nfts": len(booms),
            "total_interactions": total_interactions,
            "average_social_score": float(sum(social_scores) / len(social_scores)) if social_scores else 0,
            "average_acceptance_rate": float(sum(acceptance_rates) / len(acceptance_rates)) if acceptance_rates else 0,
            "social_activity": {
                "total_buys": sum(b.buy_count or 0 for b in booms),
                "total_sells": sum(b.sell_count or 0 for b in booms),
                "total_shares": sum(b.share_count or 0 for b in booms),
                "buy_sell_ratio": sum(b.buy_count or 0 for b in booms) / max(1, sum(b.sell_count or 0 for b in booms))
            },
            "viral_booms": viral_booms[:5],
            "trending_booms": trending_booms[:5],
            "most_shared": most_shared[:5],
            "market_sentiment": self._get_overall_market_sentiment(social_scores),
            # CORRECTION: Ajout des champs manquants pour MarketOverviewResponse
            "total_fees_collected": float(total_social_value_sum * Decimal('0.05')),  # 5% des frais sociaux
            "top_gainers": trending_booms[:5],
            "top_losers": [],  # À implémenter si nécessaire
            "hot_nfts": viral_booms[:5],
            "active_events": []  # À implémenter si nécessaire
        }
    
    # === MÉTHODES PRIVÉES SOCIALES ===
    
    def _get_share_count_24h(self, boom_id: int) -> int:
        """Compter les partages des dernières 24h"""
        day_ago = datetime.now(timezone.utc) - timedelta(days=1)
        
        return self.db.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id.in_(
                self.db.query(UserBom.id).filter(UserBom.bom_id == boom_id)
            ),
            GiftTransaction.sent_at >= day_ago,
            GiftTransaction.status == GiftStatus.ACCEPTED
        ).count()
    
    def _get_share_count_7d(self, boom_id: int) -> int:
        """Compter les partages des 7 derniers jours"""
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        
        return self.db.query(GiftTransaction).filter(
            GiftTransaction.user_bom_id.in_(
                self.db.query(UserBom.id).filter(UserBom.bom_id == boom_id)
            ),
            GiftTransaction.sent_at >= week_ago,
            GiftTransaction.status == GiftStatus.ACCEPTED
        ).count()
    
    def _check_viral_status(self, boom: BomAsset):
        """Vérifier et mettre à jour le statut viral"""
        share_count_24h = self._get_share_count_24h(boom.id)
        
        if share_count_24h >= 10 and not getattr(boom, 'social_event', None):
            boom.social_event = 'viral'
            boom.social_event_message = '🔥 VIRAL! Forte activité sociale'
            boom.social_event_expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
            logger.info(f"🔥 Statut viral activé pour BOOM #{boom.id}")
        elif share_count_24h >= 5:
            boom.social_event = 'trending'
            boom.social_event_message = '📈 TRENDING! Activité sociale élevée'
            boom.social_event_expires_at = datetime.now(timezone.utc) + timedelta(hours=12)
    
    def _generate_social_price_history(self, boom: BomAsset) -> List[Dict]:
        """Générer un historique de prix basé sur l'activité sociale"""
        price_history = []
        # ✅ CORRECTION: Utiliser getattr avec fallback
        base_price = getattr(boom, 'base_price', None)
        if base_price is None:
            base_price = getattr(boom, 'purchase_price', Decimal('0'))
        
        current_social_value = boom.social_value or Decimal('0')
        
        for i in range(7):
            date = datetime.now(timezone.utc) - timedelta(days=6-i)
            
            # Simulation basée sur l'activité sociale hypothétique
            social_activity = random.uniform(0.5, 1.5)  # Variation sociale
            historical_social_value = current_social_value * Decimal(social_activity * 0.1)  # 10% de la valeur actuelle
            historical_price = Decimal(str(base_price)) + historical_social_value
            
            price_history.append({
                "date": date.strftime("%Y-%m-%d"),
                "price": float(historical_price),
                "social_activity": round(social_activity, 2),
                "social_value": float(historical_social_value)
            })
        
        return price_history
    
    def _get_social_event_boost(self, event_type: str) -> float:
        """Obtenir le boost de prix selon l'événement social"""
        boosts = {
            'viral': 0.25,      # +25%
            'trending': 0.15,   # +15%
            'new': 0.10,        # +10%
            'stable': 0.05      # +5%
        }
        return boosts.get(event_type, 0.0)
    
    def _get_social_recommendation(self, social_score: float, share_count: int, holders: int) -> str:
        """Générer une recommandation basée sur les métriques sociales"""
        if social_score > 1.3 and share_count > 8:
            return "ACHAT FORT - Fort potentiel social"
        elif social_score > 1.1 and holders > 3:
            return "ACHAT - Bonne communauté"
        elif social_score > 0.9:
            return "HOLD - Stabilité sociale"
        elif social_score < 0.8 or share_count == 0:
            return "VENTE - Faible activité sociale"
        else:
            return "ATTENTE - Observation recommandée"
    
    def _get_community_engagement_level(self, social_score: float) -> str:
        """Niveau d'engagement de la communauté"""
        if social_score > 1.3:
            return "Très élevé"
        elif social_score > 1.1:
            return "Élevé"
        elif social_score > 0.9:
            return "Moyen"
        else:
            return "Faible"
    
    def _get_market_sentiment(self, social_score: float) -> str:
        """Sentiment du marché basé sur le score social"""
        if social_score > 1.3:
            return "Très positif"
        elif social_score > 1.1:
            return "Positif"
        elif social_score > 0.9:
            return "Neutre"
        else:
            return "Négatif"
    
    def _get_social_trend(self, boom_id: int) -> str:
        """Tendance sociale récente"""
        share_count_24h = self._get_share_count_24h(boom_id)
        share_count_48h = self._get_share_count_7d(boom_id)  # Approximation
        
        if share_count_24h > share_count_48h / 3:  # Plus de 1/3 des partages en 24h
            return "En forte hausse"
        elif share_count_24h > 0:
            return "En hausse"
        else:
            return "Stable"
    
    def _get_social_risk_level(self, boom: BomAsset) -> str:
        """Niveau de risque basé sur la stabilité sociale"""
        if not boom.created_at:
            return "Moyen"
        
        age_days = (datetime.now(timezone.utc) - boom.created_at).days
        unique_holders = self.db.query(UserBom.user_id).filter(
            UserBom.bom_id == boom.id,
            UserBom.transferred_at.is_(None)  # ← PATCH APPLIQUÉ
        ).distinct().count()
        
        if age_days > 90 and unique_holders > 5:
            return "Faible"
        elif age_days > 30 and unique_holders > 2:
            return "Moyen"
        else:
            return "Élevé"
    
    def _get_overall_market_sentiment(self, social_scores: List[float]) -> str:
        """Sentiment général du marché"""
        if not social_scores:
            return "Neutre"
        
        avg_score = sum(social_scores) / len(social_scores)
        
        if avg_score > 1.2:
            return "Très optimiste"
        elif avg_score > 1.0:
            return "Optimiste"
        elif avg_score > 0.8:
            return "Neutre"
        else:
            return "Prudent"
    
    def _prepare_social_response(self, user_id: int, boom: BomAsset, action: str, 
                               **kwargs) -> Dict:
        """Préparer une réponse avec analyse sociale"""
        
        raw_quantity = kwargs.get('quantity', 1) or 1
        try:
            quantity_decimal = Decimal(str(raw_quantity))
        except (InvalidOperation, TypeError, ValueError):
            quantity_decimal = Decimal('1')
        if quantity_decimal <= 0:
            quantity_decimal = Decimal('1')
        quantity_int = int(quantity_decimal)
        rate = SOCIAL_MARKET_BUY_RATE if action == "buy" else SOCIAL_MARKET_SELL_RATE
        base_amount = (
            kwargs.get('transaction_amount')
            or kwargs.get('buy_price')
            or kwargs.get('sell_price')
            or kwargs.get('amount')
            or getattr(boom, 'current_price', None)
            or getattr(boom, 'base_value', None)
            or getattr(boom, 'base_price', None)
            or getattr(boom, 'purchase_price', 0)
        )
        try:
            reference_amount = Decimal(str(base_amount)) * quantity_decimal
        except (InvalidOperation, TypeError, ValueError):
            reference_amount = quantity_decimal
        social_delta = kwargs.get('social_delta')
        if social_delta is not None:
            try:
                social_delta_decimal = Decimal(str(social_delta))
            except (InvalidOperation, TypeError, ValueError):
                social_delta_decimal = calculate_social_delta(reference_amount, rate)
        else:
            social_delta_decimal = calculate_social_delta(reference_amount, rate)
        delta_float = float(social_delta_decimal)
        
        if action == "buy":
            if quantity_int > 1:
                message = f"🎉 Super investissement social! Vous avez acquis {quantity_int} {boom.title}"
            else:
                social_score = float(self._calculate_social_score(boom))
                if social_score > 1.3:
                    message = f"💎 Excellent choix! {boom.title} a un fort potentiel social"
                else:
                    message = f"🎯 Bon investissement! {boom.title} rejoint votre collection"
            increment_msg = f"📈 Valeur sociale augmentée de +{delta_float:.2f} FCFA"
        else:  # sell
            profit_loss = kwargs.get('profit_loss', 0)
            if profit_loss > 0:
                message = f"💰 Trade social réussi! Gain de {profit_loss:.2f} FCFA"
            else:
                message = f"📊 Transaction sociale effectuée sur {boom.title}"
            increment_msg = f"📉 Valeur sociale diminuée de -{delta_float:.2f} FCFA"
        
        # Métriques sociales
        share_count = self._get_share_count_24h(boom.id)
        unique_holders = self.db.query(UserBom.user_id).filter(
            UserBom.bom_id == boom.id,
            UserBom.transferred_at.is_(None)  # ← PATCH APPLIQUÉ
        ).distinct().count()
        
        current_social_value = self.calculate_social_value(boom.id)
        previous_social_value = current_social_value - social_delta_decimal if action == "buy" else current_social_value + social_delta_decimal
        if previous_social_value < Decimal('0'):
            previous_social_value = Decimal('0')
        
        # ✅ CORRECTION: Gestion sécurisée des attributs optionnels
        base_value = getattr(boom, 'base_value', None)
        if base_value is None:
            base_value = getattr(boom, 'base_price', None)
            if base_value is None:
                base_value = getattr(boom, 'purchase_price', 0)
        
        # ✅ AJOUT DES SOLDES SÉPARÉS DANS LA RÉPONSE
        cash_before = kwargs.get('cash_balance_before', 0)
        cash_after = kwargs.get('cash_balance_after', 0)
        wallet_balance = kwargs.get('wallet_balance', 0)
        
        member_suffix = "s" if quantity_int > 1 else ""
        community_growth = (
            f"+{quantity_int} membre{member_suffix}" if action == "buy"
            else f"-{quantity_int} membre{member_suffix}"
        )
        
        return {
            "success": True,
            "message": message,
            "social_message": increment_msg,
            "boom": {
                "id": boom.id,
                "title": boom.title,
                "current_social_value": float(current_social_value),
                "social_value": float(boom.social_value or 0),
                "base_value": float(base_value),
                "total_value": float(Decimal(str(base_value)) + (boom.social_value or 0))
            },
            "financial": {
                "amount": float(kwargs.get('buy_price', kwargs.get('sell_price', 0))),
                "fees": float(kwargs.get('fees_amount', 0)),
                "profit_loss": float(kwargs.get('profit_loss', 0)),
                # ✅ NOUVEAUX CHAMPS POUR SOLDES SÉPARÉS
                "argent_reel_avant": float(cash_before),
                "argent_reel_apres": float(cash_after),
                "argent_virtuel": float(wallet_balance),
                "argent_reel_utilise": float(cash_before - cash_after) if action == "buy" else 0
            },
            "social_impact": {
                "share_count_24h": share_count,
                "unique_holders": unique_holders,
                "social_score": float(self._calculate_social_score(boom)),
                "social_event": boom.social_event if hasattr(boom, 'social_event') else None,
                "community_growth": community_growth,
                "social_value_change": {
                    "increment": float(social_delta_decimal if action == "buy" else -social_delta_decimal),
                    "previous_value": float(previous_social_value),
                    "new_value": float(current_social_value)
                }
            },
            "new_balance": kwargs.get('new_balance', 0.0),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            # ✅ INFORMATION CLÉ SUR LA SOURCE DES FONDS
            "source_fonds": "argent_reel" if action == "buy" else "argent_virtuel"
        }
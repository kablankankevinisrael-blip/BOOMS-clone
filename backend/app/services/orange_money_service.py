"""
SERVICE ORANGE MONEY - Pour Côte d'Ivoire
Implémentation basée sur l'API Orange Money CI
"""
import requests
import base64
import uuid
import logging
import hmac
import hashlib
import time
from datetime import datetime
from typing import Dict, Optional
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.services.payment_service import get_user_cash_balance, create_payment_transaction, FeesConfig
from app.services.wallet_service import update_platform_treasury
from app.models.payment_models import PaymentStatus, PaymentTransaction

logger = logging.getLogger(__name__)

class OrangeMoneyService:
    def __init__(self):
        # Configuration selon l'environnement
        if settings.ORANGE_ENVIRONMENT == "production":
            self.base_url = "https://api.orange.com"
            self.money_base_url = "https://api.orange.com/orangemoney/v1"
        else:
            self.base_url = "https://api.sandbox.orange.com"
            self.money_base_url = "https://api.sandbox.orange.com/orangemoney/v1"
        
        self.api_key = settings.ORANGE_API_KEY
        self.api_secret = settings.ORANGE_API_SECRET
        self.access_token = None
        self.token_expires_at = None
        
        logger.info(f"✅ OrangeMoneyService initialisé - Environnement: {settings.ORANGE_ENVIRONMENT}")
        logger.info(f"   Base URL: {self.base_url}")
    
    def _get_auth_token(self) -> str:
        """Obtenir ou renouveler le token d'authentification OAuth2"""
        # Vérifier si token valide existe
        if self.access_token and self.token_expires_at:
            time_remaining = self.token_expires_at - datetime.now().timestamp()
            if time_remaining > 60:  # 1 minute de buffer
                return self.access_token
        
        # Ajouter retry mechanism (CORRECTION 3)
        max_retries = 3
        last_exception = None
        
        for attempt in range(max_retries):
            try:
                # Encoder credentials en base64
                credentials = f"{self.api_key}:{self.api_secret}"
                encoded_credentials = base64.b64encode(credentials.encode()).decode()
                
                headers = {
                    "Authorization": f"Basic {encoded_credentials}",
                    "Content-Type": "application/x-www-form-urlencoded"
                }
                
                data = {
                    "grant_type": "client_credentials"
                }
                
                response = requests.post(
                    f"{self.base_url}/oauth/v1/token",
                    headers=headers,
                    data=data,
                    timeout=30
                )
                
                if response.status_code != 200:
                    logger.error(f"❌ Erreur auth Orange (tentative {attempt + 1}/{max_retries}): {response.status_code} - {response.text}")
                    
                    if attempt == max_retries - 1:
                        raise HTTPException(
                            status_code=response.status_code,
                            detail=f"Erreur authentification Orange Money: {response.text}"
                        )
                    
                    time.sleep(2)  # Attendre avant retry
                    continue
                
                token_data = response.json()
                self.access_token = token_data.get("access_token")
                
                # Définir expiration (généralement 1 heure)
                expires_in = token_data.get("expires_in", 3600)
                self.token_expires_at = datetime.now().timestamp() + expires_in
                
                logger.info(f"✅ Token Orange Money obtenu (tentative {attempt + 1}/{max_retries})")
                return self.access_token
                
            except requests.exceptions.RequestException as e:
                last_exception = e
                logger.warning(f"🔄 Tentative {attempt + 1}/{max_retries} échouée: {str(e)}")
                if attempt < max_retries - 1:
                    time.sleep(2)  # Attendre avant retry
                continue
        
        # Si toutes les tentatives échouent
        logger.error(f"❌ Toutes les tentatives d'auth Orange ont échoué")
        raise HTTPException(
            status_code=500,
            detail=f"Erreur connexion Orange Money après {max_retries} tentatives: {str(last_exception)}"
        )
    
    def _validate_phone_number(self, phone_number: str) -> str:
        """Valider et formater un numéro Orange Money Côte d'Ivoire"""
        import re
        
        # Nettoyer
        cleaned = phone_number.replace(" ", "").replace("+", "")
        
        # Formats acceptés pour Orange CI
        # Orange CI: 07, 05, 01 (partagé), 27 (nouveau)
        if re.match(r'^(07|05|01|27)[0-9]{8}$', cleaned):
            return cleaned
        
        # Si numéro commence par 225 (code pays), le retirer
        if cleaned.startswith("225"):
            cleaned = cleaned[3:]
            if re.match(r'^(07|05|01|27)[0-9]{8}$', cleaned):
                return cleaned
        
        raise HTTPException(
            status_code=400,
            detail="Numéro Orange Money Côte d'Ivoire invalide. Formats: 07xxxxxxxx, 05xxxxxxxx, 01xxxxxxxx, 27xxxxxxxx"
        )
    
    async def initiate_deposit(self, amount: float, phone_number: str, user_id: str) -> Dict:
        """
        Initier un dépôt Orange Money - L'argent va sur VOTRE compte marchand
        """
        logger.info(f"💰 Orange Deposit - Amount: {amount}, Phone: {phone_number}, User: {user_id}")
        
        try:
            # Valider et formater le numéro
            validated_phone = self._validate_phone_number(phone_number)
            
            # Obtenir token
            token = self._get_auth_token()
            
            # ===== NOUVEAU : CALCUL UNIFIÉ DES FRAIS =====
            amount_decimal = Decimal(str(amount))
            fees_analysis = FeesConfig.calculate_total_deposit_fees(amount_decimal, "orange_money")
            
            # Extraire les valeurs calculées
            orange_fee = fees_analysis["provider_fee"]
            your_commission = fees_analysis["your_commission"]
            net_to_user = fees_analysis["net_to_user"]
            
            # Vérifier la rentabilité
            if not fees_analysis["is_profitable"]:
                logger.warning(f"⚠️ Transaction Orange non rentable: {fees_analysis['warning']}")
            
            # Préparer la requête de paiement
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "X-Request-Id": str(uuid.uuid4())
            }
            
            # Générer une référence unique
            merchant_reference = f"BOOMS_DEPOSIT_OM_{user_id}_{int(datetime.now().timestamp())}"
            
            payload = {
                "amount": str(amount),
                "currency": "XOF",
                "order_id": merchant_reference,
                "payer": {
                    "partyIdType": "MSISDN",
                    "partyId": validated_phone
                },
                "payee": {
                    "partyIdType": "MSISDN",
                    "partyId": settings.ORANGE_BUSINESS_PHONE  # VOTRE numéro marchand
                },
                "payerMessage": "Dépôt Booms - Cadeaux digitaux",
                "payeeNote": f"Dépôt de {amount} FCFA",
                "metadata": {
                    "user_id": user_id,
                    "type": "deposit",
                    "orange_fee": str(orange_fee),
                    "your_commission": str(your_commission),
                    "net_to_user": str(net_to_user),
                    "platform": "booms",
                    # AJOUT : Informations détaillées
                    "fees_analysis": {
                        "provider_fee_percent": str(fees_analysis["provider_fee_percent"]),
                        "your_commission_percent": str(fees_analysis["your_commission_percent"]),
                        "total_fees_percent": str(fees_analysis["provider_fee_percent"] + fees_analysis["your_commission_percent"]),
                        "is_profitable": fees_analysis["is_profitable"],
                        "your_profit": str(fees_analysis["your_profit"])
                    }
                }
            }
            
            logger.info(f"📤 Requête Orange Deposit - Ref: {merchant_reference}")
            logger.info(f"📊 Frais Orange: {orange_fee} FCFA, Ta commission: {your_commission} FCFA")
            
            # Envoyer la requête de paiement
            response = requests.post(
                f"{self.money_base_url}/cashin",
                headers=headers,
                json=payload,
                timeout=30
            )
            
            if response.status_code == 202:  # 202 Accepted pour paiement initié
                response_data = response.json()
                transaction_id = response_data.get("transactionId")
                
                logger.info(f"✅ Dépôt Orange initié - Transaction: {transaction_id}")
                
                return {
                    "success": True,
                    "transaction_id": transaction_id,
                    "merchant_reference": merchant_reference,
                    "status": "pending",
                    "instructions": "Veuillez confirmer le paiement sur votre mobile Orange Money",
                    "financial_details": {
                        "amount": float(amount),
                        "orange_fee": float(orange_fee),
                        "your_commission": float(your_commission),
                        "net_to_user": float(net_to_user)
                    },
                    # AJOUT : Analyse des frais
                    "fees_analysis": fees_analysis
                }
            else:
                error_msg = f"Erreur API Orange: {response.status_code} - {response.text}"
                logger.error(f"❌ {error_msg}")
                raise HTTPException(
                    status_code=400,
                    detail=error_msg
                )
                
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Erreur initiation dépôt Orange: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Erreur initiation dépôt Orange Money: {str(e)}"
            )
    
    async def initiate_withdrawal(self, amount: float, phone_number: str, user_id: str) -> Dict:
        """
        Initier un retrait Orange Money - L'argent vient de VOTRE compte
        """
        logger.info(f"💰 Orange Withdrawal - Amount: {amount}, Phone: {phone_number}, User: {user_id}")
        
        try:
            # Valider et formater le numéro
            validated_phone = self._validate_phone_number(phone_number)
            
            # Obtenir token
            token = self._get_auth_token()
            
            # ===== NOUVEAU : CALCUL UNIFIÉ DES FRAIS =====
            amount_decimal = Decimal(str(amount))
            fees_analysis = FeesConfig.calculate_total_withdrawal_fees(amount_decimal, "orange_money")
            
            # Extraire les valeurs calculées
            orange_fee = fees_analysis["provider_fee"]
            your_commission = fees_analysis["your_commission"]
            net_to_user = fees_analysis["net_to_user"]
            
            # Vérifier la rentabilité
            if not fees_analysis["is_profitable"]:
                logger.warning(f"⚠️ Transaction Orange non rentable: {fees_analysis['warning']}")
            
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "X-Request-Id": str(uuid.uuid4())
            }
            
            # Générer une référence unique
            merchant_reference = f"BOOMS_WITHDRAWAL_OM_{user_id}_{int(datetime.now().timestamp())}"
            
            payload = {
                "amount": str(amount),
                "currency": "XOF",
                "order_id": merchant_reference,
                "payer": {
                    "partyIdType": "MSISDN",
                    "partyId": settings.ORANGE_BUSINESS_PHONE  # VOTRE compte
                },
                "payee": {
                    "partyIdType": "MSISDN",
                    "partyId": validated_phone  # Destinataire
                },
                "description": f"Retrait Booms - {amount} FCFA",
                "metadata": {
                    "user_id": user_id,
                    "type": "withdrawal",
                    "orange_fee": str(orange_fee),
                    "your_commission": str(your_commission),
                    "net_to_user": str(net_to_user),
                    "platform": "booms",
                    # AJOUT : Informations détaillées
                    "fees_analysis": {
                        "provider_fee_percent": str(fees_analysis["provider_fee_percent"]),
                        "your_commission_percent": str(fees_analysis["your_commission_percent"]),
                        "total_fees_percent": str(fees_analysis["provider_fee_percent"] + fees_analysis["your_commission_percent"]),
                        "is_profitable": fees_analysis["is_profitable"],
                        "your_profit": str(fees_analysis["your_profit"])
                    }
                }
            }
            
            logger.info(f"📤 Requête Orange Withdrawal - Ref: {merchant_reference}")
            logger.info(f"📊 Frais Orange: {orange_fee} FCFA, Ta commission: {your_commission} FCFA")
            
            # Envoyer la requête de cashout
            response = requests.post(
                f"{self.money_base_url}/cashout",
                headers=headers,
                json=payload,
                timeout=30
            )
            
            if response.status_code == 202:  # 202 Accepted
                response_data = response.json()
                transaction_id = response_data.get("transactionId")
                
                logger.info(f"✅ Retrait Orange initié - Transaction: {transaction_id}")
                
                return {
                    "success": True,
                    "transaction_id": transaction_id,
                    "merchant_reference": merchant_reference,
                    "status": "pending",
                    "estimated_processing": "2-5 minutes",
                    "financial_details": {
                        "amount": float(amount),
                        "orange_fee": float(orange_fee),
                        "your_commission": float(your_commission),
                        "net_to_user": float(net_to_user)
                    },
                    # AJOUT : Analyse des frais
                    "fees_analysis": fees_analysis
                }
            else:
                error_msg = f"Erreur API Orange: {response.status_code} - {response.text}"
                logger.error(f"❌ {error_msg}")
                raise HTTPException(
                    status_code=400,
                    detail=error_msg
                )
                
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Erreur initiation retrait Orange: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Erreur initiation retrait Orange Money: {str(e)}"
            )
    
    def verify_webhook_signature(self, payload: str, signature: str) -> bool:
        """
        Vérifier la signature du webhook Orange Money
        Note: Orange utilise souvent X-Orange-Signature header
        """
        if not settings.ORANGE_WEBHOOK_SECRET:
            logger.warning("⚠️ Aucun secret webhook Orange configuré")
            return True  # En développement, on peut désactiver la vérification
        
        # Orange utilise généralement HMAC-SHA256
        computed_signature = hmac.new(
            settings.ORANGE_WEBHOOK_SECRET.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(computed_signature, signature)
    
    async def process_deposit_webhook(self, db: Session, webhook_data: dict) -> bool:
        """
        Traiter un webhook de dépôt Orange Money réussi
        """
        logger.info(f"📥 Webhook Orange Deposit: {webhook_data}")
        
        # Identifier le type de transaction
        order_id = webhook_data.get("order_id", "")
        if not order_id.startswith("BOOMS_DEPOSIT_OM_"):
            logger.warning(f"⚠️ Webhook ignoré - Pas un dépôt Booms: {order_id}")
            return False
        
        try:
            # Extraire les informations
            status = webhook_data.get("status", "").upper()
            transaction_id = webhook_data.get("transactionId")
            amount = Decimal(str(webhook_data.get("amount", 0)))
            
            # Vérifier le statut
            if status != "SUCCESS" and status != "COMPLETED":
                logger.warning(f"⚠️ Webhook statut non réussi: {status}")
                return False
            
            # Extraire user_id de la référence
            parts = order_id.split("_")
            if len(parts) >= 4:
                user_id = int(parts[3])  # Format: BOOMS_DEPOSIT_OM_{user_id}_{timestamp}
                
                # Récupérer les métadonnées
                metadata = webhook_data.get("metadata", {})
                orange_fee = Decimal(metadata.get("orange_fee", "0"))
                your_commission = Decimal(metadata.get("your_commission", "0"))
                net_to_user = Decimal(metadata.get("net_to_user", str(amount)))
                
                # ===== NOUVEAU : VÉRIFICATION COHÉRENCE FRAIS =====
                calculated = FeesConfig.calculate_total_deposit_fees(amount, "orange_money")
                
                # Log de vérification
                if abs(orange_fee - calculated["provider_fee"]) > Decimal('0.01'):
                    logger.warning(f"⚠️ Incohérence frais Orange: métadata={orange_fee}, calculé={calculated['provider_fee']}")
                
                logger.info(f"✅ Webhook Orange Deposit - User: {user_id}, Amount: {amount}, Net: {net_to_user}")
                
                try:
                    with db.begin_nested():  # Transaction atomique
                        # Créditer le solde liquide (montant net)
                        cash_balance = get_user_cash_balance(db, user_id)
                        cash_balance.available_balance += net_to_user
                        
                        # Ajouter la commission à la caisse plateforme
                        if your_commission > 0:
                            update_platform_treasury(
                                db,
                                your_commission,
                                f"Commission dépôt Orange - User {user_id}"
                            )
                        
                        # Enregistrer la transaction
                        create_payment_transaction(
                            db=db,
                            user_id=user_id,
                            transaction_type="deposit",
                            amount=amount,
                            fees=orange_fee + your_commission,
                            net_amount=net_to_user,
                            status=PaymentStatus.COMPLETED,
                            provider="orange_money",
                            provider_reference=transaction_id,
                            description=f"Dépôt Orange Money - Commission: {your_commission} FCFA"
                        )
                    
                    db.commit()
                    logger.info(f"✅ Dépôt Orange traité - User: {user_id}, Net: {net_to_user}")
                    return True
                    
                except IntegrityError as e:
                    db.rollback()
                    logger.error(f"❌ Erreur transaction dépôt Orange (IntegrityError): {e}")
                    return False
                    
        except Exception as e:
            db.rollback()
            logger.error(f"❌ Erreur traitement webhook Orange: {e}")
        
        return False
    
    async def process_withdrawal_webhook(self, db: Session, webhook_data: dict) -> bool:
        """
        Traiter un webhook de retrait Orange Money - CORRECTION 1 COMPLÈTE
        """
        logger.info(f"📥 Webhook Orange Withdrawal: {webhook_data}")
        
        order_id = webhook_data.get("order_id", "")
        if not order_id.startswith("BOOMS_WITHDRAWAL_OM_"):
            logger.warning(f"⚠️ Webhook ignoré - Pas un retrait Booms: {order_id}")
            return False
        
        try:
            status = webhook_data.get("status", "").upper()
            transaction_id = webhook_data.get("transactionId")
            
            # CORRECTION 1: Gestion complète des échecs
            if status == "FAILED" or status == "CANCELLED":
                logger.warning(f"⚠️ Retrait Orange échoué - Statut: {status}, Transaction: {transaction_id}")
                
                try:
                    # Rembourser l'utilisateur
                    with db.begin_nested():
                        # Récupérer la transaction originale
                        original_tx = db.query(PaymentTransaction).filter(
                            PaymentTransaction.provider_reference == transaction_id,
                            PaymentTransaction.provider == "orange_money",
                            PaymentTransaction.type == "withdrawal"
                        ).first()
                        
                        if original_tx:
                            # Rembourser le montant débité (montant + frais)
                            cash_balance = get_user_cash_balance(db, original_tx.user_id)
                            cash_balance.available_balance += original_tx.amount + original_tx.fees
                            
                            # Marquer la transaction comme échouée
                            original_tx.status = PaymentStatus.FAILED
                            
                            # Retirer les frais de la caisse (si déjà crédités)
                            if original_tx.fees > 0:
                                update_platform_treasury(
                                    db,
                                    -original_tx.fees,
                                    f"Remboursement retrait échoué Orange - Transaction: {transaction_id}, User: {original_tx.user_id}"
                                )
                            
                            # Log admin pour audit
                            from app.models.admin_models import AdminLog
                            admin_log = AdminLog(
                                admin_id=0,
                                action="orange_withdrawal_failed_refund",
                                details={
                                    "transaction_id": transaction_id,
                                    "user_id": original_tx.user_id,
                                    "amount_refunded": str(original_tx.amount + original_tx.fees),
                                    "status": status,
                                    "reason": "Retrait Orange échoué - Remboursement automatique"
                                },
                                fees_amount=-original_tx.fees
                            )
                            db.add(admin_log)
                            
                            logger.info(f"💰 Retrait Orange échoué - Remboursement user {original_tx.user_id}: +{original_tx.amount + original_tx.fees} FCFA")
                            
                    db.commit()
                    
                    # TODO: Notifier l'utilisateur (à implémenter avec système notification)
                    logger.info(f"📧 Notification à envoyer: Retrait Orange échoué pour transaction {transaction_id}")
                    
                    return False  # Transaction échouée
                    
                except Exception as refund_error:
                    db.rollback()
                    logger.error(f"❌ Erreur remboursement retrait Orange: {refund_error}")
                    return False
            
            elif status != "SUCCESS" and status != "COMPLETED":
                logger.warning(f"⚠️ Webhook retrait statut non réussi: {status}")
                return False
            
            # Le retrait est déjà débité lors de l'initiation
            # Ici on confirme juste que c'est terminé
            logger.info(f"✅ Retrait Orange complété - Transaction: {transaction_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Erreur traitement webhook retrait Orange: {e}")
        
        return False
    
    async def check_transaction_status(self, transaction_id: str) -> Dict:
        """
        Vérifier le statut d'une transaction Orange Money - CORRECTION 2 COMPLÈTE
        """
        try:
            token = self._get_auth_token()
            
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            response = requests.get(
                f"{self.money_base_url}/transactions/{transaction_id}",
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # CORRECTION 2: Normalisation des statuts
                status_mapping = {
                    "SUCCESS": "COMPLETED",
                    "COMPLETED": "COMPLETED",
                    "PENDING": "PENDING",
                    "FAILED": "FAILED",
                    "CANCELLED": "CANCELLED",
                    "EXPIRED": "FAILED",
                    "REJECTED": "FAILED"
                }
                
                orange_status = data.get("status", "").upper()
                standardized_status = status_mapping.get(orange_status, "UNKNOWN")
                
                # Extraire les informations pertinentes
                amount = data.get("amount")
                currency = data.get("currency", "XOF")
                timestamp = data.get("timestamp") or data.get("created_at") or data.get("updated_at")
                
                # Vérifier si c'est un dépôt ou retrait
                transaction_type = "unknown"
                if data.get("payer", {}).get("partyId") == settings.ORANGE_BUSINESS_PHONE:
                    transaction_type = "withdrawal"
                elif data.get("payee", {}).get("partyId") == settings.ORANGE_BUSINESS_PHONE:
                    transaction_type = "deposit"
                
                return {
                    "transaction_id": transaction_id,
                    "status": standardized_status,
                    "orange_status": orange_status,
                    "transaction_type": transaction_type,
                    "amount": amount,
                    "currency": currency,
                    "timestamp": timestamp,
                    "payer": data.get("payer"),
                    "payee": data.get("payee"),
                    "metadata": data.get("metadata", {}),
                    "is_final": standardized_status in ["COMPLETED", "FAILED", "CANCELLED"]
                }
            else:
                logger.error(f"❌ Erreur vérification statut: {response.status_code} - {response.text}")
                return {
                    "status": "ERROR",
                    "orange_status": "API_ERROR",
                    "error": response.text,
                    "http_code": response.status_code
                }
                
        except requests.exceptions.Timeout:
            logger.error(f"❌ Timeout vérification transaction Orange: {transaction_id}")
            return {
                "status": "ERROR",
                "orange_status": "TIMEOUT",
                "error": "Timeout lors de la vérification du statut"
            }
        except requests.exceptions.ConnectionError:
            logger.error(f"❌ Connection error vérification transaction Orange: {transaction_id}")
            return {
                "status": "ERROR",
                "orange_status": "CONNECTION_ERROR",
                "error": "Erreur de connexion à l'API Orange"
            }
        except Exception as e:
            logger.error(f"❌ Erreur vérification transaction Orange: {e}")
            return {
                "status": "ERROR",
                "orange_status": "UNKNOWN_ERROR",
                "error": str(e)
            }
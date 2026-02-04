import requests
import base64
from datetime import datetime
import hmac
import hashlib
import json
import logging
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session
from decimal import Decimal

from app.config import settings
from app.services.payment_service import get_user_cash_balance, create_payment_transaction, FeesConfig
from app.services.wallet_service import update_platform_treasury
from app.models.payment_models import PaymentStatus

logger = logging.getLogger(__name__)

class MTNMobileMoneyService:
    def __init__(self):
        self.base_url = "https://sandbox.momodeveloper.mtn.com" if settings.MTN_MOMO_ENVIRONMENT == "sandbox" else "https://momodeveloper.mtn.com"
        self.api_key = settings.MTN_MOMO_API_KEY
        self.api_secret = settings.MTN_MOMO_API_SECRET
        self.subscription_key = settings.MTN_MOMO_SUBSCRIPTION_KEY
        self.currency = settings.MTN_MOMO_CURRENCY
    
    def _get_auth_token(self):
        """Obtenir le token d'authentification OAuth2"""
        # Encoder les credentials en base64
        credentials = f"{self.api_key}:{self.api_secret}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        
        headers = {
            'Authorization': f'Basic {encoded_credentials}',
            'Ocp-Apim-Subscription-Key': self.subscription_key
        }
        
        response = requests.post(
            f'{self.base_url}/collection/token/',
            headers=headers
        )
        
        if response.status_code == 200:
            return response.json().get('access_token')
        else:
            raise Exception(f"Erreur d'authentification: {response.text}")
    
    def request_payment(self, amount: float, phone_number: str, external_id: str):
        """Initier un paiement Mobile Money"""
        token = self._get_auth_token()
        
        headers = {
            'Authorization': f'Bearer {token}',
            'X-Reference-Id': external_id,
            'X-Target-Environment': 'sandbox' if settings.MTN_MOMO_ENVIRONMENT == 'sandbox' else 'production',
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': self.subscription_key
        }
        
        payload = {
            "amount": str(amount),
            "currency": self.currency,
            "externalId": external_id,
            "payer": {
                "partyIdType": "MSISDN",
                "partyId": phone_number
            },
            "payerMessage": "Achat Booms - Cadeaux digitaux",
            "payeeNote": "Merci pour votre achat Booms!"
        }
        
        response = requests.post(
            f'{self.base_url}/collection/v1_0/requesttopay',
            headers=headers,
            json=payload
        )
        
        return response.status_code, response.json()
    
    def verify_webhook_signature(self, payload: str, signature: str) -> bool:
        """Vérifier la signature du webhook MTN MoMo"""
        if not settings.MTN_MOMO_WEBHOOK_SECRET:
            logger.warning("⚠️ Aucun secret webhook MTN MoMo configuré")
            return True  # En développement
        
        if not signature:
            logger.error("❌ Signature MTN MoMo manquante")
            return False
        
        try:
            # MTN MoMo utilise généralement HMAC-SHA256
            computed_signature = hmac.new(
                settings.MTN_MOMO_WEBHOOK_SECRET.encode('utf-8'),
                payload.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            result = hmac.compare_digest(computed_signature, signature)
            
            if not result:
                logger.error(f"❌ Signature MTN invalide. Attendu: {computed_signature[:20]}..., Reçu: {signature[:20]}...")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Erreur vérification signature MTN: {e}")
            return False
    
    def validate_momo_webhook_headers(self, request: Request) -> bool:
        """Valider les headers du webhook MTN MoMo"""
        required_headers = [
            "X-Callback-Signature",
            "X-Reference-Id",
            "X-Target-Environment"
        ]
        
        for header in required_headers:
            if header not in request.headers:
                logger.error(f"❌ Header MTN manquant: {header}")
                return False
        
        return True
    
    async def process_deposit_webhook(self, db: Session, webhook_data: dict) -> bool:
        """Traiter un webhook de dépôt MTN MoMo réussi - NOUVELLE MÉTHODE COMPLÈTE"""
        external_id = webhook_data.get("externalId", "")
        if not external_id.startswith("BOOMS_DEPOSIT_"):
            logger.warning(f"⚠️ Webhook MTN ignoré - Pas un dépôt Booms: {external_id}")
            return False
        
        try:
            # Extraire le statut
            status = webhook_data.get("status", "").upper()
            if status != "SUCCESSFUL":
                logger.warning(f"⚠️ Webhook MTN statut non réussi: {status}")
                return False
            
            # Extraire les informations
            amount = Decimal(str(webhook_data.get("amount", 0)))
            
            # Extraire user_id de l'externalId (format: BOOMS_DEPOSIT_{user_id}_{timestamp})
            parts = external_id.split("_")
            if len(parts) < 3:
                logger.error(f"❌ ExternalId MTN mal formé: {external_id}")
                return False
            
            user_id = int(parts[2])
            
            # ===== NOUVEAU : CALCUL UNIFIÉ DES FRAIS =====
            # Utiliser la configuration centralisée
            fees_analysis = FeesConfig.calculate_total_deposit_fees(amount, "mtn_momo")
            
            # Extraire les valeurs calculées
            momo_fee = fees_analysis["provider_fee"]
            your_commission = fees_analysis["your_commission"]
            net_to_user = fees_analysis["net_to_user"]
            
            # Vérifier la rentabilité
            if not fees_analysis["is_profitable"]:
                logger.warning(f"⚠️ Transaction MTN non rentable: {fees_analysis['warning']}")
            
            logger.info(f"✅ Webhook MTN Deposit - User: {user_id}, Amount: {amount}, Net: {net_to_user}")
            logger.info(f"📊 Frais MTN: {momo_fee} FCFA, Ta commission: {your_commission} FCFA")
            
            try:
                # Transaction atomique
                from sqlalchemy.exc import IntegrityError
                
                with db.begin_nested():
                    # Créditer le solde liquide (montant net)
                    cash_balance = get_user_cash_balance(db, user_id)
                    cash_balance.available_balance += net_to_user
                    
                    # Ajouter la commission à la caisse plateforme
                    if your_commission > 0:
                        update_platform_treasury(
                            db, 
                            your_commission, 
                            f"Commission dépôt MTN MoMo - User {user_id}"
                        )
                    
                    # Enregistrer la transaction avec les frais
                    transaction_id = webhook_data.get("financialTransactionId", "")
                    
                    create_payment_transaction(
                        db=db,
                        user_id=user_id,
                        transaction_type="deposit",
                        amount=amount,
                        fees=momo_fee + your_commission,  # Total des frais
                        net_amount=net_to_user,
                        status=PaymentStatus.COMPLETED,
                        provider="mtn_momo",
                        provider_reference=transaction_id,
                        description=f"Dépôt MTN MoMo - Commission: {your_commission} FCFA"
                    )
                
                db.commit()
                logger.info(f"✅ Dépôt MTN traité - User: {user_id}, Net: {net_to_user}")
                return True
                
            except IntegrityError as e:
                db.rollback()
                logger.error(f"❌ Erreur transaction dépôt MTN (IntegrityError): {e}")
                return False
            except Exception as transaction_error:
                db.rollback()
                logger.error(f"❌ Erreur transaction dépôt MTN: {transaction_error}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Erreur traitement webhook MTN: {e}")
            return False
    
    async def handle_momo_webhook(self, request: Request, db: Session) -> bool:
        """Gérer les webhooks MTN MoMo"""
        try:
            # Lire le payload
            payload = await request.body()
            payload_str = payload.decode('utf-8')
            
            # Vérifier la signature
            signature = request.headers.get("X-Callback-Signature")
            if not self.verify_webhook_signature(payload_str, signature):
                logger.error("❌ Signature MTN MoMo invalide")
                return False
            
            # Valider les headers
            if not self.validate_momo_webhook_headers(request):
                return False
            
            # Parser le JSON
            webhook_data = json.loads(payload_str)
            
            # Extraire les informations
            external_id = webhook_data.get("externalId", "")
            status = webhook_data.get("status", "").upper()
            
            logger.info(f"📥 Webhook MTN reçu - Référence: {external_id}, Statut: {status}")
            
            # Vérifier si c'est une transaction Booms
            if not external_id.startswith("BOOMS_"):
                logger.warning(f"⚠️ Webhook MTN ignoré - Pas une transaction Booms: {external_id}")
                return False
            
            # Déterminer le type de transaction
            if external_id.startswith("BOOMS_DEPOSIT_"):
                # C'est un dépôt - utiliser la nouvelle méthode
                if status == "SUCCESSFUL":
                    return await self.process_deposit_webhook(db, webhook_data)
                else:
                    logger.warning(f"⚠️ Dépôt MTN échoué - Statut: {status}")
                    return False
            elif external_id.startswith("BOOMS_WITHDRAWAL_"):
                # TODO: Implémenter process_withdrawal_webhook quand disponible
                if status == "SUCCESSFUL":
                    logger.info(f"✅ Retrait MTN réussi - Référence: {external_id}")
                    return True
                else:
                    logger.warning(f"⚠️ Retrait MTN échoué - Statut: {status}")
                    return False
            else:
                logger.warning(f"⚠️ Webhook MTN ignoré - Type non reconnu: {external_id}")
                return False
                
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON MTN invalide: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ Erreur traitement webhook MTN: {e}")
            return False
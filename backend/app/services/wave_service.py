import requests
import hmac
import hashlib
from typing import Dict, Optional
from fastapi import HTTPException, Request
from decimal import Decimal
from datetime import datetime
from sqlalchemy.orm import Session
import json
import logging

from app.config import settings
from app.services.payment_service import get_user_cash_balance, create_payment_transaction, FeesConfig
from app.services.wallet_service import update_platform_treasury
from app.models.payment_models import PaymentStatus

logger = logging.getLogger(__name__)

class WavePaymentService:
    def __init__(self):
        self.base_url = "https://api.wave.com/v1"
        self.api_key = settings.WAVE_API_KEY
        self.merchant_key = settings.WAVE_MERCHANT_KEY
        self.business_account = settings.WAVE_BUSINESS_ACCOUNT
        
    async def initiate_deposit(self, amount: float, phone_number: str, user_id: str) -> Dict:
        """Initier un dépôt Wave - L'argent va sur VOTRE compte business"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        # Nettoyer le numéro de téléphone
        cleaned_phone = phone_number.replace(" ", "")
        
        # Validation du format numéro CI
        if not self.validate_ci_phone_number(cleaned_phone):
            raise HTTPException(
                status_code=400, 
                detail="Numéro Wave Côte d'Ivoire invalide. Format: 07xxxxxxxx, 05xxxxxxxx, 01xxxxxxxx"
            )
        
        # ===== NOUVEAU : CALCUL UNIFIÉ DES FRAIS =====
        amount_decimal = Decimal(str(amount))
        
        # Utiliser la configuration centralisée
        fees_analysis = FeesConfig.calculate_total_deposit_fees(amount_decimal, "wave")
        
        # Extraire les valeurs calculées
        wave_fee = fees_analysis["provider_fee"]
        your_commission = fees_analysis["your_commission"]
        net_to_user = fees_analysis["net_to_user"]
        
        # Vérifier la rentabilité
        if not fees_analysis["is_profitable"]:
            logger.warning(f"⚠️ Transaction Wave non rentable: {fees_analysis['warning']}")
            # Tu peux choisir de bloquer ou continuer avec un warning
            # raise HTTPException(status_code=400, detail="Transaction non rentable")
        
        # Webhook URL - Doit être accessible depuis internet
        callback_url = f"{settings.BASE_URL}/api/v1/payments/wave/deposit-webhook"
        
        payload = {
            "amount": str(amount),
            "currency": "XOF", 
            "customer_phone_number": cleaned_phone,
            "merchant_account": self.business_account,  # VOTRE compte business
            "merchant_reference": f"BOOMS_DEPOSIT_{user_id}_{int(datetime.now().timestamp())}",
            "callback_url": callback_url,
            "country": "CI",
            "metadata": {
                "user_id": user_id,
                "type": "deposit",
                "wave_fee": str(wave_fee),
                "your_commission": str(your_commission),
                "net_to_user": str(net_to_user),
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
        
        logger.info(f"💰 Wave Deposit - Votre commission: {your_commission} FCFA")
        logger.info(f"📊 Frais Wave: {wave_fee} FCFA ({fees_analysis['provider_fee_percent']*100}%)")
        logger.info(f"💵 Net utilisateur: {net_to_user} FCFA")
        logger.info(f"📱 Wave Deposit - Phone: {cleaned_phone}, Amount: {amount}")
        
        try:
            response = requests.post(
                f"{self.base_url}/checkout/sessions",
                headers=headers,
                json=payload,
                timeout=30
            )
            
            if response.status_code == 401:
                raise HTTPException(
                    status_code=400, 
                    detail="Configuration Wave invalide. Vérifiez vos clés API."
                )
                
            response.raise_for_status()
            
            # Ajouter l'analyse des frais à la réponse
            response_data = response.json()
            response_data["fees_analysis"] = fees_analysis
            
            return response_data
            
        except requests.exceptions.Timeout:
            raise HTTPException(status_code=408, detail="Timeout Wave API")
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Erreur Wave: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Erreur Wave: {str(e)}")
    
    async def initiate_withdrawal(self, amount: float, phone_number: str, user_id: str) -> Dict:
        """Initier un retrait Wave - L'argent vient de VOTRE compte"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        cleaned_phone = phone_number.replace(" ", "")
        
        if not self.validate_ci_phone_number(cleaned_phone):
            raise HTTPException(status_code=400, detail="Numéro Wave invalide")
            
        # ===== NOUVEAU : CALCUL UNIFIÉ DES FRAIS =====
        amount_decimal = Decimal(str(amount))
        
        # Utiliser la configuration centralisée
        fees_analysis = FeesConfig.calculate_total_withdrawal_fees(amount_decimal, "wave")
        
        # Extraire les valeurs calculées
        wave_fee = fees_analysis["provider_fee"]
        your_commission = fees_analysis["your_commission"]
        net_to_user = fees_analysis["net_to_user"]
        
        # Vérifier la rentabilité
        if not fees_analysis["is_profitable"]:
            logger.warning(f"⚠️ Transaction Wave non rentable: {fees_analysis['warning']}")
            # Tu peux choisir de bloquer ou continuer avec un warning
            # raise HTTPException(status_code=400, detail="Transaction non rentable")
        
        payload = {
            "amount": str(amount),
            "currency": "XOF",
            "recipient_phone_number": cleaned_phone,
            "merchant_account": self.business_account,  # DE VOTRE compte
            "merchant_reference": f"BOOMS_WITHDRAWAL_{user_id}_{int(datetime.now().timestamp())}",
            "description": f"Retrait Booms - {amount} FCFA",
            "metadata": {
                "user_id": user_id,
                "type": "withdrawal",
                "wave_fee": str(wave_fee),
                "your_commission": str(your_commission),
                "net_to_user": str(net_to_user),
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
        
        logger.info(f"💰 Wave Withdrawal - Votre commission: {your_commission} FCFA")
        logger.info(f"📊 Frais Wave: {wave_fee} FCFA ({fees_analysis['provider_fee_percent']*100}%)")
        logger.info(f"💵 Net utilisateur: {net_to_user} FCFA")
        
        try:
            response = requests.post(
                f"{self.base_url}/payouts",
                headers=headers,
                json=payload,
                timeout=30
            )
            response.raise_for_status()
            
            # Ajouter l'analyse des frais à la réponse
            response_data = response.json()
            response_data["fees_analysis"] = fees_analysis
            
            return response_data
            
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Erreur Wave Payout: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Erreur Wave: {str(e)}")
    
    def validate_ci_phone_number(self, phone_number: str) -> bool:
        """Valider le format du numéro de téléphone Côte d'Ivoire"""
        import re
        pattern = r'^(07|05|01)[0-9]{8}$'
        return bool(re.match(pattern, phone_number))
    
    def verify_webhook_signature(self, payload: str, signature: str) -> bool:
        """Vérifier la signature du webhook Wave - AMÉLIORÉ"""
        if not settings.WAVE_WEBHOOK_SECRET:
            logger.warning("⚠️ Aucun secret webhook Wave configuré - Vérification désactivée")
            return True  # En développement, on peut désactiver la vérification
            
        if not signature:
            logger.error("❌ Signature Wave manquante")
            return False
        
        try:
            # Wave utilise généralement HMAC-SHA256
            computed_signature = hmac.new(
                settings.WAVE_WEBHOOK_SECRET.encode('utf-8'),
                payload.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            # Comparaison sécurisée
            result = hmac.compare_digest(computed_signature, signature)
            
            if not result:
                logger.error(f"❌ Signature Wave invalide. Attendu: {computed_signature[:20]}..., Reçu: {signature[:20]}...")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Erreur vérification signature Wave: {e}")
            return False
    
    def validate_webhook_headers(self, request: Request) -> bool:
        """Valider tous les headers du webhook Wave"""
        required_headers = [
            "X-Wave-Signature",
            "X-Wave-Event",
            "X-Wave-Delivery"
        ]
        
        for header in required_headers:
            if header not in request.headers:
                logger.error(f"❌ Header Wave manquant: {header}")
                return False
        
        return True
    
    async def process_deposit_webhook(self, db: Session, webhook_data: dict) -> bool:
        """Traiter un webhook de dépôt Wave réussi - AMÉLIORÉ"""
        merchant_reference = webhook_data.get("merchant_reference", "")
        if not merchant_reference.startswith("BOOMS_DEPOSIT_"):
            logger.warning(f"⚠️ Webhook Wave ignoré - Pas un dépôt Booms: {merchant_reference}")
            return False
        
        event_type = webhook_data.get("event", "")
        if event_type != "checkout.session.completed":
            logger.warning(f"⚠️ Webhook Wave ignoré - Événement non géré: {event_type}")
            return False
        
        try:
            # Extraire user_id de la référence
            parts = merchant_reference.split("_")
            if len(parts) < 4:
                logger.error(f"❌ Référence Wave mal formée: {merchant_reference}")
                return False
                
            user_id = int(parts[2])
            
            # Récupérer les métadonnées
            metadata = webhook_data.get("metadata", {})
            
            # Utiliser les valeurs calculées depuis les métadonnées
            amount = Decimal(metadata.get("amount", "0"))
            wave_fee = Decimal(metadata.get("wave_fee", "0"))
            your_commission = Decimal(metadata.get("your_commission", "0"))
            net_to_user = Decimal(metadata.get("net_to_user", str(amount)))
            
            # AJOUT : Vérifier la cohérence avec la config centralisée
            calculated = FeesConfig.calculate_total_deposit_fees(amount, "wave")
            
            # Log de vérification
            if abs(wave_fee - calculated["provider_fee"]) > Decimal('0.01'):
                logger.warning(f"⚠️ Incohérence frais Wave: métadata={wave_fee}, calculé={calculated['provider_fee']}")
            
            logger.info(f"✅ Webhook Wave Deposit - User: {user_id}, Amount: {amount}, Net: {net_to_user}")
            
            try:
                # Transaction atomique
                with db.begin_nested():
                    # Créditer le solde liquide (montant net)
                    cash_balance = get_user_cash_balance(db, user_id)
                    cash_balance.available_balance += net_to_user
                    
                    # AJOUT: Ajouter la commission à la caisse plateforme
                    if your_commission > 0:
                        update_platform_treasury(
                            db, 
                            your_commission, 
                            f"Commission dépôt Wave - User {user_id}"
                        )
                    
                    # Enregistrer la transaction avec les frais
                    create_payment_transaction(
                        db=db,
                        user_id=user_id,
                        transaction_type="deposit",
                        amount=amount,
                        fees=wave_fee + your_commission,  # Total des frais
                        net_amount=net_to_user,
                        status=PaymentStatus.COMPLETED,
                        provider="wave_ci",
                        provider_reference=webhook_data.get("id"),
                        description=f"Dépôt Wave - Commission: {str(your_commission)} FCFA"
                    )
                
                db.commit()
                logger.info(f"✅ Dépôt Wave traité - User: {user_id}, Net: {str(net_to_user)}")
                return True
                
            except Exception as transaction_error:
                db.rollback()
                logger.error(f"❌ Erreur transaction dépôt Wave: {transaction_error}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Erreur traitement webhook Wave: {e}")
            return False
    
    async def process_withdrawal_webhook(self, db: Session, webhook_data: dict) -> bool:
        """Traiter un webhook de retrait Wave"""
        merchant_reference = webhook_data.get("merchant_reference", "")
        if not merchant_reference.startswith("BOOMS_WITHDRAWAL_"):
            logger.warning(f"⚠️ Webhook Wave retrait ignoré - Pas un retrait Booms: {merchant_reference}")
            return False
        
        event_type = webhook_data.get("event", "")
        if event_type != "payout.completed":
            logger.warning(f"⚠️ Webhook Wave retrait ignoré - Événement non géré: {event_type}")
            return False
        
        try:
            # Le retrait est déjà débité lors de l'initiation
            # Ici on confirme juste que c'est terminé
            transaction_id = webhook_data.get("id")
            status = webhook_data.get("status", "").upper()
            
            if status == "COMPLETED":
                logger.info(f"✅ Retrait Wave complété - Transaction: {transaction_id}")
                return True
            else:
                logger.warning(f"⚠️ Retrait Wave non réussi - Statut: {status}")
                # TODO: Gérer les échecs de retrait
                return False
                
        except Exception as e:
            logger.error(f"❌ Erreur traitement webhook retrait Wave: {e}")
            return False
    
    async def handle_webhook(self, request: Request, db: Session) -> bool:
        """
        Gestion centralisée des webhooks Wave
        """
        try:
            # Lire le payload
            payload = await request.body()
            payload_str = payload.decode('utf-8')
            
            # Vérifier la signature
            signature = request.headers.get("X-Wave-Signature")
            if not self.verify_webhook_signature(payload_str, signature):
                logger.error("❌ Signature Wave invalide")
                return False
            
            # Valider les headers
            if not self.validate_webhook_headers(request):
                return False
            
            # Parser le JSON
            webhook_data = json.loads(payload_str)
            event_type = request.headers.get("X-Wave-Event", "")
            
            logger.info(f"📥 Webhook Wave reçu - Événement: {event_type}")
            
            # Router selon l'événement
            if event_type == "checkout.session.completed":
                return await self.process_deposit_webhook(db, webhook_data)
            elif event_type == "payout.completed":
                return await self.process_withdrawal_webhook(db, webhook_data)
            else:
                logger.warning(f"⚠️ Événement Wave non géré: {event_type}")
                return False
                
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON Wave invalide: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ Erreur traitement webhook Wave: {e}")
            return False
    
    async def check_transaction_status(self, transaction_id: str) -> Dict:
        """Vérifier le statut d'une transaction Wave"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.get(
                f"{self.base_url}/transactions/{transaction_id}",
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"❌ Erreur vérification statut Wave: {response.status_code} - {response.text}")
                return {"status": "UNKNOWN", "error": response.text}
                
        except Exception as e:
            logger.error(f"❌ Erreur vérification transaction Wave: {e}")
            return {"status": "ERROR", "error": str(e)}
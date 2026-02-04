import stripe
from fastapi import HTTPException
from decimal import Decimal
from typing import Dict
from sqlalchemy.orm import Session
import json
import logging
from app.config import settings
from app.services.payment_service import get_user_cash_balance, create_payment_transaction, FeesConfig
from app.models.payment_models import PaymentStatus

logger = logging.getLogger(__name__)

class StripePaymentService:
    def __init__(self):
        stripe.api_key = settings.STRIPE_SECRET_KEY
        self.webhook_secret = settings.STRIPE_WEBHOOK_SECRET
    
    async def create_payment_intent(self, amount: float, user_id: str) -> Dict:
        """Créer un PaymentIntent Stripe"""
        try:
            # Conversion FCFA → centimes
            amount_cents = int(amount)
            
            # ===== NOUVEAU : CALCUL UNIFIÉ DES FRAIS =====
            amount_decimal = Decimal(str(amount))
            fees_analysis = FeesConfig.calculate_total_deposit_fees(amount_decimal, "stripe")
            
            # Extraire les valeurs calculées
            stripe_fee = fees_analysis["provider_fee"]
            your_commission = fees_analysis["your_commission"]
            net_to_user = fees_analysis["net_to_user"]
            
            # Vérifier la rentabilité
            if not fees_analysis["is_profitable"]:
                logger.warning(f"⚠️ Transaction Stripe non rentable: {fees_analysis['warning']}")
            
            intent = stripe.PaymentIntent.create(
                amount=amount_cents,
                currency='xof',
                automatic_payment_methods={'enabled': True},
                metadata={
                    'user_id': user_id,
                    'app': 'booms',
                    'type': 'wallet_deposit',
                    # AJOUT : Informations détaillées
                    'stripe_fee': str(stripe_fee),
                    'your_commission': str(your_commission),
                    'net_to_user': str(net_to_user),
                    'fees_analysis': json.dumps({
                        'provider_fee_percent': str(fees_analysis["provider_fee_percent"]),
                        'your_commission_percent': str(fees_analysis["your_commission_percent"]),
                        'is_profitable': fees_analysis["is_profitable"],
                        'your_profit': str(fees_analysis["your_profit"])
                    })
                }
            )
            
            # AJOUT : Log des frais
            logger.info(f"💳 Stripe PaymentIntent - Frais: {stripe_fee} FCFA, Commission: {your_commission} FCFA")
            
            return {
                "client_secret": intent.client_secret,
                "payment_intent_id": intent.id,
                "amount": amount,
                "currency": "xof",
                # AJOUT : Informations détaillées
                "fees_analysis": fees_analysis
            }
            
        except stripe.error.CardError as e:
            raise HTTPException(status_code=400, detail=f"Erreur carte: {e.user_message}")
        except stripe.error.StripeError as e:
            raise HTTPException(status_code=400, detail=f"Erreur Stripe: {str(e)}")
    
    async def handle_deposit_webhook(self, db: Session, payload: bytes, sig_header: str) -> bool:
        """Traiter les webhooks de dépôt Stripe"""
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, self.webhook_secret
            )
            
            if event['type'] == 'payment_intent.succeeded':
                payment_intent = event['data']['object']
                user_id = payment_intent['metadata'].get('user_id')
                amount = Decimal(str(payment_intent['amount'] / 100))  # Convertir en unités
                
                if user_id:
                    # Récupérer les métadonnées des frais
                    metadata = payment_intent.get('metadata', {})
                    stripe_fee = Decimal(metadata.get('stripe_fee', '0'))
                    your_commission = Decimal(metadata.get('your_commission', '0'))
                    net_to_user = Decimal(metadata.get('net_to_user', str(amount)))
                    
                    # ===== NOUVEAU : VÉRIFICATION COHÉRENCE FRAIS =====
                    calculated = FeesConfig.calculate_total_deposit_fees(amount, "stripe")
                    
                    # Log de vérification
                    if abs(stripe_fee - calculated["provider_fee"]) > Decimal('0.01'):
                        logger.warning(f"⚠️ Incohérence frais Stripe: métadata={stripe_fee}, calculé={calculated['provider_fee']}")
                    
                    # Créditer le solde liquide (montant net)
                    cash_balance = get_user_cash_balance(db, user_id)
                    cash_balance.available_balance += net_to_user
                    
                    # Enregistrer la transaction
                    create_payment_transaction(
                        db=db,
                        user_id=int(user_id),
                        transaction_type="deposit",
                        amount=amount,
                        fees=stripe_fee + your_commission,  # Total des frais
                        net_amount=net_to_user,
                        status=PaymentStatus.COMPLETED,
                        provider="stripe",
                        provider_reference=payment_intent['id'],
                        description=f"Dépôt carte bancaire - Commission: {your_commission} FCFA"
                    )
                    
                    db.commit()
                    
                    logger.info(f"✅ Dépôt Stripe traité - User: {user_id}, Montant: {amount}, Net: {net_to_user}")
                    return True
                    
        except ValueError as e:
            raise HTTPException(status_code=400, detail="Payload invalide")
        except stripe.error.SignatureVerificationError as e:
            raise HTTPException(status_code=400, detail="Signature invalide")
        
        return False
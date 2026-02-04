from sqlalchemy.orm import Session, joinedload
from decimal import Decimal
from typing import Dict, Any, List, Optional
from sqlalchemy.exc import IntegrityError
from app.models.payment_models import CashBalance, PaymentTransaction, PaymentStatus
from app.models.user_models import User
from app.models.bom_models import UserBom
from app.services.social_value_calculator import SocialValueCalculator
from app.models.user_models import Wallet

# ============ CONSTANTES DE DEVISES (DÉJÀ AJOUTÉ) ============
SYSTEM_CURRENCY = "FCFA"
ALLOWED_CURRENCIES = ["FCFA"]

# ============ NOUVELLE CONFIGURATION DES FRAIS UNIFIÉE ============
class FeesConfig:
    """Configuration CENTRALISÉE des frais - VERSION UNIFIÉE"""
    
    # ===== TES COMMISSIONS FIXES (TU DÉCIDES) =====
    YOUR_DEPOSIT_COMMISSION = Decimal('0.015')    # 1.5% pour toi sur dépôts
    YOUR_WITHDRAWAL_COMMISSION = Decimal('0.02')  # 2.0% pour toi sur retraits
    YOUR_BOM_PURCHASE_COMMISSION = Decimal('0.05')  # 5.0% sur achats Boms
    YOUR_GIFT_COMMISSION = Decimal('0.03')        # 3.0% sur cadeaux
    YOUR_BOM_WITHDRAWAL_COMMISSION = Decimal('0.03')  # 3.0% sur retraits Boms
    
    # ===== FRAIS RÉELS DES PROVIDERS (À VÉRIFIER DANS LEURS DOCS) =====
    PROVIDER_FEES = {
        # Dépôts
        'wave_deposit': Decimal('0.015'),            # 1.5% Wave CI
        'mtn_momo_deposit': Decimal('0.025'),        # 2.5% MTN MoMo
        'orange_money_deposit': Decimal('0.020'),    # 2.0% Orange Money
        'stripe_deposit': Decimal('0.030'),          # 3.0% Stripe
        
        # Retraits
        'wave_withdrawal': Decimal('0.020'),         # 2.0% Wave CI
        'mtn_momo_withdrawal': Decimal('0.030'),     # 3.0% MTN MoMo
        'orange_money_withdrawal': Decimal('0.025'), # 2.5% Orange Money
        'stripe_withdrawal': Decimal('0.035'),       # 3.5% Stripe (si applicable)
    }
    
    # ===== LIMITES =====
    MIN_WITHDRAWAL_AMOUNT = Decimal('1000')    # 1000 FCFA minimum
    MAX_WITHDRAWAL_AMOUNT = Decimal('1000000') # 1M FCFA maximum
    
    # ===== MÉTHODES DE CALCUL UNIFIÉES =====
    
    @classmethod
    def calculate_total_deposit_fees(cls, amount: Decimal, provider: str) -> Dict[str, Decimal]:
        """
        Calculer TOUS les frais pour un dépôt.
        Retourne un dictionnaire détaillé.
        """
        # 1. Frais du provider
        provider_fee_key = f"{provider.lower()}_deposit"
        provider_fee_percent = cls.PROVIDER_FEES.get(provider_fee_key, Decimal('0.025'))
        provider_fee = amount * provider_fee_percent
        
        # 2. Ta commission
        your_commission = amount * cls.YOUR_DEPOSIT_COMMISSION
        
        # 3. Total frais
        total_fees = provider_fee + your_commission
        
        # 4. Montant net pour l'utilisateur
        net_to_user = amount - total_fees
        
        # 5. Vérification que tu gagnes bien de l'argent
        your_profit = your_commission - provider_fee
        profitable = your_profit > Decimal('0')
        
        return {
            "amount": amount,
            "provider": provider,
            "provider_fee_percent": provider_fee_percent,
            "provider_fee": provider_fee,
            "your_commission_percent": cls.YOUR_DEPOSIT_COMMISSION,
            "your_commission": your_commission,
            "total_fees": total_fees,
            "net_to_user": net_to_user,
            "your_profit": your_profit,
            "is_profitable": profitable,
            "warning": "⚠️ TU PERDS DE L'ARGENT !" if not profitable else "✅ Transaction rentable"
        }
    
    @classmethod
    def calculate_total_withdrawal_fees(cls, amount: Decimal, provider: str) -> Dict[str, Decimal]:
        """
        Calculer TOUS les frais pour un retrait.
        """
        # 1. Frais du provider
        provider_fee_key = f"{provider.lower()}_withdrawal"
        provider_fee_percent = cls.PROVIDER_FEES.get(provider_fee_key, Decimal('0.030'))
        provider_fee = amount * provider_fee_percent
        
        # 2. Ta commission
        your_commission = amount * cls.YOUR_WITHDRAWAL_COMMISSION
        
        # 3. Total frais
        total_fees = provider_fee + your_commission
        
        # 4. Montant net pour l'utilisateur
        net_to_user = amount - total_fees
        
        # 5. Vérification profit
        your_profit = your_commission - provider_fee
        profitable = your_profit > Decimal('0')
        
        return {
            "amount": amount,
            "provider": provider,
            "provider_fee_percent": provider_fee_percent,
            "provider_fee": provider_fee,
            "your_commission_percent": cls.YOUR_WITHDRAWAL_COMMISSION,
            "your_commission": your_commission,
            "total_fees": total_fees,
            "net_to_user": net_to_user,
            "your_profit": your_profit,
            "is_profitable": profitable,
            "warning": "⚠️ TU PERDS DE L'ARGENT !" if not profitable else "✅ Transaction rentable"
        }
    
    @classmethod
    def calculate_bom_purchase_fees(cls, amount: Decimal) -> Dict[str, Decimal]:
        """
        Frais pour l'achat d'un Bom (pas de frais provider).
        """
        your_commission = amount * cls.YOUR_BOM_PURCHASE_COMMISSION
        
        return {
            "amount": amount,
            "your_commission_percent": cls.YOUR_BOM_PURCHASE_COMMISSION,
            "your_commission": your_commission,
            "net_to_seller": amount - your_commission,  # Si c'est une vente entre users
            "transaction_type": "bom_purchase"
        }
    
    @classmethod
    def calculate_gift_fees(cls, amount: Decimal) -> Dict[str, Decimal]:
        """
        Frais pour les cadeaux.
        """
        your_commission = amount * cls.YOUR_GIFT_COMMISSION
        
        return {
            "amount": amount,
            "your_commission_percent": cls.YOUR_GIFT_COMMISSION,
            "your_commission": your_commission,
            "net_to_receiver": amount - your_commission,
            "transaction_type": "gift"
        }
    
    @classmethod
    def calculate_bom_withdrawal_fees(cls, amount: Decimal) -> Dict[str, Decimal]:
        """
        Frais pour retrait Bom → argent.
        """
        your_commission = amount * cls.YOUR_BOM_WITHDRAWAL_COMMISSION
        
        return {
            "amount": amount,
            "your_commission_percent": cls.YOUR_BOM_WITHDRAWAL_COMMISSION,
            "your_commission": your_commission,
            "net_to_user": amount - your_commission,
            "transaction_type": "bom_withdrawal"
        }
    
    @classmethod
    def get_provider_fee_percent(cls, provider: str, transaction_type: str) -> Decimal:
        """
        Récupérer le pourcentage de frais d'un provider pour un type donné.
        """
        key = f"{provider.lower()}_{transaction_type.lower()}"
        return cls.PROVIDER_FEES.get(key, Decimal('0.025'))  # 2.5% par défaut
    
    @classmethod
    def validate_profitability(cls, amount: Decimal, provider: str, transaction_type: str) -> bool:
        """
        Valider qu'une transaction sera rentable.
        """
        if transaction_type == "deposit":
            fees = cls.calculate_total_deposit_fees(amount, provider)
        elif transaction_type == "withdrawal":
            fees = cls.calculate_total_withdrawal_fees(amount, provider)
        else:
            # Pour les autres types, pas de frais provider
            return True
        
        return fees["is_profitable"]
        
    # ===== MÉTHODE DÉFINITIVE POUR ADMIN TREASURY =====
    
    @classmethod
    def calculate_admin_treasury_fees(cls, amount: Decimal, provider: str, operation: str) -> Dict[str, Any]:
        """
        Calcul des frais pour opérations treasury admin : 0% DE FRAIS
        Version 100% compatible et traçable
        """
        import logging
        logger = logging.getLogger(__name__)
        
        # Log structuré pour monitoring
        logger.info(
            f"🏦 ADMIN TREASURY OPERATION",
            extra={
                "operation": operation.upper(),
                "amount": str(amount),
                "provider": provider,
                "fees_percentage": 0.0,
                "category": "admin_exempted"
            }
        )
        
        # Structure EXACTEMENT compatible avec vos retours existants
        base_result = {
            "amount": amount,
            "provider": provider,
            "provider_fee_percent": Decimal('0.00'),
            "provider_fee": Decimal('0.00'),
            "your_commission_percent": Decimal('0.00'),
            "your_commission": Decimal('0.00'),
            "total_fees": Decimal('0.00'),
            "net_to_user": amount,
            "your_profit": Decimal('0.00'),
            "is_profitable": True,
            "is_admin_operation": True,
            "fee_percentage": 0.0,
            "calculation_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        # Champs spécifiques par opération (compatibilité totale)
        if operation == "deposit":
            result = {
                **base_result,
                "net_amount": amount,
                "warning": "✅ Dépôt admin - frais exemptés",
                "transaction_type": "admin_treasury_deposit"
            }
        elif operation == "withdrawal":
            result = {
                **base_result,
                "net_amount": amount,
                "warning": "✅ Retrait admin - frais exemptés",
                "transaction_type": "admin_treasury_withdrawal"
            }
        else:
            raise ValueError(f"Opération non reconnue: {operation}")
        
        return result

# ============ FONCTIONS UTILITAIRES ============

def validate_payment_currency(currency: str) -> str:
    """
    Valider la devise d'un paiement.
    Force l'utilisation de FCFA uniquement.
    """
    if not currency:
        return SYSTEM_CURRENCY
    
    currency = currency.upper().strip()
    
    # Liste exhaustive des corrections
    corrections = {
        "USD": SYSTEM_CURRENCY,
        "USDT": SYSTEM_CURRENCY,
        "USDC": SYSTEM_CURRENCY,
        "EUR": SYSTEM_CURRENCY,
        "GBP": SYSTEM_CURRENCY,
        "JPY": SYSTEM_CURRENCY,
        "CNY": SYSTEM_CURRENCY,
        "$": SYSTEM_CURRENCY,
        "€": SYSTEM_CURRENCY,
        "£": SYSTEM_CURRENCY,
        "DOLLAR": SYSTEM_CURRENCY,
        "DOLLARS": SYSTEM_CURRENCY,
        "EURO": SYSTEM_CURRENCY,
        "XOF": SYSTEM_CURRENCY,
        "CFA": SYSTEM_CURRENCY,
        "FRANC": SYSTEM_CURRENCY,
        "FCFA FRANC": SYSTEM_CURRENCY
    }
    
    if currency in corrections:
        corrected = corrections[currency]
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"🔄 Devise de paiement corrigée: {currency} → {corrected}")
        return corrected
    
    if currency not in ALLOWED_CURRENCIES:
        raise ValueError(f"Devise de paiement non supportée: {currency}. "
                        f"Seule la devise {SYSTEM_CURRENCY} est acceptée.")
    
    return currency
    
def enforce_fcfa_only(currency: str) -> str:
    """
    Force l'utilisation exclusive de FCFA.
    Rejette toute autre devise avec message clair.
    """
    if not currency:
        return "FCFA"
    
    currency_upper = currency.upper().strip()
    
    # Liste exhaustive des variantes acceptées
    accepted_variants = [
        "FCFA", 
        "XOF", 
        "CFA", 
        "FRANC CFA",
        "FRANCS CFA",
        "F CFA",
        "FCFA FRANC"
    ]
    
    # Vérification stricte
    if currency_upper not in accepted_variants:
        raise ValueError(
            f"❌ Devise '{currency}' non supportée. "
            f"Seule la devise FCFA (Franc CFA) est acceptée sur cette plateforme. "
            f"Si vous venez d'un autre pays, contactez le support."
        )
    
    # Normalisation à FCFA
    return "FCFA"

# ============ FONCTIONS EXISTANTES (MAINTENANT UNIFIÉES) ============

def get_detailed_balance(db: Session, user_id: int) -> Dict:
    """Calculer le solde détaillé (cash + virtuel + valeur Boms + valeur sociale)"""

    from app.models.user_models import Wallet

    def to_decimal(value: Any) -> Decimal:
        if value is None:
            return Decimal('0.00')
        if isinstance(value, Decimal):
            return value
        try:
            return Decimal(str(value))
        except Exception:
            return Decimal('0.00')

    # 1. Solde RÉEL depuis CashBalance
    cash_balance = db.query(CashBalance).filter(CashBalance.user_id == user_id).first()
    liquid_balance = to_decimal(cash_balance.available_balance if cash_balance else Decimal('0.00'))

    # 2. Solde VIRTUEL depuis Wallet (redistributions)
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    virtual_balance = to_decimal(wallet.balance if wallet else Decimal('0.00'))

    # 3. Valeur patrimoniale + sociale des Boms actifs (dépend du marché)
    social_calculator = SocialValueCalculator(db)
    user_boms = db.query(UserBom).options(joinedload(UserBom.bom)).filter(
        UserBom.user_id == user_id,
        UserBom.is_sold.is_(False),
        UserBom.deleted_at.is_(None),
        UserBom.transferred_at.is_(None)
    ).all()

    bom_value = Decimal('0.00')
    social_value = Decimal('0.00')

    for user_bom in user_boms:
        bom_asset = user_bom.bom
        if not bom_asset or not bom_asset.is_active:
            continue

        current_market_value = social_calculator.calculate_current_value(bom_asset.id)
        bom_value += to_decimal(current_market_value)
        social_value += to_decimal(getattr(bom_asset, 'social_value', Decimal('0.00')))

    total_balance = liquid_balance + virtual_balance + bom_value + social_value

    # Priorité devise: cash -> wallet -> défaut
    currency = None
    if cash_balance and getattr(cash_balance, 'currency', None):
        currency = cash_balance.currency
    elif wallet and getattr(wallet, 'currency', None):
        currency = wallet.currency
    else:
        currency = "FCFA"

    return {
        "liquid_balance": float(liquid_balance),
        "virtual_balance": float(virtual_balance),
        "bom_value": float(bom_value),
        "social_value": float(social_value),
        "total_balance": float(total_balance),
        "currency": currency
    }

def get_user_cash_balance(db: Session, user_id: int) -> CashBalance:
    """Récupérer ou créer le solde liquide d'un utilisateur"""
    cash_balance = db.query(CashBalance).filter(CashBalance.user_id == user_id).first()
    if not cash_balance:
        cash_balance = CashBalance(user_id=user_id, available_balance=Decimal('0.00'))
        db.add(cash_balance)
        db.commit()
        db.refresh(cash_balance)
    return cash_balance

def has_sufficient_cash_balance(db: Session, user_id: int, amount: Decimal) -> bool:
    """Vérifier si l'utilisateur a suffisamment de solde liquide"""
    cash_balance = get_user_cash_balance(db, user_id)
    return cash_balance.available_balance >= amount

def create_payment_transaction(
    db: Session,
    user_id: int,
    transaction_type: str,
    amount: Decimal,
    fees: Decimal,
    net_amount: Decimal,
    status: PaymentStatus,
    provider: str = "system",
    provider_reference: str = None,
    description: str = None,
    user_bom_id: int = None,
    currency: str = SYSTEM_CURRENCY
) -> PaymentTransaction:
    """Créer une transaction de paiement - VERSION ATOMIQUE"""
    import uuid
    import logging
    from datetime import datetime, timezone
    
    currency = enforce_fcfa_only(currency)
    logger = logging.getLogger(__name__)
    
    # AJOUT: Validation devise
    logger.info(f"💳 Création transaction en {SYSTEM_CURRENCY}: "
               f"user={user_id}, type={transaction_type}, amount={amount}")
    
    # AJOUT: Validation de rentabilité
    if transaction_type in ["deposit", "withdrawal"]:
        is_profitable = FeesConfig.validate_profitability(amount, provider, transaction_type)
        if not is_profitable:
            logger.error(f"❌ Transaction non rentable: {provider} {transaction_type} {amount}")
            # Tu peux choisir de bloquer ou juste logger
            # raise ValueError(f"Transaction non rentable avec {provider}")
    
    # S'assurer que la description mentionne la devise
    if description and SYSTEM_CURRENCY not in description:
        description = f"{description} ({SYSTEM_CURRENCY})"
    
    transaction = PaymentTransaction(
        id=f"{transaction_type}_{uuid.uuid4().hex[:16]}",
        user_id=user_id,
        type=transaction_type,
        amount=amount,
        fees=fees,
        net_amount=net_amount,
        status=status,
        provider=provider,
        provider_reference=provider_reference,
        description=description,
        user_bom_id=user_bom_id,
        currency=currency
    )
    
    try:
        with db.begin_nested():  # Transaction atomique
            db.add(transaction)
            logger.info(f"💳 PaymentTransaction créée: id={transaction.id}, type={transaction_type}")
        
        db.commit()
        return transaction
    except IntegrityError as e:
        logger.error(f"❌ Erreur création paiement (IntegrityError): {e}")
        db.rollback()
        raise ValueError(f"Erreur paiement: {str(e)}")
    except Exception as e:
        logger.error(f"❌ Erreur création paiement: {e}")
        db.rollback()
        raise

# ============ NOUVELLE FONCTION POUR TRACER LES FRAIS ============

def log_fees_analysis(db: Session, user_id: int, amount: Decimal, provider: str, 
                     transaction_type: str) -> Dict[str, any]:
    """
    Analyser et logger les frais d'une transaction.
    Retourne un rapport détaillé.
    """
    import logging
    from app.models.admin_models import AdminLog
    
    logger = logging.getLogger(__name__)
    
    if transaction_type == "deposit":
        fees_analysis = FeesConfig.calculate_total_deposit_fees(amount, provider)
    elif transaction_type == "withdrawal":
        fees_analysis = FeesConfig.calculate_total_withdrawal_fees(amount, provider)
    elif transaction_type == "bom_purchase":
        fees_analysis = FeesConfig.calculate_bom_purchase_fees(amount)
    elif transaction_type == "gift":
        fees_analysis = FeesConfig.calculate_gift_fees(amount)
    elif transaction_type == "bom_withdrawal":
        fees_analysis = FeesConfig.calculate_bom_withdrawal_fees(amount)
    else:
        fees_analysis = {"error": "Type de transaction non reconnu"}
    
    # Log admin pour audit
    admin_log = AdminLog(
        admin_id=0,  # Système
        action="fees_analysis",
        details=fees_analysis,
        fees_amount=fees_analysis.get("your_commission", Decimal('0.00'))
    )
    db.add(admin_log)
    db.commit()
    
    logger.info(f"📊 Analyse frais: {transaction_type} via {provider}")
    logger.info(f"   Montant: {amount} FCFA")
    logger.info(f"   Frais provider: {fees_analysis.get('provider_fee', 0)} FCFA")
    logger.info(f"   Ta commission: {fees_analysis.get('your_commission', 0)} FCFA")
    logger.info(f"   Ton profit: {fees_analysis.get('your_profit', 0)} FCFA")
    logger.info(f"   Rentable: {fees_analysis.get('is_profitable', True)}")
    
    return fees_analysis
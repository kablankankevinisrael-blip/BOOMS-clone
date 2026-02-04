from sqlalchemy.orm import Session
from decimal import Decimal
from datetime import datetime, date
from typing import Dict, List
import logging

from app.models.payment_models import PaymentTransaction, CashBalance
from app.services.wallet_service import get_platform_treasury
from app.services.payment_service import FeesConfig  # AJOUT : Importer la config unifiée

logger = logging.getLogger(__name__)

class CommissionService:
    """Gestion de vos commissions et revenus - VERSION UNIFIÉE"""
    
    @staticmethod
    def calculate_deposit_commission(db: Session, amount: Decimal, provider: str = "wave") -> Dict:
        """Calculer les frais pour un dépôt - UTILISE LA CONFIG UNIFIÉE"""
        try:
            # Utiliser la configuration centralisée
            fees_analysis = FeesConfig.calculate_total_deposit_fees(amount, provider)
            
            # Créditer la caisse plateforme avec ta commission
            your_commission = fees_analysis["your_commission"]
            try:
                treasury = get_platform_treasury(db)
                treasury.balance += your_commission
                db.commit()  # Commit ici car c'est une méthode statique
                logger.info(f"💰 Commission dépôt {provider} créditée à la caisse: +{your_commission} FCFA")
            except Exception as e:
                logger.warning(f"⚠️ Erreur crédit commission dépôt: {e}")
                db.rollback()
            
            logger.info(f"💰 Commission dépôt {provider}: {your_commission} FCFA")
            
            return fees_analysis
            
        except Exception as e:
            logger.error(f"❌ Erreur calcul commission dépôt: {e}")
            # Fallback
            return {
                "amount": amount,
                "provider_fee": Decimal('0.00'),
                "your_commission": amount * Decimal('0.015'),
                "total_fees": amount * Decimal('0.015'),
                "net_to_user": amount * Decimal('0.985'),
                "is_profitable": True,
                "error": str(e)
            }
    
    @staticmethod
    def calculate_withdrawal_commission(db: Session, amount: Decimal, provider: str = "wave") -> Dict:
        """Calculer les frais pour un retrait - UTILISE LA CONFIG UNIFIÉE"""
        try:
            # Utiliser la configuration centralisée
            fees_analysis = FeesConfig.calculate_total_withdrawal_fees(amount, provider)
            
            # Créditer la caisse plateforme avec ta commission
            your_commission = fees_analysis["your_commission"]
            try:
                treasury = get_platform_treasury(db)
                treasury.balance += your_commission
                db.commit()  # Commit ici car c'est une méthode statique
                logger.info(f"💰 Commission retrait {provider} créditée à la caisse: +{your_commission} FCFA")
            except Exception as e:
                logger.warning(f"⚠️ Erreur crédit commission retrait: {e}")
                db.rollback()
            
            logger.info(f"💰 Commission retrait {provider}: {your_commission} FCFA")
            
            return fees_analysis
            
        except Exception as e:
            logger.error(f"❌ Erreur calcul commission retrait: {e}")
            # Fallback
            return {
                "amount": amount,
                "provider_fee": Decimal('0.00'),
                "your_commission": amount * Decimal('0.02'),
                "total_fees": amount * Decimal('0.02'),
                "net_to_user": amount * Decimal('0.98'),
                "is_profitable": True,
                "error": str(e)
            }
    
    @staticmethod
    def get_daily_commissions(db: Session, target_date: date = None) -> Dict:
        """Obtenir vos commissions du jour - AMÉLIORÉ"""
        if target_date is None:
            target_date = date.today()
            
        start_datetime = datetime.combine(target_date, datetime.min.time())
        end_datetime = datetime.combine(target_date, datetime.max.time())
        
        # Transactions de dépôt
        deposit_tx = db.query(PaymentTransaction).filter(
            PaymentTransaction.type == "deposit",
            PaymentTransaction.status == "completed",
            PaymentTransaction.created_at.between(start_datetime, end_datetime)
        ).all()
        
        # Transactions de retrait  
        withdrawal_tx = db.query(PaymentTransaction).filter(
            PaymentTransaction.type == "withdrawal",
            PaymentTransaction.status == "completed", 
            PaymentTransaction.created_at.between(start_datetime, end_datetime)
        ).all()
        
        # Group par provider
        deposit_by_provider = {}
        withdrawal_by_provider = {}
        
        for tx in deposit_tx:
            provider = tx.provider or "unknown"
            deposit_by_provider[provider] = deposit_by_provider.get(provider, Decimal('0.00')) + tx.fees
        
        for tx in withdrawal_tx:
            provider = tx.provider or "unknown"
            withdrawal_by_provider[provider] = withdrawal_by_provider.get(provider, Decimal('0.00')) + tx.fees
        
        total_deposit_commissions = sum(tx.fees for tx in deposit_tx)
        total_withdrawal_commissions = sum(tx.fees for tx in withdrawal_tx)
        
        # AJOUT : Analyse de rentabilité
        profitable_deposits = sum(1 for tx in deposit_tx if tx.fees > Decimal('0'))
        profitable_withdrawals = sum(1 for tx in withdrawal_tx if tx.fees > Decimal('0'))
        
        return {
            "date": target_date.isoformat(),
            "summary": {
                "deposit_commissions": float(total_deposit_commissions),
                "withdrawal_commissions": float(total_withdrawal_commissions),
                "total_commissions": float(total_deposit_commissions + total_withdrawal_commissions),
                "deposit_count": len(deposit_tx),
                "withdrawal_count": len(withdrawal_tx),
                "profitable_deposits": profitable_deposits,
                "profitable_withdrawals": profitable_withdrawals
            },
            "by_provider": {
                "deposits": {k: float(v) for k, v in deposit_by_provider.items()},
                "withdrawals": {k: float(v) for k, v in withdrawal_by_provider.items()}
            },
            "transactions": {
                "deposits": [
                    {
                        "id": tx.id,
                        "amount": float(tx.amount),
                        "fees": float(tx.fees),
                        "provider": tx.provider,
                        "created_at": tx.created_at.isoformat() if tx.created_at else None
                    }
                    for tx in deposit_tx[:10]  # Limiter pour éviter trop de données
                ],
                "withdrawals": [
                    {
                        "id": tx.id,
                        "amount": float(tx.amount),
                        "fees": float(tx.fees),
                        "provider": tx.provider,
                        "created_at": tx.created_at.isoformat() if tx.created_at else None
                    }
                    for tx in withdrawal_tx[:10]
                ]
            }
        }
    
    @staticmethod
    def get_profitability_report(db: Session, days: int = 7) -> Dict:
        """
        Générer un rapport de rentabilité sur plusieurs jours.
        """
        from datetime import timedelta
        
        end_date = date.today()
        start_date = end_date - timedelta(days=days)
        
        report = {
            "period": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
                "days": days
            },
            "daily_breakdown": [],
            "providers": {},
            "totals": {
                "total_revenue": Decimal('0.00'),
                "total_provider_fees": Decimal('0.00'),
                "total_your_commission": Decimal('0.00'),
                "net_profit": Decimal('0.00'),
                "transaction_count": 0,
                "profitable_count": 0,
                "unprofitable_count": 0
            }
        }
        
        # Pour chaque jour
        current_date = start_date
        while current_date <= end_date:
            daily = CommissionService.get_daily_commissions(db, current_date)
            report["daily_breakdown"].append(daily)
            
            # Accumuler les totaux
            report["totals"]["total_revenue"] += Decimal(str(daily["summary"]["total_commissions"]))
            report["totals"]["transaction_count"] += daily["summary"]["deposit_count"] + daily["summary"]["withdrawal_count"]
            report["totals"]["profitable_count"] += daily["summary"]["profitable_deposits"] + daily["summary"]["profitable_withdrawals"]
            
            current_date += timedelta(days=1)
        
        # Calculer le profit net (approximatif)
        # Note: Pour un calcul exact, il faudrait séparer provider_fee et your_commission
        report["totals"]["net_profit"] = report["totals"]["total_revenue"] * Decimal('0.7')  # Estimation
        
        # AJOUT : Recommandations
        report["recommendations"] = []
        
        if report["totals"]["unprofitable_count"] > 0:
            report["recommendations"].append(
                f"⚠️ {report['totals']['unprofitable_count']} transactions non rentables détectées"
            )
        
        if report["totals"]["net_profit"] < Decimal('10000'):
            report["recommendations"].append(
                "💡 Considérez augmenter vos commissions légèrement"
            )
        
        logger.info(f"📊 Rapport rentabilité: {report['totals']['net_profit']} FCFA sur {days} jours")
        
        return report
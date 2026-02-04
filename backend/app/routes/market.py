# backend/app/routes/market.py - VERSION CORRIGÉE

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, timedelta, timezone
import random  # IMPORT AJOUTÉ

from app.database import get_db
from app.models.user_models import User
from app.models.bom_models import BomAsset, UserBom
from app.schemas.market_schemas import (
    MarketBuyRequest, MarketSellRequest, MarketResponse,
    MarketOverviewResponse, BoomMarketData, MarketTradeResponse
)
from app.services.market_service import MarketService
from app.services.auth import get_current_user_from_token as get_current_user
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market", tags=["market"])

# === FONCTIONS UTILITAIRES CORRIGÉES (sans self) ===

def get_event_effect_description(boom: BomAsset, action: str) -> str:
    """Obtenir description de l'effet d'événement"""
    if not boom.active_event:
        return "Aucun événement actif"
    
    effects = {
        "fomo_flash": {
            "buy": "🎯 ACHAT: Prix +15% pendant l'événement",
            "sell": "💰 VENTE: Prix +15% pendant l'événement"
        },
        "lucky_dip": {
            "buy": "🎰 ACHAT: Prix -30% pendant l'événement!",
            "sell": "📊 VENTE: Prix normal pendant l'événement"
        },
        "whale_alert": {
            "buy": "🐋 ACHAT: Prix +10% pendant l'événement",
            "sell": "📈 VENTE: Prix +10% pendant l'événement"
        },
        "panic_sell": {
            "buy": "📉 ACHAT: Prix -8% pendant l'événement",
            "sell": "😨 VENTE: Prix -8% pendant l'événement"
        },
        "moon_shot": {
            "buy": "🌙 ACHAT: Prix +25% TO THE MOON!",
            "sell": "🚀 VENTE: Prix +25% TO THE MOON!"
        }
    }
    
    if boom.active_event in effects and action in effects[boom.active_event]:
        return effects[boom.active_event][action]
    
    return "Effet d'événement spécial actif"

def get_event_description(event_type: str) -> str:
    """Obtenir description d'un type d'événement"""
    descriptions = {
        "fomo_flash": "Fear Of Missing Out! Les traders achètent en masse, faisant monter les prix.",
        "lucky_dip": "Opportunité rare! Prix réduit pour les courageux qui achètent maintenant.",
        "whale_alert": "Un gros investisseur est entré sur le marché, créant une vague d'optimisme.",
        "panic_sell": "Les traders paniquent et vendent, créant des opportunités d'achat.",
        "moon_shot": "Pump extrême! Le prix s'envole temporairement."
    }
    return descriptions.get(event_type, "Événement spécial actif")

def get_market_status(db: Session) -> str:
    """Obtenir statut général du marché"""
    from sqlalchemy import func
    
    try:
        total_volume = db.query(func.sum(BomAsset.total_volume_24h)).scalar() or 0
        active_events = db.query(BomAsset).filter(
            BomAsset.active_event.isnot(None),
            BomAsset.event_expires_at > datetime.now(timezone.utc)
        ).count()
        
        if total_volume > 1000000:
            return "📈 MARKET HOT - Fort volume d'échanges"
        elif active_events > 3:
            return "🎰 EVENT FRENZY - Multiples événements actifs"
        elif total_volume < 100000:
            return "📊 MARKET CALM - Faible activité"
        else:
            return "⚡ MARKET ACTIVE - Activité normale"
    except Exception as e:
        logger.error(f"Error getting market status: {e}")
        return "⚡ MARKET ACTIVE"

# === ROUTES API ===

@router.get("/overview", response_model=MarketOverviewResponse)
async def get_market_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """📊 Obtenir un aperçu complet du marché BOOMS"""
    try:
        logger.info(f"📈 MARKET OVERVIEW - User: {current_user.id}")
        
        market_service = MarketService(db)
        overview = market_service.get_market_overview()
        
        # CORRECTION: Assurez-vous que le schéma correspond
        return MarketOverviewResponse(
            total_market_cap=overview.get("total_market_cap", 0),
            total_volume_24h=overview.get("total_volume_24h", 0),
            active_nfts=overview.get("active_nfts", 0),
            total_fees_collected=overview.get("total_fees_collected", 0),
            top_gainers=overview.get("top_gainers", []),
            top_losers=overview.get("top_losers", []),
            hot_nfts=overview.get("hot_nfts", []),
            active_events=overview.get("active_events", [])
        )
        
    except Exception as e:
        logger.error(f"❌ MARKET OVERVIEW ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/boom/{boom_id}", response_model=BoomMarketData)
async def get_boom_market_data(
    boom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """📈 Obtenir les données marché pour un Boom spécifique"""
    try:
        logger.info(f"📊 BOOM MARKET DATA - User: {current_user.id}, Boom: {boom_id}")
        
        market_service = MarketService(db)
        market_data = market_service.get_boom_market_data(boom_id)
        
        # CORRECTION: Vérifier que tous les champs sont présents
        return BoomMarketData(
            boom_id=market_data.get("boom_id", boom_id),
            title=market_data.get("title", "Inconnu"),
            artist=market_data.get("artist", "Inconnu"),
            current_price=market_data.get("current_social_value", 0.0),
            social_value=market_data.get("social_metrics", {}).get("social_value", 0.0),
            total_value=market_data.get("social_metrics", {}).get("total_value", 0.0),
            total_holders=market_data.get("social_metrics", {}).get("unique_holders", 0),
            total_shares=market_data.get("social_metrics", {}).get("share_count_24h", 0),
            total_volume_24h=market_data.get("social_metrics", {}).get("volume_24h", 0.0),
            created_at=datetime.fromisoformat(market_data.get("last_updated", datetime.now(timezone.utc).isoformat())),
            prices=market_data.get("prices", {}),
            market_stats=market_data.get("market_stats", {}),
            change=market_data.get("change", {}),
            event=market_data.get("social_event"),
            price_history=market_data.get("price_history", [])
        )
        
    except ValueError as e:
        logger.error(f"❌ BOOM NOT FOUND: {str(e)}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"❌ BOOM MARKET DATA ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/price/{boom_id}/buy")
async def get_buy_price(
    boom_id: int,
    quantity: int = Query(1, ge=1, le=100, description="Quantité à acheter"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """💰 Obtenir le prix d'achat avec frais cachés"""
    try:
        logger.info(f"💰 BUY PRICE REQUEST - User: {current_user.id}, Boom: {boom_id}, Qty: {quantity}")
        
        market_service = MarketService(db)
        buy_price = market_service.get_buy_price(boom_id)
        total_cost = buy_price * quantity
        
        # Récupérer le Boom pour plus d'informations
        boom = db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if not boom:
            raise HTTPException(status_code=404, detail="Boom non trouvé")
        
        return {
            "boom_id": boom_id,
            "boom_title": boom.title,
            "quantity": quantity,
            "prices": {
                "market_price": float(boom.current_price) if boom.current_price else 0.0,
                "buy_price_per_unit": float(buy_price),
                "fees_per_unit": float(buy_price - boom.current_price) if boom.current_price else 0.0,
                "total_cost": float(total_cost)
            },
            "fees_breakdown": {
                "spread_percentage": float(boom.buy_spread * 100) if hasattr(boom, 'buy_spread') and boom.buy_spread else 0.0,
                "fees_amount": float((buy_price - boom.current_price) * quantity) if boom.current_price else 0.0,
                "event_active": boom.active_event if hasattr(boom, 'active_event') and boom.active_event else None,
                "event_effect": get_event_effect_description(boom, "buy")
            },
            "market_impact": f"L'achat fera monter le prix d'environ {boom.volatility_score * 100 * quantity:.2f}%" if hasattr(boom, 'volatility_score') and boom.volatility_score else "Impact minimal"
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ BUY PRICE ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/price/{boom_id}/sell")
async def get_sell_price(
    boom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """💰 Obtenir le prix de vente avec frais cachés"""
    try:
        logger.info(f"💰 SELL PRICE REQUEST - User: {current_user.id}, Boom: {boom_id}")
        
        market_service = MarketService(db)
        sell_price = market_service.get_sell_price(boom_id)
        
        boom = db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if not boom:
            raise HTTPException(status_code=404, detail="Boom non trouvé")
        
        return {
            "boom_id": boom_id,
            "boom_title": boom.title,
            "prices": {
                "market_price": float(boom.current_price) if boom.current_price else 0.0,
                "sell_price": float(sell_price),
                "fees": float(boom.current_price - sell_price) if boom.current_price else 0.0
            },
            "fees_breakdown": {
                "spread_percentage": float(boom.sell_spread * 100) if hasattr(boom, 'sell_spread') and boom.sell_spread else 0.0,
                "fees_amount": float(boom.current_price - sell_price) if boom.current_price else 0.0,
                "event_active": boom.active_event if hasattr(boom, 'active_event') and boom.active_event else None,
                "event_effect": get_event_effect_description(boom, "sell")
            },
            "market_impact": f"La vente fera baisser le prix d'environ {boom.volatility_score * 100:.2f}%" if hasattr(boom, 'volatility_score') and boom.volatility_score else "Impact minimal"
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ SELL PRICE ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/buy", response_model=MarketTradeResponse)
async def market_buy(
    buy_request: MarketBuyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """🛒 Acheter un Boom sur le marché financier"""
    try:
        logger.info(f"🛒 MARKET BUY - User: {current_user.id}, Boom: {buy_request.boom_id}, Qty: {buy_request.quantity}")
        
        market_service = MarketService(db)
        
        # CORRECTION: Appel correct à la méthode async avec await
        result = await market_service.execute_buy(
            db=db,
            user_id=current_user.id,
            boom_id=buy_request.boom_id,
            quantity=buy_request.quantity
        )
        
        # Journaliser les frais collectés
        boom = db.query(BomAsset).filter(BomAsset.id == buy_request.boom_id).first()
        if boom and hasattr(boom, 'liquidity_pool'):
            logger.info(f"💸 FEES COLLECTED - Boom: {boom.title}, Amount: {boom.liquidity_pool}")
        
        # CORRECTION: Formater la réponse selon le nouveau schéma
        return MarketTradeResponse(
            success=True,
            message=result.get("message", "Achat réussi"),
            boom_id=buy_request.boom_id,
            quantity=buy_request.quantity,
            total_amount=float(result.get("financial", {}).get("amount", 0)),
            fees=float(result.get("financial", {}).get("fees", 0)),
            net_amount=float(result.get("financial", {}).get("amount", 0) - result.get("financial", {}).get("fees", 0)),
            new_balance=result.get("new_balance", 0.0),
            new_social_value=result.get("social_impact", {}).get("social_value_change", {}).get("new_value", 0.0),
            timestamp=datetime.fromisoformat(result.get("timestamp", datetime.now(timezone.utc).isoformat())),
            addiction={
                "phrase": random.choice([
                    "Investissement social réussi !",
                    "Boom acquis avec succès !",
                    "Votre collection s'enrichit !"
                ]),
                "level_change": "+1"
            },
            market_impact={
                "social_impact": "Valeur sociale augmentée",
                "holder_change": f"+{buy_request.quantity}",
                "volume_impact": f"+{result.get('financial', {}).get('amount', 0):.2f} FCFA"
            },
            boom=result.get("boom"),
            financial=result.get("financial")
        )
        
    except ValueError as e:
        logger.warning(f"⚠️ BUY VALIDATION ERROR: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ MARKET BUY ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail="Erreur lors de l'achat sur le marché")

@router.post("/sell", response_model=MarketTradeResponse)
async def market_sell(
    sell_request: MarketSellRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """📤 Vendre un Boom sur le marché financier"""
    try:
        logger.info(f"📤 MARKET SELL - User: {current_user.id}, UserBom: {sell_request.user_bom_id}")
        
        market_service = MarketService(db)
        
        # CORRECTION: Appel correct à la méthode async avec await
        result = await market_service.execute_sell(
            db=db,
            user_id=current_user.id,
            user_bom_id=sell_request.user_bom_id
        )
        
        # CORRECTION: Formater la réponse selon le nouveau schéma
        return MarketTradeResponse(
            success=True,
            message=result.get("message", "Vente réussie"),
            boom_id=result.get("boom", {}).get("id", 0),
            quantity=1,
            total_amount=float(result.get("financial", {}).get("amount", 0)),
            fees=float(result.get("financial", {}).get("fees", 0)),
            net_amount=float(result.get("financial", {}).get("profit_loss", 0)),
            new_balance=result.get("new_balance", 0.0),
            new_social_value=result.get("social_impact", {}).get("social_value_change", {}).get("new_value", 0.0),
            timestamp=datetime.fromisoformat(result.get("timestamp", datetime.now(timezone.utc).isoformat())),
            addiction={
                "phrase": random.choice([
                    "Vente réussie !",
                    "Parfait timing !",
                    "Tu maîtrises le marché !"
                ]),
                "level_change": "0"
            },
            market_impact={
                "social_impact": "Valeur sociale ajustée",
                "holder_change": "-1",
                "volume_impact": f"+{result.get('financial', {}).get('amount', 0):.2f} FCFA"
            },
            boom=result.get("boom"),
            financial=result.get("financial")
        )
        
    except ValueError as e:
        logger.warning(f"⚠️ SELL VALIDATION ERROR: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ MARKET SELL ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail="Erreur lors de la vente sur le marché")

@router.get("/trending")
async def get_trending_booms(
    limit: int = Query(10, ge=1, le=50, description="Nombre de Booms à retourner"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """📈 Obtenir les Booms tendance du moment"""
    try:
        logger.info(f"📈 TRENDING BOOMS - User: {current_user.id}, Limit: {limit}")
        
        booms = db.query(BomAsset).filter(
            BomAsset.is_active == True,
            BomAsset.is_tradable == True
        ).order_by(BomAsset.trade_count.desc()).limit(limit).all()
        
        trending = []
        for boom in booms:
            # Calculer le score de tendance
            volume_score = boom.total_volume_24h / 1000 if boom.total_volume_24h and boom.total_volume_24h > 0 else 0
            trade_score = boom.trade_count * 10 if boom.trade_count else 0
            event_score = 50 if hasattr(boom, 'active_event') and boom.active_event else 0
            volatility_score = float(boom.volatility_score * 1000) if hasattr(boom, 'volatility_score') and boom.volatility_score else 0
            
            trend_score = volume_score + trade_score + event_score + volatility_score
            
            # Calculer variation prix
            price_change = 0
            if hasattr(boom, 'base_price') and boom.base_price and boom.base_price > 0 and boom.current_price:
                price_change = ((boom.current_price - boom.base_price) / boom.base_price * 100)
            
            trending.append({
                "id": boom.id,
                "title": boom.title,
                "artist": boom.artist,
                "current_price": float(boom.current_price) if boom.current_price else 0.0,
                "price_change_24h": float(price_change),
                "volume_24h": float(boom.total_volume_24h) if boom.total_volume_24h else 0.0,
                "trade_count": boom.trade_count or 0,
                "trend_score": float(trend_score),
                "event": boom.active_event if hasattr(boom, 'active_event') else None,
                "preview_image": boom.preview_image if hasattr(boom, 'preview_image') else None
            })
        
        # Trier par score de tendance
        trending.sort(key=lambda x: x["trend_score"], reverse=True)
        
        return {
            "trending_booms": trending[:limit],
            "total_trending": len(trending),
            "market_status": get_market_status(db)
        }
        
    except Exception as e:
        logger.error(f"❌ TRENDING ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/events/active")
async def get_active_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """🎰 Obtenir la liste des événements actifs sur le marché"""
    try:
        logger.info(f"🎰 ACTIVE EVENTS - User: {current_user.id}")
        
        booms_with_events = db.query(BomAsset).filter(
            BomAsset.active_event.isnot(None),
            BomAsset.event_expires_at > datetime.now(timezone.utc)
        ).all()
        
        events = []
        for boom in booms_with_events:
            time_remaining = boom.event_expires_at - datetime.now(timezone.utc)
            minutes_left = int(time_remaining.total_seconds() / 60)
            
            events.append({
                "boom_id": boom.id,
                "boom_title": boom.title,
                "event_type": boom.active_event,
                "event_message": boom.event_message,
                "time_remaining_minutes": minutes_left,
                "current_price": float(boom.current_price) if boom.current_price else 0.0,
                "preview_image": boom.preview_image if hasattr(boom, 'preview_image') else None,
                "effect_description": get_event_description(boom.active_event)
            })
        
        return {
            "active_events": events,
            "total_active_events": len(events),
            "next_event_check_in": 300  # Vérifier dans 5 minutes
        }
        
    except Exception as e:
        logger.error(f"❌ ACTIVE EVENTS ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/events/trigger-test")
async def trigger_test_event(
    boom_id: int = Query(..., description="ID du Boom pour l'événement test"),
    event_type: str = Query("fomo_flash", description="Type d'événement à déclencher"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """🧪 Déclencher un événement de test (admin seulement)"""
    try:
        # Vérifier si admin (simplifié pour le moment)
        if not current_user.is_admin:
            raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs")
        
        boom = db.query(BomAsset).filter(BomAsset.id == boom_id).first()
        if not boom:
            raise HTTPException(status_code=404, detail="Boom non trouvé")
        
        # Définir l'événement de test
        test_events = {
            "fomo_flash": {
                "name": "fomo_flash",
                "message": "🚀 TEST FOMO FLASH! +15% pendant 10min!",
                "duration": 600,
                "effect": "+0.15"
            },
            "lucky_dip": {
                "name": "lucky_dip",
                "message": "🎰 TEST LUCKY DIP! -30% pendant 5min!",
                "duration": 300,
                "effect": "-0.30"
            },
            "whale_alert": {
                "name": "whale_alert",
                "message": "🐋 TEST WHALE ALERT! +10% pendant 15min!",
                "duration": 900,
                "effect": "+0.10"
            },
            "moon_shot": {
                "name": "moon_shot",
                "message": "🌙 TEST MOON SHOT! +25% pendant 20min!",
                "duration": 1200,
                "effect": "+0.25"
            }
        }
        
        if event_type not in test_events:
            raise HTTPException(status_code=400, detail=f"Type d'événement invalide. Choisissez parmi: {list(test_events.keys())}")
        
        event = test_events[event_type]
        boom.active_event = event["name"]
        boom.event_message = event["message"]
        boom.event_expires_at = datetime.now(timezone.utc) + timedelta(seconds=event["duration"])
        
        db.commit()
        
        logger.info(f"🧪 TEST EVENT TRIGGERED - Boom: {boom.title}, Event: {event_type}")
        
        return {
            "success": True,
            "message": f"Événement de test déclenché: {event_type}",
            "boom": boom.title,
            "event_details": event,
            "expires_at": boom.event_expires_at.isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ TEST EVENT ERROR: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
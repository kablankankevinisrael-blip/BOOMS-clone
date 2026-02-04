"""
💰 SCRIPT DE DEBUG TRÉSORERIE
📊 Trace tous les mouvements d'argent de la plateforme
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy import func
import inspect
import os

# ================= 🔧 CONFIG LOGGER =================

debug_logger = logging.getLogger("treasury_debug")
debug_logger.setLevel(logging.DEBUG)
debug_logger.propagate = False

# Nettoyage des handlers (évite doublons)
if debug_logger.handlers:
    debug_logger.handlers.clear()

# 📁 Dossier logs
BASE_DIR = os.path.dirname(__file__)
log_dir = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "logs"))
os.makedirs(log_dir, exist_ok=True)

# 📝 Formatter commun
formatter = logging.Formatter(
    "%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

# -------- 📁 FILE HANDLER (UTF-8 / ÉMOJIS OK) --------
file_handler = logging.FileHandler(
    os.path.join(log_dir, "treasury_trace.log"),
    encoding="utf-8"
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)
debug_logger.addHandler(file_handler)

# -------- 🖥️ CONSOLE HANDLER (SAFE WINDOWS) --------
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)
debug_logger.addHandler(console_handler)

# ================= 💰 TRÉSORERIE =================

def trace_treasury_movement(
    db: Session,
    operation: str,
    amount: Decimal,
    description: str = "",
    user_id: int | None = None
):
    """
    💰 Trace un mouvement de trésorerie
    """
    timestamp = datetime.now(timezone.utc)

    # 📍 Appelant
    caller = inspect.stack()[1]
    caller_info = (
        f"{os.path.basename(caller.filename)}:"
        f"{caller.lineno} - {caller.function}"
    )

    from app.models.admin_models import PlatformTreasury
    treasury = db.query(PlatformTreasury).first()
    old_balance = treasury.balance if treasury else Decimal("0.00")

    debug_logger.info("═" * 80)
    debug_logger.info("💰 MOUVEMENT TRÉSORERIE DÉTECTÉ")
    debug_logger.info(f"🧾 Opération     : {operation}")
    debug_logger.info(f"📄 Description   : {description}")
    debug_logger.info(f"💵 Montant       : {amount} FCFA")
    debug_logger.info(f"👤 User ID       : {user_id}")
    debug_logger.info(f"📉 Ancien solde  : {old_balance} FCFA")
    debug_logger.info(f"📍 Appelé depuis : {caller_info}")
    debug_logger.info(f"⏰ Timestamp     : {timestamp.isoformat()}")
    debug_logger.info("═" * 80)

    # 📊 CSV
    csv_path = os.path.join(log_dir, "treasury_movements.csv")
    is_new = not os.path.exists(csv_path)

    with open(csv_path, "a", encoding="utf-8") as f:
        if is_new:
            f.write(
                "timestamp,operation,amount,"
                "old_balance,user_id,description\n"
            )
        f.write(
            f"{timestamp.isoformat()},"
            f"{operation},{amount},{old_balance},"
            f"{user_id},{description}\n"
        )

# ================= 🧾 AUDIT =================

def audit_treasury_state(db: Session, context: str = "Audit"):
    """
    🧾 Audit global trésorerie + wallets
    """
    from app.models.admin_models import PlatformTreasury
    from app.models.user_models import Wallet

    timestamp = datetime.now(timezone.utc)

    treasury = db.query(PlatformTreasury).first()
    treasury_balance = treasury.balance if treasury else Decimal("0.00")

    total_wallets = (
        db.query(func.sum(Wallet.balance)).scalar()
        or Decimal("0.00")
    )

    users_with_wallet = db.query(Wallet).count()

    debug_logger.info("🔁" * 40)
    debug_logger.info(f"🧾 AUDIT TRÉSORERIE — {context}")
    debug_logger.info(f"⏰ Timestamp          : {timestamp.isoformat()}")
    debug_logger.info(f"🏦 Trésorerie         : {treasury_balance} FCFA")
    debug_logger.info(f"👛 Total wallets      : {total_wallets} FCFA")
    debug_logger.info(f"👥 Users avec wallet  : {users_with_wallet}")
    debug_logger.info(
        f"💰 Cash total système : "
        f"{treasury_balance + total_wallets} FCFA"
    )
    debug_logger.info("🔁" * 40)

# ================= 🛒 ACHAT BOOM =================

def trace_boom_purchase_decomposition(
    db: Session,
    user_id: int,
    boom_id: int,
    buy_price: Decimal,
    social_value: Decimal,
    quantity: int
):
    """
    🛒 Décomposition financière d’un achat BOOM
    """
    fees_unit = buy_price - social_value

    debug_logger.info("🧨" * 40)
    debug_logger.info("🛒 DÉCOMPOSITION ACHAT BOOM")
    debug_logger.info(f"👤 User ID           : {user_id}")
    debug_logger.info(f"📦 Boom ID           : {boom_id}")
    debug_logger.info(f"🔢 Quantité          : {quantity}")
    debug_logger.info(f"💵 Prix unitaire     : {buy_price} FCFA")
    debug_logger.info(f"🤝 Valeur sociale u. : {social_value} FCFA")
    debug_logger.info(f"💼 Frais unitaires   : {fees_unit} FCFA")
    debug_logger.info("   ---")
    debug_logger.info(f"💳 TOTAL payé        : {buy_price * quantity} FCFA")
    debug_logger.info(
        f"➡️  Valeur BOOMs     : {social_value * quantity} FCFA"
    )
    debug_logger.info(
        f"➡️  Frais plateforme : {fees_unit * quantity} FCFA"
    )

    total_calc = (social_value + fees_unit) * quantity
    debug_logger.info(
        f"🔍 VÉRIF: {buy_price * quantity} == {total_calc} ? "
        f"{'✅ OK' if buy_price * quantity == total_calc else '❌ NO'}"
    )
    debug_logger.info("🧨" * 40)

# ================= 🚀 SETUP =================

def setup_debug_mode():
    """
    🚀 Initialisation du mode debug trésorerie
    """
    debug_logger.info("🚀 DÉMARRAGE MODE DEBUG TRÉSORERIE")
    debug_logger.info(
        f"⏰ Timestamp : {datetime.now(timezone.utc).isoformat()}"
    )
    debug_logger.info(f"📁 Logs écrits dans : {log_dir}")

    csv_path = os.path.join(log_dir, "treasury_movements.csv")
    if os.path.exists(csv_path):
        debug_logger.info("📊 CSV existant détecté, ajout à la suite")
    else:
        with open(csv_path, "w", encoding="utf-8") as f:
            f.write(
                "timestamp,operation,amount,"
                "old_balance,user_id,description\n"
            )
        debug_logger.info("📊 CSV initialisé")

# Auto setup
setup_debug_mode()

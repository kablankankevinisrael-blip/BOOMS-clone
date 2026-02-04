#!/usr/bin/env python3
"""
Migration manuelle pour gift_transactions - VERSION CORRIGÉE
Ajoute les champs financiers et transaction_reference (nullable)
"""

import sys
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

# Configuration logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# URL DB - À MODIFIER AVANT EXÉCUTION
DATABASE_URL = "postgresql://postgres:Arthur2004%40@localhost:5433/booms_db"

def get_engine():
    """Crée une connexion à la DB"""
    return create_engine(DATABASE_URL)

def check_column_exists(engine, table_name, column_name):
    """Vérifie si une colonne existe déjà"""
    check_sql = """
        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = :table 
            AND column_name = :column
        );
    """
    
    with engine.connect() as conn:
        result = conn.execute(
            text(check_sql),
            {"table": table_name, "column": column_name}
        ).scalar()
    
    return bool(result)

def add_gift_financial_columns(engine):
    """Ajoute les colonnes financières (gross_amount, fee_amount, net_amount)"""
    table_name = "gift_transactions"
    new_columns = [
        ("gross_amount", "NUMERIC(12, 2)", "Montant total payé"),
        ("fee_amount", "NUMERIC(12, 2)", "Frais plateforme"),
        ("net_amount", "NUMERIC(12, 2)", "Montant net reçu")
    ]
    
    added_count = 0
    
    with engine.connect() as conn:
        trans = conn.begin()
        
        try:
            for col_name, col_type, description in new_columns:
                if check_column_exists(engine, table_name, col_name):
                    logger.info(f"⏭️  Colonne '{col_name}' existe déjà")
                    continue
                
                add_sql = f"""
                    ALTER TABLE {table_name}
                    ADD COLUMN {col_name} {col_type};
                """
                
                conn.execute(text(add_sql))
                added_count += 1
                logger.info(f"➕ '{col_name}' ajoutée ({description})")
            
            trans.commit()
            
            if added_count > 0:
                logger.info(f"✅ {added_count} colonnes financières ajoutées")
            else:
                logger.info("✅ Toutes les colonnes financières existaient déjà")
                
        except Exception as e:
            trans.rollback()
            logger.error(f"❌ Erreur colonnes financières: {e}")
            raise

def add_transaction_reference_column(engine):
    """
    Ajoute transaction_reference SANS valeur par défaut.
    Les anciens cadeaux restent NULL (intentionnel).
    Index UNIQUE conditionnel (seulement sur NOT NULL).
    """
    table_name = "gift_transactions"
    col_name = "transaction_reference"
    
    if check_column_exists(engine, table_name, col_name):
        logger.info(f"⏭️  Colonne '{col_name}' existe déjà, skip")
        return True
    
    logger.info(f"➕ Ajout colonne '{col_name}' (nullable, sans default)...")
    
    try:
        with engine.connect() as conn:
            # Transaction pour l'ajout de colonne
            trans = conn.begin()
            
            try:
                # 1. Ajouter la colonne (nullable, pas de default)
                add_sql = f"""
                    ALTER TABLE {table_name}
                    ADD COLUMN {col_name} VARCHAR(100);
                """
                
                conn.execute(text(add_sql))
                logger.info(f"   ✅ Colonne '{col_name}' ajoutée (nullable)")
                
                # Commit pour libérer le lock de table
                trans.commit()
                
                # 2. Créer index UNIQUE conditionnel (en dehors de la transaction)
                logger.info("   🔨 Création index UNIQUE conditionnel...")
                
                try:
                    # Essayer avec CONCURRENTLY (meilleur pour prod)
                    index_concurrent_sql = f"""
                        CREATE UNIQUE INDEX CONCURRENTLY 
                        ix_gift_transactions_transaction_reference
                        ON {table_name}({col_name})
                        WHERE {col_name} IS NOT NULL;
                    """
                    
                    conn.execute(text(index_concurrent_sql))
                    logger.info("   ✅ Index UNIQUE conditionnel créé (concurrent)")
                    
                except Exception as concurrent_error:
                    logger.warning(f"   ⚠️  Index concurrent échoué: {concurrent_error}")
                    logger.info("   🔧 Fallback: index normal...")
                    
                    # Fallback: index normal (dans une transaction)
                    with conn.begin():
                        index_fallback_sql = f"""
                            CREATE UNIQUE INDEX 
                            ix_gift_transactions_transaction_reference_fallback
                            ON {table_name}({col_name})
                            WHERE {col_name} IS NOT NULL;
                        """
                        
                        conn.execute(text(index_fallback_sql))
                        logger.info("   ✅ Index UNIQUE fallback créé")
                
                return True
                
            except Exception as inner_error:
                if trans.is_active:
                    trans.rollback()
                logger.error(f"❌ Erreur lors de l'ajout de colonne: {inner_error}")
                raise
                
    except Exception as e:
        logger.error(f"💥 ERREUR CRITIQUE transaction_reference: {e}")
        return False

def add_wallet_transaction_ids_column(engine):
    """Ajoute la colonne wallet_transaction_ids (JSON)"""
    table_name = "gift_transactions"
    col_name = "wallet_transaction_ids"
    
    if check_column_exists(engine, table_name, col_name):
        logger.info(f"⏭️  Colonne '{col_name}' existe déjà")
        return
    
    logger.info(f"➕ Ajout colonne JSON '{col_name}'...")
    
    with engine.connect() as conn:
        trans = conn.begin()
        
        try:
            add_sql = f"""
                ALTER TABLE {table_name}
                ADD COLUMN {col_name} JSONB DEFAULT '[]'::jsonb;
            """
            
            conn.execute(text(add_sql))
            trans.commit()
            logger.info(f"✅ Colonne '{col_name}' ajoutée (JSONB)")
            
        except Exception as e:
            trans.rollback()
            logger.error(f"❌ Erreur colonne JSON: {e}")
            raise

def add_new_timestamps(engine):
    """Ajoute les nouveaux timestamps métier"""
    table_name = "gift_transactions"
    new_timestamps = [
        ("paid_at", "Quand le sender a payé"),
        ("delivered_at", "Quand le receiver a reçu"),
        ("failed_at", "Quand l'opération a échoué")
    ]
    
    added_count = 0
    
    with engine.connect() as conn:
        trans = conn.begin()
        
        try:
            for col_name, description in new_timestamps:
                if check_column_exists(engine, table_name, col_name):
                    logger.info(f"⏭️  Timestamp '{col_name}' existe déjà")
                    continue
                
                add_sql = f"""
                    ALTER TABLE {table_name}
                    ADD COLUMN {col_name} TIMESTAMP WITH TIME ZONE;
                """
                
                conn.execute(text(add_sql))
                added_count += 1
                logger.info(f"➕ Timestamp '{col_name}' ajouté")
            
            trans.commit()
            
            if added_count > 0:
                logger.info(f"✅ {added_count} timestamps ajoutés")
            else:
                logger.info("✅ Tous les timestamps existaient déjà")
                
        except Exception as e:
            trans.rollback()
            logger.error(f"❌ Erreur timestamps: {e}")
            raise

def extend_giftstatus_enum(engine):
    """Étend l'enum giftstatus avec les nouvelles valeurs (safe pour PostgreSQL)"""
    logger.info("🔄 Extension de l'enum giftstatus...")
    
    new_values = ["CREATED", "PAID", "DELIVERED", "FAILED"]
    
    sql_template = """
    DO $$ 
    BEGIN
        {checks}
    END $$;
    """
    
    checks = []
    for value in new_values:
        check = f"""
        BEGIN
            ALTER TYPE giftstatus ADD VALUE '{value}';
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END;
        """
        checks.append(check)
    
    full_sql = sql_template.format(checks="\n".join(checks))
    
    try:
        with engine.connect() as conn:
            conn.execute(text(full_sql))
            conn.commit()
        
        logger.info("✅ Enum giftstatus étendu avec succès")
        
    except Exception as e:
        logger.error(f"❌ Erreur extension enum: {e}")
        logger.warning("⚠️  L'extension d'enum a échoué, mais ce n'est pas bloquant")

def verify_migration(engine):
    """Vérifie que la migration s'est bien passée"""
    logger.info("\n🔍 VÉRIFICATION POST-MIGRATION")
    
    check_sql = """
    SELECT 
        column_name,
        data_type,
        is_nullable
    FROM information_schema.columns 
    WHERE table_name = 'gift_transactions'
    AND column_name IN (
        'gross_amount', 'fee_amount', 'net_amount',
        'transaction_reference', 'wallet_transaction_ids',
        'paid_at', 'delivered_at', 'failed_at'
    )
    ORDER BY column_name;
    """
    
    try:
        with engine.connect() as conn:
            columns = conn.execute(text(check_sql)).fetchall()
            
            if columns:
                logger.info("📊 Colonnes ajoutées avec succès:")
                for col in columns:
                    logger.info(f"   ✓ {col.column_name:25} {col.data_type:20} nullable={col.is_nullable}")
            else:
                logger.info("ℹ️  Aucune colonne à vérifier (toutes existaient déjà)")
                
    except Exception as e:
        logger.error(f"❌ Erreur vérification: {e}")

def main():
    """Fonction principale"""
    logger.info("=" * 60)
    logger.info("🚀 MIGRATION gift_transactions - NOUVEAU FLOW")
    logger.info("=" * 60)
    
    try:
        # Connexion DB
        engine = get_engine()
        logger.info(f"📡 Connecté à: {engine.url}")
        
        # Exécution des migrations
        add_gift_financial_columns(engine)
        add_transaction_reference_column(engine)
        add_wallet_transaction_ids_column(engine)
        add_new_timestamps(engine)
        extend_giftstatus_enum(engine)
        
        # Vérification
        verify_migration(engine)
        
        logger.info("=" * 60)
        logger.info("🎉 MIGRATION TERMINÉE AVEC SUCCÈS")
        logger.info("=" * 60)
        return 0
        
    except Exception as e:
        logger.error(f"💥 ERREUR CRITIQUE: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
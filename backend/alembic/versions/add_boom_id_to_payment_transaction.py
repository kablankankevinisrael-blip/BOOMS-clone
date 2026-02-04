"""Add boom_id to PaymentTransaction

Revision ID: add_boom_id_payment
Revises: ca6bb67fec33
Create Date: 2026-02-02 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_boom_id_payment'
down_revision: Union[str, None] = 'ca6bb67fec33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Ajouter la colonne boom_id à payment_transactions
    op.add_column('payment_transactions', sa.Column('boom_id', sa.Integer(), nullable=True))
    
    # Créer la foreign key vers bom_assets
    op.create_foreign_key('fk_payment_transactions_boom_id', 'payment_transactions', 'bom_assets',
                          ['boom_id'], ['id'])
    
    # Créer l'index
    op.create_index(op.f('ix_payment_transactions_boom_id'), 'payment_transactions', ['boom_id'], unique=False)


def downgrade() -> None:
    # Supprimer l'index
    op.drop_index(op.f('ix_payment_transactions_boom_id'), table_name='payment_transactions')
    
    # Supprimer la foreign key
    op.drop_constraint('fk_payment_transactions_boom_id', 'payment_transactions', type_='foreignkey')
    
    # Supprimer la colonne
    op.drop_column('payment_transactions', 'boom_id')

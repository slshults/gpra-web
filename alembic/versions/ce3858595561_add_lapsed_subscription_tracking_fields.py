"""Add lapsed subscription tracking fields

Revision ID: ce3858595561
Revises: 3313a94b983c
Create Date: 2025-11-01 17:35:11.261161

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ce3858595561'
down_revision: Union[str, Sequence[str], None] = '3313a94b983c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add lapsed subscription tracking columns to subscriptions table."""
    op.add_column('subscriptions', sa.Column('lapse_date', sa.DateTime(timezone=True), nullable=True))
    op.add_column('subscriptions', sa.Column('unplugged_mode', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('subscriptions', sa.Column('data_deletion_date', sa.DateTime(timezone=True), nullable=True))
    op.add_column('subscriptions', sa.Column('last_active_routine_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Remove lapsed subscription tracking columns from subscriptions table."""
    op.drop_column('subscriptions', 'last_active_routine_id')
    op.drop_column('subscriptions', 'data_deletion_date')
    op.drop_column('subscriptions', 'unplugged_mode')
    op.drop_column('subscriptions', 'lapse_date')

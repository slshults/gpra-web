"""Add account deletion tracking fields

Revision ID: e7f8g9h0i1j2
Revises: c669ca4bf473
Create Date: 2025-11-18 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7f8g9h0i1j2'
down_revision: Union[str, Sequence[str], None] = 'c669ca4bf473'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add account deletion tracking columns to subscriptions table."""
    op.add_column('subscriptions', sa.Column('deletion_scheduled_for', sa.DateTime(timezone=True), nullable=True))
    op.add_column('subscriptions', sa.Column('deletion_type', sa.String(20), nullable=True))
    op.add_column('subscriptions', sa.Column('prorated_refund_amount', sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    """Remove account deletion tracking columns from subscriptions table."""
    op.drop_column('subscriptions', 'prorated_refund_amount')
    op.drop_column('subscriptions', 'deletion_type')
    op.drop_column('subscriptions', 'deletion_scheduled_for')

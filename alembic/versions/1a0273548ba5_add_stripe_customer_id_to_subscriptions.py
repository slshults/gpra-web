"""add_stripe_customer_id_to_subscriptions

Revision ID: 1a0273548ba5
Revises: 48554409b67f
Create Date: 2025-10-30 23:42:13.485648

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1a0273548ba5'
down_revision: Union[str, Sequence[str], None] = '48554409b67f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add stripe_customer_id column to subscriptions table."""
    # Add nullable String column for Stripe Customer ID (cus_xxx format)
    op.add_column('subscriptions', sa.Column('stripe_customer_id', sa.String(length=255), nullable=True))

    # Add unique constraint for stripe_customer_id
    op.create_unique_constraint('uq_subscriptions_stripe_customer_id', 'subscriptions', ['stripe_customer_id'])


def downgrade() -> None:
    """Remove stripe_customer_id column from subscriptions table."""
    op.drop_constraint('uq_subscriptions_stripe_customer_id', 'subscriptions', type_='unique')
    op.drop_column('subscriptions', 'stripe_customer_id')

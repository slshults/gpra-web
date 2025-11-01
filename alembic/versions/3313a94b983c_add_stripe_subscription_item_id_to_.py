"""Add stripe_subscription_item_id to Subscription

Revision ID: 3313a94b983c
Revises: 1a0273548ba5
Create Date: 2025-11-01 14:40:25.450167

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3313a94b983c'
down_revision: Union[str, Sequence[str], None] = '1a0273548ba5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema - add stripe_subscription_item_id column to subscriptions table."""
    # Add the new column to track Stripe subscription item ID for updates
    op.add_column('subscriptions', sa.Column('stripe_subscription_item_id', sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema - remove stripe_subscription_item_id column from subscriptions table."""
    # Remove the column
    op.drop_column('subscriptions', 'stripe_subscription_item_id')
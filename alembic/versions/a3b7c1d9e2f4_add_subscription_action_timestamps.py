"""add_subscription_action_timestamps

Revision ID: a3b7c1d9e2f4
Revises: f1a2b3c4d5e6
Create Date: 2026-08-09 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3b7c1d9e2f4'  # pragma: allowlist secret
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add rate-limit timestamps for pause and deletion actions to subscriptions.

    NOTE: Uses IF NOT EXISTS for idempotency. Both columns were added to
    production out-of-band alongside app/models.py on 2025-11-23, and unlike
    the other out-of-band columns on this table they had no coverage anywhere
    — no alembic revision and no migrations/*.sql. This backfills the
    migration history rather than the schema.
    """
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_pause_action TIMESTAMP WITH TIME ZONE;")
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_deletion_action TIMESTAMP WITH TIME ZONE;")


def downgrade() -> None:
    """Remove pause and deletion action timestamps from subscriptions."""
    op.drop_column('subscriptions', 'last_deletion_action')
    op.drop_column('subscriptions', 'last_pause_action')

"""backfill_out_of_band_columns

Revision ID: b8e4f2a6c013
Revises: a3b7c1d9e2f4
Create Date: 2026-08-09 14:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8e4f2a6c013'  # pragma: allowlist secret
down_revision: Union[str, Sequence[str], None] = 'a3b7c1d9e2f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Bring the last seven out-of-band columns under alembic.

    These exist in production but were created only by raw files in
    migrations/ — add_autocreate_rate_limits.sql, add_complimentary_accounts.sql
    and add_first_item_guidance.sql — so a database rebuilt from migration
    history alone was missing them. This backfills the history; on any existing
    database every statement is a no-op.

    The two partial indexes from add_autocreate_rate_limits.sql are included
    because they affect query plans. The COMMENT ON COLUMN statements are not —
    they are inert documentation and the raw files remain in the repo.
    """
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS autocreate_calls_today INTEGER NOT NULL DEFAULT 0;")
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS autocreate_calls_this_hour INTEGER NOT NULL DEFAULT 0;")
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS autocreate_daily_reset_at TIMESTAMP WITH TIME ZONE;")
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS autocreate_hourly_reset_at TIMESTAMP WITH TIME ZONE;")
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS is_complimentary BOOLEAN NOT NULL DEFAULT FALSE;")
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS complimentary_reason VARCHAR(255);")

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_subscriptions_autocreate_daily_reset
            ON subscriptions(autocreate_daily_reset_at)
            WHERE autocreate_daily_reset_at IS NOT NULL;
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_subscriptions_autocreate_hourly_reset
            ON subscriptions(autocreate_hourly_reset_at)
            WHERE autocreate_hourly_reset_at IS NOT NULL;
    """)

    # add_first_item_guidance.sql also ran a one-time
    # `UPDATE user_preferences SET first_item_guidance_shown = TRUE` so existing
    # users wouldn't be shown guidance meant for new ones. That backfill is
    # deliberately NOT replicated here: re-running it against a populated
    # database would suppress the guidance for genuinely new users who have not
    # seen it yet. On a fresh rebuild there are no rows for it to affect.
    op.execute("ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS first_item_guidance_shown BOOLEAN NOT NULL DEFAULT FALSE;")


def downgrade() -> None:
    """Remove the backfilled columns and their indexes."""
    op.execute("DROP INDEX IF EXISTS idx_subscriptions_autocreate_hourly_reset;")
    op.execute("DROP INDEX IF EXISTS idx_subscriptions_autocreate_daily_reset;")
    op.drop_column('user_preferences', 'first_item_guidance_shown')
    op.drop_column('subscriptions', 'complimentary_reason')
    op.drop_column('subscriptions', 'is_complimentary')
    op.drop_column('subscriptions', 'autocreate_hourly_reset_at')
    op.drop_column('subscriptions', 'autocreate_daily_reset_at')
    op.drop_column('subscriptions', 'autocreate_calls_this_hour')
    op.drop_column('subscriptions', 'autocreate_calls_today')

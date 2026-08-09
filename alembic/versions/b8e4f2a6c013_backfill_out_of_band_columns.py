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
    """Fold three raw migrations/*.sql files into alembic history.

    These seven columns exist in production but were created only by
    add_autocreate_rate_limits.sql, add_complimentary_accounts.sql and
    add_first_item_guidance.sql — an undocumented rebuild step that is easy to
    skip. Bringing them under alembic means the version history describes them.

    This does NOT make the schema rebuildable from alembic alone, and nothing
    here should be read as claiming it does: no revision creates the
    `user_preferences` table (only migrations/add_user_preferences.sql does),
    so an alembic-only run against an empty database still fails earlier, at
    d4e5f6a7b8c9. The real build order is schema.sql -> Flask-AppBuilder
    (ab_user) -> migrations/*.sql -> alembic upgrade head.

    Every statement is idempotent, so this is a no-op on any existing database.
    Column comments are ported from the raw files so those files can eventually
    be deleted rather than living on as the reference copy.
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
    # `UPDATE user_preferences SET first_item_guidance_shown = TRUE`. Not
    # replicated here: the rebuild this repairs starts with zero rows, so there
    # is nothing for it to mark. (That backfill was always partial anyway —
    # user_preferences rows only exist for users who did something, and users
    # without a row already fall through to shown=False at routes_v2.py:2806.)
    op.execute("ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS first_item_guidance_shown BOOLEAN NOT NULL DEFAULT FALSE;")

    op.execute("COMMENT ON COLUMN subscriptions.autocreate_calls_today IS 'Count of autocreate API calls made today (resets at midnight UTC)';")
    op.execute("COMMENT ON COLUMN subscriptions.autocreate_calls_this_hour IS 'Count of autocreate API calls made this hour (resets every hour)';")
    op.execute("COMMENT ON COLUMN subscriptions.autocreate_daily_reset_at IS 'Timestamp of next daily counter reset (midnight UTC)';")
    op.execute("COMMENT ON COLUMN subscriptions.autocreate_hourly_reset_at IS 'Timestamp of next hourly counter reset';")
    op.execute("COMMENT ON COLUMN subscriptions.is_complimentary IS 'True for free-forever accounts (beta testers, friends, contributors)';")
    op.execute("COMMENT ON COLUMN subscriptions.complimentary_reason IS 'Reason for complimentary access (e.g., \"Beta tester\", \"Friend\", \"Contributor\")';")


def downgrade() -> None:
    """Deliberately a no-op.

    upgrade() creates nothing on any database that predates this revision — all
    seven columns already existed, created out-of-band by migrations/*.sql. A
    literal inverse would therefore drop columns this revision never created,
    destroying data it never wrote: `is_complimentary` and
    `complimentary_reason` carry live entitlement state, and losing them
    silently demotes free-forever accounts to their nominal `tier` via
    get_tier_limits() (app/subscription_tiers.py:96) with no error and no log.

    That matters because README_MIGRATIONS.md step 5 prescribes
    `alembic downgrade -1 && alembic upgrade head` as a routine test. Downgrading
    past this revision rewinds the stamp only.
    """
    pass

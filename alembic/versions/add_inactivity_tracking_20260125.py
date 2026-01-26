"""Add inactivity tracking columns to subscriptions table

Revision ID: add_inactivity_tracking_20260125
Revises: add_rate_limiting_20251122230447
Create Date: 2026-01-25

Adds columns for 90-day inactivity email feature:
- last_activity: tracks when user last had activity (page view)
- last_inactivity_email_sent: when we last sent an inactivity email
- inactivity_emails_opted_out: user opted out of these emails
- stripe_period_end: cached billing period end from Stripe
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_inactivity_tracking_20260125'
down_revision = 'e7f8g9h0i1j2'
branch_labels = None
depends_on = None


def upgrade():
    """Add inactivity email tracking columns to subscriptions table.

    Uses IF NOT EXISTS for idempotency (columns may have been added manually).
    """
    # last_activity - tracks when user last had activity (page view)
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP WITH TIME ZONE;")

    # last_inactivity_email_sent - when we last sent an inactivity email
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_inactivity_email_sent TIMESTAMP WITH TIME ZONE;")

    # inactivity_emails_opted_out - user opted out of these emails
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS inactivity_emails_opted_out BOOLEAN NOT NULL DEFAULT FALSE;")

    # stripe_period_end - cached billing period end from Stripe
    op.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_period_end TIMESTAMP WITH TIME ZONE;")

    # Add index on last_activity for efficient querying of inactive users
    op.execute("CREATE INDEX IF NOT EXISTS idx_subscriptions_last_activity ON subscriptions(last_activity);")


def downgrade():
    """Remove inactivity email tracking columns from subscriptions table."""
    op.execute("DROP INDEX IF EXISTS idx_subscriptions_last_activity;")
    op.execute("ALTER TABLE subscriptions DROP COLUMN IF EXISTS stripe_period_end;")
    op.execute("ALTER TABLE subscriptions DROP COLUMN IF EXISTS inactivity_emails_opted_out;")
    op.execute("ALTER TABLE subscriptions DROP COLUMN IF EXISTS last_inactivity_email_sent;")
    op.execute("ALTER TABLE subscriptions DROP COLUMN IF EXISTS last_activity;")

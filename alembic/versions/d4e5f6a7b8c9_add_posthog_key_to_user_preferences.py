"""add_posthog_key_to_user_preferences

Revision ID: d4e5f6a7b8c9
Revises: ce3858595561
Create Date: 2025-11-16 15:47:15.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'ce3858595561'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add PostHog project key fields to user_preferences table."""
    # Add nullable String column for PostHog project API key (starts with phc_)
    # No encryption needed - these keys are designed to be public-facing
    op.add_column('user_preferences', sa.Column('posthog_project_key', sa.String(length=255), nullable=True))

    # Add timestamp for tracking when key was last updated
    op.add_column('user_preferences', sa.Column('posthog_key_updated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Remove PostHog project key fields from user_preferences table."""
    op.drop_column('user_preferences', 'posthog_key_updated_at')
    op.drop_column('user_preferences', 'posthog_project_key')

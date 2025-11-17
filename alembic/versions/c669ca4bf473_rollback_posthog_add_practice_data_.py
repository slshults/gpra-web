"""rollback_posthog_add_practice_data_download

Revision ID: c669ca4bf473
Revises: d4e5f6a7b8c9
Create Date: 2025-11-16 17:46:55.215572

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c669ca4bf473'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Rollback PostHog dual tracking feature and add practice data download feature.

    1. Remove PostHog fields from user_preferences
    2. Add practice data download fields to user_preferences
    3. Create practice_events table with auto-cleanup trigger
    """
    # Step 1: Remove PostHog fields from user_preferences
    op.drop_column('user_preferences', 'posthog_project_key')
    op.drop_column('user_preferences', 'posthog_key_updated_at')

    # Step 2: Add practice data download fields to user_preferences
    op.add_column('user_preferences', sa.Column('last_data_download_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('user_preferences', sa.Column('data_expiration_reminder_dismissed_until', sa.DateTime(timezone=True), nullable=True))

    # Step 3: Create practice_events table
    op.create_table(
        'practice_events',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(50), nullable=False),
        sa.Column('item_name', sa.String(255), nullable=True),
        sa.Column('routine_name', sa.String(255), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('additional_data', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
    )

    # Create indexes
    op.create_index('idx_practice_events_user_id', 'practice_events', ['user_id'])
    op.create_index('idx_practice_events_created_at', 'practice_events', ['created_at'])

    # Step 4: Create cleanup trigger function and trigger
    op.execute("""
        CREATE OR REPLACE FUNCTION cleanup_old_practice_events()
        RETURNS TRIGGER AS $$
        BEGIN
            DELETE FROM practice_events
            WHERE created_at < NOW() - INTERVAL '90 days';
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER trigger_cleanup_old_practice_events
        AFTER INSERT ON practice_events
        EXECUTE FUNCTION cleanup_old_practice_events();
    """)


def downgrade() -> None:
    """
    Rollback to PostHog dual tracking feature.
    """
    # Drop trigger and function
    op.execute("DROP TRIGGER IF EXISTS trigger_cleanup_old_practice_events ON practice_events;")
    op.execute("DROP FUNCTION IF EXISTS cleanup_old_practice_events();")

    # Drop indexes
    op.drop_index('idx_practice_events_created_at', 'practice_events')
    op.drop_index('idx_practice_events_user_id', 'practice_events')

    # Drop practice_events table
    op.drop_table('practice_events')

    # Remove practice data download fields from user_preferences
    op.drop_column('user_preferences', 'data_expiration_reminder_dismissed_until')
    op.drop_column('user_preferences', 'last_data_download_at')

    # Restore PostHog fields to user_preferences
    op.add_column('user_preferences', sa.Column('posthog_project_key', sa.String(255), nullable=True))
    op.add_column('user_preferences', sa.Column('posthog_key_updated_at', sa.DateTime(timezone=True), nullable=True))

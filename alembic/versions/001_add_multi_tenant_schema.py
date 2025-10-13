"""add multi-tenant schema

Revision ID: 001
Revises:
Create Date: 2025-10-13 00:05:00.000000

This migration adds multi-tenant support to the Guitar Practice Routine App:
1. Creates subscriptions table for Stripe integration
2. Adds user_id columns to items, routines, chord_charts tables (nullable for existing data)
3. Adds tracking columns (created_via, generation_method) for PostHog analytics
4. Creates all necessary indexes and foreign key constraints

IMPORTANT: user_id columns are nullable to accommodate existing data.
After this migration, a data migration should be run to assign existing data to users.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    """
    Apply the multi-tenant schema changes.

    Note: This migration is safe to run on existing databases with data.
    All user_id columns are nullable, allowing existing records to remain valid.
    """

    # =====================================================================
    # 1. CREATE SUBSCRIPTIONS TABLE
    # =====================================================================
    print("Creating subscriptions table...")
    op.create_table(
        'subscriptions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('stripe_subscription_id', sa.String(255), nullable=True),
        sa.Column('stripe_price_id', sa.String(255), nullable=True),
        sa.Column('tier', sa.String(50), nullable=False, server_default='free'),
        sa.Column('status', sa.String(50), nullable=False, server_default='active'),
        sa.Column('mrr', sa.Numeric(10, 2), nullable=False, server_default='0.00'),
        sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=True),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['ab_user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes on subscriptions table
    print("Creating subscriptions indexes...")
    op.create_index('idx_subscriptions_user_id', 'subscriptions', ['user_id'])
    op.create_index('idx_subscriptions_status', 'subscriptions', ['status'])
    op.create_index('idx_subscriptions_tier', 'subscriptions', ['tier'])

    # Unique constraint on Stripe subscription ID (but nullable for free tier)
    op.create_unique_constraint('uq_stripe_subscription_id', 'subscriptions', ['stripe_subscription_id'])

    # =====================================================================
    # 2. ADD USER_ID TO ITEMS TABLE
    # =====================================================================
    print("Adding user_id to items table...")
    # Check if column already exists (in case migration is re-run)
    conn = op.get_bind()
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='items' AND column_name='user_id'
    """))
    if not result.fetchone():
        op.add_column('items', sa.Column('user_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_items_user_id', 'items', 'ab_user', ['user_id'], ['id'], ondelete='CASCADE')
        op.create_index('idx_items_user_id', 'items', ['user_id'])

    # Add created_via column for PostHog tracking
    print("Adding created_via to items table...")
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='items' AND column_name='created_via'
    """))
    if not result.fetchone():
        op.add_column('items', sa.Column('created_via', sa.String(50), nullable=False, server_default='manual'))

    # =====================================================================
    # 3. ADD USER_ID TO ROUTINES TABLE
    # =====================================================================
    print("Adding user_id to routines table...")
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='routines' AND column_name='user_id'
    """))
    if not result.fetchone():
        op.add_column('routines', sa.Column('user_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_routines_user_id', 'routines', 'ab_user', ['user_id'], ['id'], ondelete='CASCADE')
        op.create_index('idx_routines_user_id', 'routines', ['user_id'])

    # =====================================================================
    # 4. ADD USER_ID TO CHORD_CHARTS TABLE
    # =====================================================================
    print("Adding user_id to chord_charts table...")
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='chord_charts' AND column_name='user_id'
    """))
    if not result.fetchone():
        op.add_column('chord_charts', sa.Column('user_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_chord_charts_user_id', 'chord_charts', 'ab_user', ['user_id'], ['id'], ondelete='CASCADE')
        op.create_index('idx_chord_charts_user_id', 'chord_charts', ['user_id'])

    # Add generation_method column for PostHog tracking
    print("Adding generation_method to chord_charts table...")
    result = conn.execute(sa.text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name='chord_charts' AND column_name='generation_method'
    """))
    if not result.fetchone():
        op.add_column('chord_charts', sa.Column('generation_method', sa.String(50), nullable=True))

    print("✓ Multi-tenant schema migration completed successfully!")
    print("")
    print("NEXT STEPS:")
    print("1. Run a data migration to assign existing data to users")
    print("2. Consider making user_id NOT NULL after data migration")
    print("3. Enable Row-Level Security (RLS) policies in PostgreSQL")


def downgrade():
    """
    Revert the multi-tenant schema changes.

    WARNING: This will drop all subscription data and remove user associations.
    Only use this in development environments.
    """
    print("Reverting multi-tenant schema changes...")

    # Drop in reverse order to handle dependencies

    # Remove chord_charts columns
    print("Removing chord_charts multi-tenant columns...")
    op.drop_column('chord_charts', 'generation_method')
    op.drop_index('idx_chord_charts_user_id', 'chord_charts')
    op.drop_constraint('fk_chord_charts_user_id', 'chord_charts', type_='foreignkey')
    op.drop_column('chord_charts', 'user_id')

    # Remove routines columns
    print("Removing routines multi-tenant columns...")
    op.drop_index('idx_routines_user_id', 'routines')
    op.drop_constraint('fk_routines_user_id', 'routines', type_='foreignkey')
    op.drop_column('routines', 'user_id')

    # Remove items columns
    print("Removing items multi-tenant columns...")
    op.drop_column('items', 'created_via')
    op.drop_index('idx_items_user_id', 'items')
    op.drop_constraint('fk_items_user_id', 'items', type_='foreignkey')
    op.drop_column('items', 'user_id')

    # Drop subscriptions table and its indexes
    print("Dropping subscriptions table...")
    op.drop_index('idx_subscriptions_tier', 'subscriptions')
    op.drop_index('idx_subscriptions_status', 'subscriptions')
    op.drop_index('idx_subscriptions_user_id', 'subscriptions')
    op.drop_table('subscriptions')

    print("✓ Multi-tenant schema rollback completed")

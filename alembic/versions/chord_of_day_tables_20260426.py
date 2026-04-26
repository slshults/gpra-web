"""Create chord_pool and posted_chords tables for Chord of the Day

Revision ID: chord_of_day_tables_20260426
Revises: add_inactivity_tracking_20260125
Create Date: 2026-04-26

Adds two tables for the Chord of the Day automated social posting feature:

- chord_pool: curated list of chords eligible for daily posting. Optionally
  linked to a specific common_chords row (common_chord_id) so the post URL
  can deep-link to one voicing via ?id=N. If common_chord_id is NULL, the
  formatter falls back to ?chord=NAME (search-style URL).

- posted_chords: audit trail of posts. cycle_id increments when the pool
  exhausts (no row mutation on chord_pool). Per-day uniqueness and
  no-repeat-until-exhausted are enforced by the selector at query time.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'chord_of_day_tables_20260426'
down_revision = 'add_inactivity_tracking_20260125'
branch_labels = None
depends_on = None


def upgrade():
    """Create chord_pool and posted_chords tables."""
    # NOTE: common_chord_id has no FK constraint because common_chords.id lacks
    # a PK/UNIQUE constraint in the live DB (legacy seeded table). Referential
    # integrity is enforced at the application layer; this matches the existing
    # pattern for ab_user references (see comment in app/models.py).
    op.execute("""
        CREATE TABLE IF NOT EXISTS chord_pool (
            id SERIAL PRIMARY KEY,
            chord_name TEXT NOT NULL,
            common_chord_id INTEGER,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_chord_pool_display_order
        ON chord_pool(display_order, id);
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS posted_chords (
            id SERIAL PRIMARY KEY,
            chord_pool_id INTEGER NOT NULL REFERENCES chord_pool(id) ON DELETE CASCADE,
            posted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            status TEXT NOT NULL CHECK (status IN ('posted', 'partial', 'failed')),
            bluesky_uri TEXT,
            facebook_post_id TEXT,
            error TEXT,
            cycle_id INTEGER NOT NULL DEFAULT 1
        );
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_posted_chords_chord_pool_id
        ON posted_chords(chord_pool_id);
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_posted_chords_posted_at
        ON posted_chords(posted_at);
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_posted_chords_status_cycle
        ON posted_chords(status, cycle_id);
    """)


def downgrade():
    """Drop posted_chords and chord_pool tables (posted_chords first due to FK)."""
    op.execute("DROP INDEX IF EXISTS idx_posted_chords_status_cycle;")
    op.execute("DROP INDEX IF EXISTS idx_posted_chords_posted_at;")
    op.execute("DROP INDEX IF EXISTS idx_posted_chords_chord_pool_id;")
    op.execute("DROP TABLE IF EXISTS posted_chords;")
    op.execute("DROP INDEX IF EXISTS idx_chord_pool_display_order;")
    op.execute("DROP TABLE IF EXISTS chord_pool;")

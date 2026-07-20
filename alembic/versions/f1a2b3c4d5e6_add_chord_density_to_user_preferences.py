"""add_chord_density_to_user_preferences

Revision ID: f1a2b3c4d5e6
Revises: seed_chord_pool_20260426
Create Date: 2026-07-19 18:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'  # pragma: allowlist secret
down_revision: Union[str, Sequence[str], None] = 'seed_chord_pool_20260426'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add mobile chord-density preference (3 or 4 charts across, default 4)."""
    op.add_column(
        'user_preferences',
        sa.Column('chord_density', sa.SmallInteger(), nullable=False, server_default='4'),
    )


def downgrade() -> None:
    """Remove chord-density preference."""
    op.drop_column('user_preferences', 'chord_density')

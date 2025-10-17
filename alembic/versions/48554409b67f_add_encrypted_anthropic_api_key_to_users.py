"""add_encrypted_anthropic_api_key_to_users

Revision ID: 48554409b67f
Revises: 002
Create Date: 2025-10-16 21:33:49.442662

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '48554409b67f'
down_revision: Union[str, Sequence[str], None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add encrypted_anthropic_api_key column to ab_user table."""
    # Add nullable LargeBinary column for encrypted API key storage
    # We'll use cryptography.fernet for symmetric encryption
    op.add_column('ab_user', sa.Column('encrypted_anthropic_api_key', sa.LargeBinary(), nullable=True))

    # Add timestamp for tracking when key was last updated
    op.add_column('ab_user', sa.Column('api_key_updated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Remove encrypted_anthropic_api_key column from ab_user table."""
    op.drop_column('ab_user', 'api_key_updated_at')
    op.drop_column('ab_user', 'encrypted_anthropic_api_key')

"""add_username_to_papers

Revision ID: 2f8fda18f6b2
Revises: 0c8f0fccae7d
Create Date: 2025-11-14 14:38:11.089216

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2f8fda18f6b2'
down_revision = '0c8f0fccae7d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add username column to papers table (nullable for backward compatibility)
    op.add_column(
        'papers',
        sa.Column(
            'username',
            sa.String(length=64),
            nullable=True,
        ),
    )


def downgrade() -> None:
    # Remove username column from papers table
    op.drop_column('papers', 'username')


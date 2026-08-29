"""add shape to orbs

Revision ID: 6b8d27a1c3f4
Revises: 2f8fda18f6b2
Create Date: 2026-08-28
"""

from alembic import op
import sqlalchemy as sa


revision = "6b8d27a1c3f4"
down_revision = "2f8fda18f6b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.add_column(
    "orbs",
    sa.Column("shape", sa.String(length=16), nullable=False, server_default="sphere"),
  )


def downgrade() -> None:
  op.drop_column("orbs", "shape")

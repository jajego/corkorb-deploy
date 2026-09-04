"""add orb ownership and contributors

Revision ID: 8d5c21b43a10
Revises: 6b8d27a1c3f4
Create Date: 2026-09-03
"""

from alembic import op
import sqlalchemy as sa


revision = "8d5c21b43a10"
down_revision = "6b8d27a1c3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.add_column("orbs", sa.Column("owner_user_id", sa.String(length=64), nullable=True))
  op.create_index("ix_orbs_owner_user_id", "orbs", ["owner_user_id"])
  op.create_table(
    "orb_contributors",
    sa.Column("user_id", sa.String(length=64), nullable=False),
    sa.Column(
      "orb_id",
      sa.String(length=64),
      sa.ForeignKey("orbs.id", ondelete="CASCADE"),
      nullable=False,
    ),
    sa.Column("contributed_at", sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint("user_id", "orb_id"),
  )
  op.create_index("ix_orb_contributors_orb_id", "orb_contributors", ["orb_id"])

  # Existing papers can establish contribution history; creator ownership was never recorded.
  op.execute(
    """
    INSERT INTO orb_contributors (user_id, orb_id, contributed_at)
    SELECT user_id, orb_id, MIN(created_at)
    FROM papers
    WHERE user_id NOT LIKE 'user:anonymous%'
    GROUP BY user_id, orb_id
    """
  )


def downgrade() -> None:
  op.drop_index("ix_orb_contributors_orb_id", table_name="orb_contributors")
  op.drop_table("orb_contributors")
  op.drop_index("ix_orbs_owner_user_id", table_name="orbs")
  op.drop_column("orbs", "owner_user_id")

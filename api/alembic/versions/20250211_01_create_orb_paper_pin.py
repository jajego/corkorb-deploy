"""create orb, paper, pin tables

Revision ID: 20250211_01
Revises:
Create Date: 2025-02-11 13:00:00

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20250211_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "orbs",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_accessed", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_papers", sa.Integer(), nullable=False, server_default=sa.text("50")),
    )

    op.create_table(
        "papers",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("orb_id", sa.String(length=32), sa.ForeignKey("orbs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("uploaded", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("validated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index("ix_papers_orb_id", "papers", ["orb_id"])

    op.create_table(
        "pins",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column(
            "paper_id",
            sa.String(length=32),
            sa.ForeignKey("papers.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("position", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("pins")
    op.drop_index("ix_papers_orb_id", table_name="papers")
    op.drop_table("papers")
    op.drop_table("orbs")


"""Durable cleanup for moderated images."""
from alembic import op
import sqlalchemy as sa

revision = 'a61e79d302bf'
down_revision = '9a61c84d2b70'
branch_labels = None
depends_on = None


def upgrade():
  op.create_table('image_cleanup',
    sa.Column('paper_id', sa.String(64), primary_key=True),
    sa.Column('orb_id', sa.String(255), nullable=False),
    sa.Column('file_extension', sa.String(16), nullable=False),
    sa.Column('storage_deleted', sa.Boolean(), nullable=False),
    sa.Column('broadcast_sent', sa.Boolean(), nullable=False),
    sa.Column('next_attempt', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
  )


def downgrade():
  op.drop_table('image_cleanup')

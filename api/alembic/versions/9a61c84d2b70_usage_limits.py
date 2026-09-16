"""Persist shared upload and Rekognition quotas."""
from alembic import op
import sqlalchemy as sa

revision = '9a61c84d2b70'
down_revision = '8d5c21b43a10'
branch_labels = None
depends_on = None


def upgrade():
  op.create_table('usage_counters',
    sa.Column('scope', sa.String(128), primary_key=True),
    sa.Column('period', sa.Date(), primary_key=True),
    sa.Column('used', sa.Integer(), nullable=False),
  )


def downgrade():
  op.drop_table('usage_counters')

"""embed_pin_in_paper

Revision ID: 555f452b2fac
Revises: 20250211_01
Create Date: 2025-11-12 11:05:46.199771

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '555f452b2fac'
down_revision = '20250211_01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add pin_position column to papers table (nullable initially for migration)
    op.add_column(
        'papers',
        sa.Column(
            'pin_position',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    
    # Migrate existing pin data from pins table to papers table
    # This SQL copies the position JSONB from pins to papers.pin_position
    op.execute("""
        UPDATE papers
        SET pin_position = pins.position
        FROM pins
        WHERE papers.id = pins.paper_id
    """)
    
    # Now make pin_position NOT NULL (all papers should have a pin)
    op.alter_column('papers', 'pin_position', nullable=False)
    
    # Drop the pins table (CASCADE will handle foreign keys)
    op.drop_table('pins')


def downgrade() -> None:
    # Recreate pins table
    op.create_table(
        'pins',
        sa.Column('id', sa.String(length=32), primary_key=True),
        sa.Column(
            'paper_id',
            sa.String(length=32),
            sa.ForeignKey('papers.id', ondelete='CASCADE'),
            nullable=False,
            unique=True,
        ),
        sa.Column('position', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    
    # Migrate pin_position data back to pins table
    # Note: We lose pin.id and pin.created_at in downgrade (would need to generate new IDs)
    op.execute("""
        INSERT INTO pins (id, paper_id, position, created_at)
        SELECT 
            gen_random_uuid()::text,
            papers.id,
            papers.pin_position,
            NOW()
        FROM papers
        WHERE papers.pin_position IS NOT NULL
    """)
    
    # Drop pin_position column from papers
    op.drop_column('papers', 'pin_position')


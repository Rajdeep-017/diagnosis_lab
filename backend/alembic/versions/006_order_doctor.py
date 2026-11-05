"""Add ordering clinician metadata."""

from alembic import op
import sqlalchemy as sa

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('orders', sa.Column('doctor', sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column('orders', 'doctor')

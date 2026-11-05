"""Add message recipient and purpose metadata for the demo outbox."""

from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'notifications',
        sa.Column('recipient', sa.String(length=32), nullable=False, server_default=''),
    )
    op.add_column(
        'notifications',
        sa.Column('purpose', sa.String(length=32), nullable=False, server_default='report-link'),
    )


def downgrade() -> None:
    op.drop_column('notifications', 'purpose')
    op.drop_column('notifications', 'recipient')

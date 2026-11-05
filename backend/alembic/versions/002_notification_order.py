"""Associate delivery notifications with orders."""

from alembic import op
import sqlalchemy as sa

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('notifications', sa.Column('order_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_notifications_order_id_orders',
        'notifications',
        'orders',
        ['order_id'],
        ['id'],
    )
    op.create_index('ix_notifications_order_id', 'notifications', ['order_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_notifications_order_id', table_name='notifications')
    op.drop_constraint('fk_notifications_order_id_orders', 'notifications', type_='foreignkey')
    op.drop_column('notifications', 'order_id')

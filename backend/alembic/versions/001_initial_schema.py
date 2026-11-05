"""Initial schema.

Revision ID: 001
Revises: 
Create Date: 2026-11-04 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'patients',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('mobile', sa.String(length=32), nullable=False),
        sa.Column('dob', sa.String(length=16), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
    )
    op.create_index(op.f('ix_patients_id'), 'patients', ['id'], unique=False)

    op.create_table(
        'accounts',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('mobile_hash', sa.String(length=128), nullable=False),
        sa.Column('mobile_enc', sa.Text(), nullable=False),
        sa.Column('consent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('consent_version', sa.String(length=32), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.UniqueConstraint('mobile_hash', name='uq_accounts_mobile_hash'),
    )
    op.create_index(op.f('ix_accounts_id'), 'accounts', ['id'], unique=False)
    op.create_index(op.f('ix_accounts_mobile_hash'), 'accounts', ['mobile_hash'], unique=True)

    op.create_table(
        'account_patients',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('patient_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['account_id'], ['accounts.id']),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.id']),
    )

    op.create_table(
        'orders',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('order_no', sa.String(length=64), nullable=False),
        sa.Column('patient_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='processing'),
        sa.Column('signed_off_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.id']),
        sa.UniqueConstraint('order_no', name='uq_orders_order_no'),
    )
    op.create_index(op.f('ix_orders_id'), 'orders', ['id'], unique=False)
    op.create_index(op.f('ix_orders_order_no'), 'orders', ['order_no'], unique=True)

    op.create_table(
        'results',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('parameter', sa.String(length=64), nullable=False),
        sa.Column('value', sa.String(length=32), nullable=False),
        sa.Column('unit', sa.String(length=32), nullable=True),
        sa.Column('reference_range', sa.String(length=64), nullable=True),
        sa.Column('flag', sa.String(length=32), nullable=False, server_default='normal'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id']),
    )

    op.create_table(
        'report_links',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=128), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id']),
        sa.UniqueConstraint('token_hash', name='uq_report_links_token_hash'),
    )

    op.create_table(
        'otp_challenges',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=True),
        sa.Column('mobile_hash', sa.String(length=128), nullable=False),
        sa.Column('code_hash', sa.String(length=255), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('verified', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['account_id'], ['accounts.id']),
    )

    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('channel', sa.String(length=32), nullable=False, server_default='sms'),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='queued'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
    )

    op.create_table(
        'summaries',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('lang', sa.String(length=8), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('source', sa.String(length=16), nullable=False, server_default='fallback'),
        sa.Column('flagged_by_patient', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('review_status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id']),
    )

    op.create_table(
        'callback_tasks',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('order_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='open'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id']),
    )

    op.create_table(
        'access_logs',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('actor', sa.String(length=32), nullable=False, server_default='patient'),
        sa.Column('order_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=32), nullable=False),
        sa.Column('ip', sa.String(length=64), nullable=True),
        sa.Column('user_agent', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['order_id'], ['orders.id']),
    )

    op.create_table(
        'staff_users',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('email', sa.String(length=128), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=32), nullable=False, server_default='front_desk'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.UniqueConstraint('email', name='uq_staff_users_email'),
    )
    op.create_index(op.f('ix_staff_users_email'), 'staff_users', ['email'], unique=True)


def downgrade() -> None:
    op.drop_table('staff_users')
    op.drop_table('access_logs')
    op.drop_table('callback_tasks')
    op.drop_table('summaries')
    op.drop_table('notifications')
    op.drop_table('otp_challenges')
    op.drop_table('report_links')
    op.drop_table('results')
    op.drop_table('orders')
    op.drop_table('account_patients')
    op.drop_table('accounts')
    op.drop_table('patients')

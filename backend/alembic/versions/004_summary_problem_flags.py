"""Store patient summary feedback per account."""

from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'summary_problem_flags',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('summary_id', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=300), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['account_id'], ['accounts.id']),
        sa.ForeignKeyConstraint(['summary_id'], ['summaries.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('account_id', 'summary_id', name='uq_summary_problem_flags_account_summary'),
    )
    op.create_index('ix_summary_problem_flags_account_id', 'summary_problem_flags', ['account_id'])
    op.create_index('ix_summary_problem_flags_summary_id', 'summary_problem_flags', ['summary_id'])


def downgrade() -> None:
    op.drop_index('ix_summary_problem_flags_summary_id', table_name='summary_problem_flags')
    op.drop_index('ix_summary_problem_flags_account_id', table_name='summary_problem_flags')
    op.drop_table('summary_problem_flags')

"""Support patient sessions, OTP-bound links, and result summaries."""

from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('otp_challenges', sa.Column('challenge_id', sa.String(length=64), nullable=True))
    op.execute("UPDATE otp_challenges SET challenge_id = 'legacy-' || id WHERE challenge_id IS NULL")
    op.alter_column('otp_challenges', 'challenge_id', nullable=False)
    op.create_index('ix_otp_challenges_challenge_id', 'otp_challenges', ['challenge_id'], unique=True)
    op.add_column('otp_challenges', sa.Column('mobile_enc', sa.Text(), nullable=True))
    op.add_column('otp_challenges', sa.Column('consent_version', sa.String(length=32), nullable=True))
    op.execute("UPDATE otp_challenges SET mobile_enc = '', consent_version = 'dpdp-v1' WHERE mobile_enc IS NULL")
    op.alter_column('otp_challenges', 'mobile_enc', nullable=False)
    op.alter_column('otp_challenges', 'consent_version', nullable=False)
    op.add_column('otp_challenges', sa.Column('report_link_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_otp_challenges_report_link_id_report_links',
        'otp_challenges',
        'report_links',
        ['report_link_id'],
        ['id'],
    )
    op.create_index('ix_otp_challenges_report_link_id', 'otp_challenges', ['report_link_id'])
    op.add_column('summaries', sa.Column('result_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_summaries_result_id_results',
        'summaries',
        'results',
        ['result_id'],
        ['id'],
    )
    op.create_index('ix_summaries_result_id', 'summaries', ['result_id'])
    op.create_unique_constraint(
        'uq_account_patients_account_patient',
        'account_patients',
        ['account_id', 'patient_id'],
    )


def downgrade() -> None:
    op.drop_constraint('uq_account_patients_account_patient', 'account_patients', type_='unique')
    op.drop_index('ix_summaries_result_id', table_name='summaries')
    op.drop_constraint('fk_summaries_result_id_results', 'summaries', type_='foreignkey')
    op.drop_column('summaries', 'result_id')
    op.drop_index('ix_otp_challenges_report_link_id', table_name='otp_challenges')
    op.drop_constraint(
        'fk_otp_challenges_report_link_id_report_links',
        'otp_challenges',
        type_='foreignkey',
    )
    op.drop_column('otp_challenges', 'report_link_id')
    op.drop_index('ix_otp_challenges_challenge_id', table_name='otp_challenges')
    op.drop_column('otp_challenges', 'challenge_id')
    op.drop_column('otp_challenges', 'consent_version')
    op.drop_column('otp_challenges', 'mobile_enc')

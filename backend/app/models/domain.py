from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class FlagStatus(str, Enum):
    normal = 'normal'
    low = 'low'
    high = 'high'
    critical = 'critical'


class NotificationStatus(str, Enum):
    queued = 'queued'
    sent = 'sent'
    delivered = 'delivered'
    failed = 'failed'


class Account(Base):
    __tablename__ = 'accounts'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mobile_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    mobile_enc: Mapped[str] = mapped_column(Text, nullable=False)
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    patients = relationship('AccountPatient', back_populates='account')


class Patient(Base):
    __tablename__ = 'patients'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    mobile: Mapped[str] = mapped_column(String(32), nullable=False)
    dob: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    orders = relationship('Order', back_populates='patient')
    account_links = relationship('AccountPatient', back_populates='patient')


class AccountPatient(Base):
    __tablename__ = 'account_patients'
    __table_args__ = (
        UniqueConstraint('account_id', 'patient_id', name='uq_account_patients_account_patient'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey('accounts.id'), nullable=False)
    patient_id: Mapped[int] = mapped_column(ForeignKey('patients.id'), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    account = relationship('Account', back_populates='patients')
    patient = relationship('Patient', back_populates='account_links')


class Order(Base):
    __tablename__ = 'orders'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_no: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    patient_id: Mapped[int] = mapped_column(ForeignKey('patients.id'), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default='processing', nullable=False)
    signed_off_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    patient = relationship('Patient', back_populates='orders')
    results = relationship('Result', back_populates='order')
    links = relationship('ReportLink', back_populates='order')
    notifications = relationship('Notification', back_populates='order')


class Result(Base):
    __tablename__ = 'results'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey('orders.id'), nullable=False)
    parameter: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[str] = mapped_column(String(32), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reference_range: Mapped[str | None] = mapped_column(String(64), nullable=True)
    flag: Mapped[str] = mapped_column(SAEnum(FlagStatus, native_enum=False), default=FlagStatus.normal, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    order = relationship('Order', back_populates='results')


class ReportLink(Base):
    __tablename__ = 'report_links'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey('orders.id'), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    order = relationship('Order', back_populates='links')


class OtpChallenge(Base):
    __tablename__ = 'otp_challenges'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    challenge_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    account_id: Mapped[int | None] = mapped_column(ForeignKey('accounts.id'), nullable=True)
    report_link_id: Mapped[int | None] = mapped_column(ForeignKey('report_links.id'), nullable=True, index=True)
    mobile_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    mobile_enc: Mapped[str] = mapped_column(Text, nullable=False)
    consent_version: Mapped[str] = mapped_column(String(32), default='dpdp-v1', nullable=False)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Notification(Base):
    __tablename__ = 'notifications'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey('orders.id'), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(32), default='sms', nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(SAEnum(NotificationStatus, native_enum=False), default=NotificationStatus.queued, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    order = relationship('Order', back_populates='notifications')


class Summary(Base):
    __tablename__ = 'summaries'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey('orders.id'), nullable=False)
    result_id: Mapped[int | None] = mapped_column(ForeignKey('results.id'), nullable=True, index=True)
    lang: Mapped[str] = mapped_column(String(8), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default='fallback', nullable=False)
    flagged_by_patient: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    review_status: Mapped[str] = mapped_column(String(16), default='pending', nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class SummaryProblemFlag(Base):
    __tablename__ = 'summary_problem_flags'
    __table_args__ = (
        UniqueConstraint('account_id', 'summary_id', name='uq_summary_problem_flags_account_summary'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey('accounts.id'), nullable=False, index=True)
    summary_id: Mapped[int] = mapped_column(ForeignKey('summaries.id'), nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class CallbackTask(Base):
    __tablename__ = 'callback_tasks'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey('orders.id'), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default='open', nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class AccessLog(Base):
    __tablename__ = 'access_logs'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    actor: Mapped[str] = mapped_column(String(32), default='patient', nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey('orders.id'), nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class StaffUser(Base):
    __tablename__ = 'staff_users'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default='front_desk', nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

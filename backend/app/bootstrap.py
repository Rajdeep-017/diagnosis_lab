from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models.domain import (
    AccessLog,
    CallbackTask,
    Notification,
    NotificationStatus,
    Order,
    Patient,
    ReportLink,
    Result,
    StaffUser,
    Summary,
)


SAMPLE_ORDERS = (
    ('DEMO-1001', 'Demo Family Member A', '9000001001', 'Haemoglobin', '10.2', 'g/dL', '12.0-15.5', 'low', 'processing', None),
    ('DEMO-1002', 'Demo Family Member B', '9000001001', 'Glucose', '92', 'mg/dL', '70-140', 'normal', 'ready', None),
    ('DEMO-1003', 'Demo Family Member C', '9000001001', 'Creatinine', '1.4', 'mg/dL', '0.6-1.2', 'high', 'ready', 'queued'),
    ('DEMO-1004', 'Demo Patient D', '9000001002', 'LDL', '142', 'mg/dL', '0-100', 'high', 'ready', 'sent'),
    ('DEMO-1005', 'Demo Patient E', '9000001003', 'Glucose', '88', 'mg/dL', '70-140', 'normal', 'ready', 'delivered'),
    ('DEMO-1006', 'Demo Patient F', '9000001004', 'Vitamin D', '12', 'ng/mL', '30-100', 'low', 'ready', 'failed'),
    ('DEMO-1007', 'Demo Patient G', '9000001005', 'Cholesterol', '188', 'mg/dL', '0-200', 'normal', 'ready', 'link_opened'),
    ('DEMO-1008', 'Demo Patient H', '9000001006', 'TSH', '3.1', 'mIU/L', '0.4-4.0', 'normal', 'ready', 'expired'),
    ('DEMO-1009', 'Demo Patient I', '9000001007', 'Potassium', '7.1', 'mEq/L', '3.5-5.1', 'critical', 'ready', None),
)


def bootstrap_database() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        if settings.demo_mode and settings.demo_staff_password:
            configured_users = (
                (settings.demo_staff_email, 'front_desk'),
                (settings.demo_ops_email, 'ops'),
                (settings.demo_pathologist_email, 'pathologist'),
            )
            for configured_email, role in configured_users:
                email = configured_email.strip().lower()
                staff_user = db.scalar(select(StaffUser).where(StaffUser.email == email))
                if staff_user is None:
                    db.add(StaffUser(
                        email=email,
                        password_hash=PasswordHasher().hash(settings.demo_staff_password),
                        role=role,
                    ))

        if settings.demo_mode and db.scalar(select(Order.id).limit(1)) is None:
            now = datetime.now(timezone.utc)
            for order_no, patient_name, mobile, parameter, value, unit, reference_range, flag, order_status, delivery in SAMPLE_ORDERS:
                patient = Patient(name=patient_name, mobile=mobile)
                order = Order(
                    order_no=order_no,
                    patient=patient,
                    status=order_status,
                    doctor='Demo Clinician' if order_status == 'ready' else None,
                    signed_off_at=now if order_status == 'ready' else None,
                )
                order.results.append(Result(
                    parameter=parameter,
                    value=value,
                    unit=unit,
                    reference_range=reference_range,
                    flag=flag,
                ))
                db.add(order)
                db.flush()
                for result in order.results:
                    summary_en = (
                        'This result is within the usual range.'
                        if flag == 'normal'
                        else 'This result is outside the usual range. Contact the lab if you have questions.'
                    )
                    summary_te = (
                        'ఈ ఫలితం సాధారణ పరిధిలో ఉంది.'
                        if flag == 'normal'
                        else 'ఈ ఫలితం సాధారణ పరిధికి వెలుపల ఉంది. సందేహాలు ఉంటే ప్రయోగశాలను సంప్రదించండి.'
                    )
                    summary_hi = (
                        'यह परिणाम सामान्य सीमा के भीतर है।'
                        if flag == 'normal'
                        else 'यह परिणाम सामान्य सीमा से बाहर है। प्रश्न होने पर प्रयोगशाला से संपर्क करें।'
                    )
                    for lang, text in (('en', summary_en), ('te', summary_te), ('hi', summary_hi)):
                        db.add(Summary(
                            order_id=order.id,
                            result_id=result.id,
                            lang=lang,
                            text=text,
                            source='fallback',
                        ))

                if delivery:
                    token = secrets.token_urlsafe(32)
                    expires_at = now - timedelta(hours=1) if delivery == 'expired' else now + timedelta(hours=72)
                    db.add(ReportLink(
                        order_id=order.id,
                        token_hash=hashlib.sha256(token.encode()).hexdigest(),
                        expires_at=expires_at,
                    ))
                    delivery_status = {
                        'queued': NotificationStatus.queued,
                        'sent': NotificationStatus.sent,
                        'delivered': NotificationStatus.delivered,
                        'failed': NotificationStatus.failed,
                        'link_opened': NotificationStatus.delivered,
                        'expired': NotificationStatus.sent,
                    }[delivery]
                    db.add(Notification(
                        order_id=order.id,
                        channel='sms',
                        recipient=f'{mobile[:2]}••••{mobile[-4:]}',
                        purpose='report-link',
                        payload=(
                            f'Demo report {order_no}: /r/{token}'
                            if settings.demo_mode else f'Report {order_no} delivery recorded.'
                        ),
                        status=delivery_status,
                    ))
                    if delivery == 'link_opened':
                        db.add(AccessLog(actor='patient', order_id=order.id, action='report_view'))

                if flag == 'critical':
                    db.add(CallbackTask(
                        order_id=order.id,
                        status='open',
                        notes=f'Critical result requires follow-up: {parameter}.',
                    ))
                    db.add(Notification(
                        order_id=order.id,
                        channel='internal',
                        recipient='Staff',
                        purpose='callback-notice',
                        payload=f'Callback task created for critical result on {order_no}.',
                        status=NotificationStatus.queued,
                    ))

        db.commit()


if __name__ == '__main__':
    bootstrap_database()

from __future__ import annotations

from datetime import datetime, timezone

from argon2 import PasswordHasher
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models.domain import Order, Patient, Result, StaffUser, Summary


SAMPLE_ORDERS = (
    ('ORD-1001', 'Ananya Rao', '9876543210', 'Haemoglobin', '10.2', 'g/dL', '12.0-15.5', 'low'),
    ('ORD-1002', 'Vivek Nair', '9876543211', 'LDL', '142', 'mg/dL', '0-100', 'high'),
    ('ORD-1003', 'Ramesh Yadav', '9876543212', 'Potassium', '6.8', 'mEq/L', '3.5-5.1', 'critical'),
    ('ORD-1004', 'Sowmya Kumar', '9876543213', 'Glucose', '88', 'mg/dL', '70-140', 'normal'),
    ('ORD-1005', 'Meera Singh', '9876543214', 'Creatinine', '1.1', 'mg/dL', '0.6-1.2', 'normal'),
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

        if db.scalar(select(Order.id).limit(1)) is None:
            now = datetime.now(timezone.utc)
            for order_no, patient_name, mobile, parameter, value, unit, reference_range, flag in SAMPLE_ORDERS:
                patient = Patient(name=patient_name, mobile=mobile)
                order = Order(order_no=order_no, patient=patient, status='ready', signed_off_at=now)
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

        db.commit()


if __name__ == '__main__':
    bootstrap_database()

from __future__ import annotations

import csv
import hashlib
import io
import secrets
from datetime import timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import case, exists, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.config import get_settings
from app.api.routes.auth import normalise_mobile
from app.core.clock import utc_now
from app.core.staff_auth import COOKIE_NAME, create_session_token, request_staff_user
from app.db import get_db
from app.models.domain import (
    AccessLog,
    CallbackTask,
    FlagStatus,
    Notification,
    NotificationStatus,
    Order,
    Patient,
    ReportLink,
    Result,
    StaffUser,
    Summary,
    SummaryProblemFlag,
)

router = APIRouter()
password_hasher = PasswordHasher()
StaffSession = Annotated[StaffUser, Depends(request_staff_user)]
Database = Annotated[Session, Depends(get_db)]


class StaffLogin(BaseModel):
    email: str = Field(..., min_length=3, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)


class CsvImportRequest(BaseModel):
    csv: str = Field(..., min_length=1, max_length=1_000_000)


class ResendRequest(BaseModel):
    confirmed: bool


def _public_user(user: StaffUser) -> dict[str, int | str]:
    return {'id': user.id, 'email': user.email, 'role': user.role}


def _mask_recipient(mobile: str) -> str:
    digits = ''.join(character for character in mobile if character.isdigit())
    return f'{digits[:3]}******{digits[-2:]}' if len(digits) >= 5 else '—'


@router.post('/login')
def login(payload: StaffLogin, request: Request, response: Response, db: Database) -> dict[str, dict[str, int | str]]:
    source_ip = request.client.host if request.client else 'unknown'
    ip_digest = hashlib.sha256(source_ip.encode('utf-8')).hexdigest()
    now = utc_now()
    window_start = now - timedelta(minutes=15)
    failures = db.scalar(select(func.count(AccessLog.id)).where(
        AccessLog.action == 'staff_login_failed',
        AccessLog.ip == ip_digest,
        AccessLog.created_at >= window_start,
    )) or 0
    if failures >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={'code': 'rate_limited', 'message': 'Too many sign-in attempts. Try again later.', 'retry_after': 900},
            headers={'Retry-After': '900'},
        )

    email = payload.email.strip().lower()
    user = db.scalar(select(StaffUser).where(StaffUser.email == email))
    password_matches = False
    if user:
        try:
            password_matches = password_hasher.verify(user.password_hash, payload.password)
        except (VerifyMismatchError, InvalidHashError):
            password_matches = False

    if not password_matches or user is None:
        db.add(AccessLog(actor='anonymous', action='staff_login_failed', ip=ip_digest))
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Email or password is incorrect.')

    settings = get_settings()
    response.set_cookie(
        key=COOKIE_NAME,
        value=create_session_token(user),
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite='lax',
        max_age=settings.auth_token_ttl_hours * 60 * 60,
        path='/api',
    )
    return {'user': _public_user(user)}


@router.get('/me')
def current_user(user: StaffSession) -> dict[str, dict[str, int | str]]:
    return {'user': _public_user(user)}


@router.post('/logout', status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    response.status_code = status.HTTP_204_NO_CONTENT
    response.delete_cookie(key=COOKIE_NAME, path='/api', httponly=True, samesite='lax')
    return response


@router.get('/orders')
def list_orders(
    _: StaffSession,
    db: Database,
    search: str = Query(default='', max_length=100),
    order_status: str | None = Query(default=None, alias='status', max_length=32),
    delivery_state: str | None = Query(default=None, max_length=32),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> dict[str, object]:
    latest_status = (
        select(Notification.status)
        .where(Notification.order_id == Order.id, Notification.purpose == 'report-link')
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(1)
        .correlate(Order)
        .scalar_subquery()
    )
    latest_time = (
        select(Notification.created_at)
        .where(Notification.order_id == Order.id, Notification.purpose == 'report-link')
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(1)
        .correlate(Order)
        .scalar_subquery()
    )
    latest_link_expiry = (
        select(ReportLink.expires_at)
        .where(ReportLink.order_id == Order.id, ReportLink.revoked_at.is_(None))
        .order_by(ReportLink.created_at.desc(), ReportLink.id.desc())
        .limit(1)
        .correlate(Order)
        .scalar_subquery()
    )
    was_opened = exists(
        select(AccessLog.id).where(AccessLog.order_id == Order.id, AccessLog.action == 'report_view')
    )
    now = utc_now()
    delivery_expression = case(
        (was_opened, 'link_opened'),
        (latest_link_expiry.is_not(None) & (latest_link_expiry < now), 'expired'),
        (latest_status.is_(None), 'not_sent'),
        else_=latest_status,
    )

    statement = select(Order, Patient, latest_status, latest_time, latest_link_expiry, delivery_expression).join(
        Patient, Patient.id == Order.patient_id
    )
    filters = []
    if order_status and order_status != 'all':
        filters.append(Order.status == order_status)
    if delivery_state and delivery_state != 'all':
        filters.append(delivery_expression == delivery_state)
    if search.strip():
        term = search.strip().lower()
        digits = ''.join(character for character in term if character.isdigit())
        clauses = [
            func.lower(Order.order_no).contains(term),
            func.lower(Patient.name).contains(term),
        ]
        if len(digits) >= 4:
            clauses.append(Patient.mobile.contains(digits[-10:]))
        filters.append(or_(*clauses))
    if filters:
        statement = statement.where(*filters)

    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    rows = db.execute(
        statement.order_by(Order.created_at.desc(), Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        'orders': [
            {
                'id': order.id,
                'order': order.order_no,
                'patient': patient.name,
                'mobile': _mask_staff_mobile(patient.mobile),
                'status': order.status,
                'doctor': order.doctor,
                'signed_at': order.signed_off_at.isoformat() if order.signed_off_at else None,
                'delivery_state': state,
                'delivery_at': delivery_at.isoformat() if delivery_at else None,
                'link_expires_at': expires_at.isoformat() if expires_at else None,
            }
            for order, patient, _, delivery_at, expires_at, state in rows
        ],
        'pagination': {
            'page': page,
            'page_size': page_size,
            'total': total,
            'pages': (total + page_size - 1) // page_size,
        },
    }


def _mask_staff_mobile(value: str) -> str:
    digits = ''.join(character for character in value if character.isdigit())[-10:]
    return f'{digits[:2]}••••{digits[-4:]}' if len(digits) == 10 else '—'


@router.post('/orders/{order_id}/reveal-mobile')
def reveal_order_mobile(order_id: int, user: StaffSession, db: Database) -> dict[str, str]:
    if user.role not in {'front_desk', 'ops'}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='This staff role cannot reveal mobile numbers.')
    order = db.scalar(select(Order).options(joinedload(Order.patient)).where(Order.id == order_id))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Order not found.')
    db.add(AccessLog(actor=f'staff:{user.id}', order_id=order.id, action='mobile_reveal'))
    db.commit()
    return {'mobile': order.patient.mobile}


@router.get('/orders/{order_id}')
def order_detail(order_id: int, _: StaffSession, db: Database) -> dict[str, object]:
    order = db.scalar(select(Order).options(joinedload(Order.patient)).where(Order.id == order_id))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Order not found.')
    notifications = db.scalars(
        select(Notification)
        .where(Notification.order_id == order.id, Notification.purpose == 'report-link')
        .order_by(Notification.created_at, Notification.id)
    ).all()
    latest_link = db.scalar(
        select(ReportLink)
        .where(ReportLink.order_id == order.id, ReportLink.revoked_at.is_(None))
        .order_by(ReportLink.created_at.desc(), ReportLink.id.desc())
        .limit(1)
    )
    callback = db.scalar(
        select(CallbackTask).where(CallbackTask.order_id == order.id, CallbackTask.status == 'open')
        .order_by(CallbackTask.created_at.desc(), CallbackTask.id.desc()).limit(1)
    )
    return {
        'id': order.id,
        'order': order.order_no,
        'patient': order.patient.name,
        'status': order.status,
        'doctor': order.doctor,
        'signed_at': order.signed_off_at.isoformat() if order.signed_off_at else None,
        'link_expires_at': latest_link.expires_at.isoformat() if latest_link else None,
        'delivery_timeline': [
            {
                'status': notification.status.value if isinstance(notification.status, NotificationStatus) else notification.status,
                'created_at': notification.created_at.isoformat(),
            }
            for notification in notifications
        ],
        'callback_task': (
            {'id': callback.id, 'status': callback.status, 'notes': callback.notes}
            if callback else None
        ),
    }


@router.post('/import/csv')
def import_csv(payload: CsvImportRequest, user: StaffSession, db: Database) -> dict[str, object]:
    reader = csv.DictReader(io.StringIO(payload.csv, newline=''))
    required = {'order_no', 'patient_name', 'mobile', 'parameter', 'value', 'unit', 'reference_range', 'flag', 'status'}
    if reader.fieldnames is None or not required.issubset({name.strip() for name in reader.fieldnames}):
        raise HTTPException(status_code=400, detail='CSV requires order_no, patient_name, mobile, parameter, value, unit, reference_range, flag, and status columns.')
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail='CSV contains no report rows.')

    normalized_rows = []
    for line_number, row in enumerate(rows, start=2):
        values = {key.strip(): (value or '').strip() for key, value in row.items() if key is not None}
        try:
            mobile = normalise_mobile(values['mobile'])
            flag = FlagStatus(values['flag'].lower())
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=f'Invalid mobile number or result flag on CSV line {line_number}.') from exc
        order_no = values.get('order_no', '')
        patient_name = values.get('patient_name', '')
        parameter = values.get('parameter', '')
        result_value = values.get('value', '')
        result_status = values.get('status', '').lower()
        if not all((order_no, patient_name, parameter, result_value)) or result_status not in {'processing', 'ready'}:
            raise HTTPException(status_code=400, detail=f'Invalid report fields or status on CSV line {line_number}.')
        normalized_rows.append((values, mobile, flag, result_status))

    created_orders: set[int] = set()
    transitioned_orders: set[int] = set()
    now = utc_now()
    for values, mobile, flag, requested_status in normalized_rows:
        order_no = values['order_no']
        patient_name = values['patient_name']
        patient = db.scalar(select(Patient).where(
            Patient.name == patient_name,
            Patient.mobile.in_((mobile, mobile.removeprefix('+'), mobile[-10:], f'0{mobile[-10:]}')),
        ))
        if patient is None:
            patient = Patient(name=patient_name, mobile=mobile)
            db.add(patient)
            db.flush()

        order = db.scalar(select(Order).where(Order.order_no == order_no))
        if order is not None and order.patient_id != patient.id:
            raise HTTPException(status_code=409, detail=f'Order {order_no} is already assigned to another patient.')
        if order is None:
            order = Order(order_no=order_no, patient_id=patient.id, status='processing')
            db.add(order)
            db.flush()
            created_orders.add(order.id)

        result = db.scalar(select(Result).where(
            Result.order_id == order.id,
            Result.parameter == values['parameter'],
        ))
        if result is None:
            result = Result(
                order_id=order.id,
                parameter=values['parameter'],
                value=values['value'],
                unit=values.get('unit') or None,
                reference_range=values.get('reference_range') or None,
                flag=flag,
            )
            db.add(result)
            db.flush()
        else:
            result.value = values['value']
            result.unit = values.get('unit') or None
            result.reference_range = values.get('reference_range') or None
            result.flag = flag

        for language in ('en', 'te', 'hi'):
            summary_text = values.get(f'summary_{language}', '')
            if not summary_text:
                summary_text = (
                    'Please contact the lab to discuss this critical result.'
                    if flag == FlagStatus.critical
                    else 'This result is outside the usual range.' if flag != FlagStatus.normal
                    else 'This result is within the usual range.'
                )
            summary = db.scalar(select(Summary).where(
                Summary.result_id == result.id,
                Summary.lang == language,
            ))
            if summary is None:
                db.add(Summary(order_id=order.id, result_id=result.id, lang=language, text=summary_text))
            else:
                summary.text = summary_text

        if requested_status == 'ready' and order.status != 'ready':
            order.status = 'ready'
            order.signed_off_at = now
            transitioned_orders.add(order.id)
        if flag == FlagStatus.critical and db.scalar(select(CallbackTask.id).where(
            CallbackTask.order_id == order.id,
            CallbackTask.status == 'open',
        )) is None:
            db.add(CallbackTask(
                order_id=order.id,
                status='open',
                notes=f'Critical result requires patient follow-up: {values["parameter"]}.',
            ))
            db.add(Notification(
                order_id=order.id,
                channel='internal',
                recipient='Staff',
                purpose='callback-notice',
                payload=f'Callback task created for critical result {values["parameter"]} on {order.order_no}.',
                status=NotificationStatus.queued,
            ))

    for order_id in transitioned_orders:
        token = secrets.token_urlsafe(32)
        db.add(ReportLink(
            order_id=order_id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=now + timedelta(hours=get_settings().link_ttl_hours),
        ))
        order = db.get(Order, order_id)
        db.add(Notification(
            order_id=order_id,
            channel='sms',
            recipient=_mask_recipient(order.patient.mobile),
            purpose='report-link',
            payload=(
                f'Report {order.order_no} is ready. Open your report: /r/{token}'
                if get_settings().demo_mode
                else f'Report {order.order_no} is ready.'
            ),
            status=NotificationStatus.queued,
        ))
    db.commit()
    return {
        'created_orders': len(created_orders),
        'ready_orders': len(transitioned_orders),
        'message': f'Imported {len(rows)} CSV row(s); {len(transitioned_orders)} order(s) moved to Ready.',
        'imported_by': user.email,
    }


@router.get('/outbox')
def list_outbox(user: StaffSession, db: Database) -> dict[str, list[dict[str, object]]]:
    if not get_settings().demo_mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Not found.')
    if user.role not in {'front_desk', 'ops'}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='This staff role cannot view the outbox.')
    rows = db.execute(
        select(Notification, Order.order_no)
        .outerjoin(Order, Order.id == Notification.order_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(50)
    ).all()
    return {'messages': [
        {
            'id': notification.id,
            'order_id': notification.order_id,
            'order': order_no,
            'time': notification.created_at.isoformat(),
            'channel': notification.channel,
            'recipient': notification.recipient or '—',
            'purpose': notification.purpose,
            'body': notification.payload,
            'status': notification.status.value if isinstance(notification.status, NotificationStatus) else notification.status,
        }
        for notification, order_no in rows
    ]}


@router.get('/orders/{order_id}/access-logs')
def list_order_access_logs(order_id: int, _: StaffSession, db: Database) -> dict[str, list[dict[str, object]]]:
    if db.get(Order, order_id) is None:
        raise HTTPException(status_code=404, detail='Order not found.')
    logs = db.scalars(
        select(AccessLog)
        .where(AccessLog.order_id == order_id)
        .order_by(AccessLog.created_at.desc(), AccessLog.id.desc())
    ).all()
    return {'access_logs': [
        {
            'id': log.id,
            'actor': log.actor,
            'action': log.action,
            'created_at': log.created_at.isoformat(),
            'ip': log.ip,
        }
        for log in logs
    ]}


@router.get('/callback-tasks')
def list_callback_tasks(_: StaffSession, db: Database) -> dict[str, list[dict[str, object]]]:
    rows = db.execute(
        select(CallbackTask, Order.order_no, Patient.name)
        .join(Order, Order.id == CallbackTask.order_id)
        .join(Patient, Patient.id == Order.patient_id)
        .where(CallbackTask.status == 'open')
        .order_by(CallbackTask.created_at.desc(), CallbackTask.id.desc())
    ).all()
    return {'tasks': [
        {
            'id': task.id,
            'order': order_no,
            'patient': patient_name,
            'status': task.status,
            'notes': task.notes,
        }
        for task, order_no, patient_name in rows
    ]}


@router.get('/summaries/review')
def list_summary_review_queue(_: StaffSession, db: Database) -> dict[str, list[dict[str, object]]]:
    rows = db.execute(
        select(Summary, Order.order_no, Patient.name, Result.parameter)
        .join(Order, Order.id == Summary.order_id)
        .join(Patient, Patient.id == Order.patient_id)
        .outerjoin(Result, Result.id == Summary.result_id)
        .where(Summary.review_status == 'pending')
        .order_by(Summary.created_at.desc(), Summary.id.desc())
    ).all()
    summary_ids = [summary.id for summary, _, _, _ in rows]
    flags_by_summary: dict[int, list[str]] = {}
    flagged_summary_ids: set[int] = set()
    if summary_ids:
        flags = db.scalars(
            select(SummaryProblemFlag)
            .where(SummaryProblemFlag.summary_id.in_(summary_ids))
            .order_by(SummaryProblemFlag.created_at.desc(), SummaryProblemFlag.id.desc())
        ).all()
        for flag in flags:
            flagged_summary_ids.add(flag.summary_id)
            if flag.reason:
                flags_by_summary.setdefault(flag.summary_id, []).append(flag.reason)

    summaries = [
        {
            'id': summary.id,
            'order': order_no,
            'patient': patient_name,
            'parameter': parameter or 'Report summary',
            'language': summary.lang,
            'text': summary.text,
            'flagged': summary.flagged_by_patient or summary.id in flagged_summary_ids,
            'reasons': flags_by_summary.get(summary.id, []),
        }
        for summary, order_no, patient_name, parameter in rows
    ]
    summaries.sort(key=lambda item: (not item['flagged'], item['id']))
    return {'summaries': summaries}


@router.post('/orders/{order_id}/resend', status_code=status.HTTP_202_ACCEPTED)
def resend_order(order_id: int, payload: ResendRequest, user: StaffSession, db: Database) -> dict[str, str]:
    if not payload.confirmed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Confirm before resending a report link.')
    if user.role not in {'front_desk', 'ops'}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='This staff role cannot resend report links.')
    order = db.scalar(select(Order).options(joinedload(Order.patient)).where(Order.id == order_id))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Order not found.')
    now = utc_now()
    actor = f'staff:{user.id}'
    recent_resends = db.scalar(select(func.count(AccessLog.id)).where(
        AccessLog.order_id == order.id,
        AccessLog.actor == actor,
        AccessLog.action == 'report_link_resend',
        AccessLog.created_at >= now - timedelta(hours=1),
    )) or 0
    if recent_resends >= 3:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={'code': 'rate_limited', 'message': 'This order has reached its resend limit.', 'retry_after': 3600},
            headers={'Retry-After': '3600'},
        )
    token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(hours=get_settings().link_ttl_hours)
    db.add(ReportLink(
        order_id=order.id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=expires_at,
    ))
    db.add(Notification(
        order_id=order.id,
        channel='sms',
        recipient=_mask_recipient(order.patient.mobile),
        purpose='report-link',
        payload=(
            f'Report {order.order_no} is ready. Open your report: /r/{token}'
            if get_settings().demo_mode
            else f'Report {order.order_no} delivery has been requested.'
        ),
        status=NotificationStatus.queued,
    ))
    db.add(AccessLog(actor=actor, order_id=order.id, action='report_link_resend'))
    db.commit()
    return {'status': 'queued', 'message': 'Report delivery has been queued.', 'expires_at': expires_at.isoformat()}

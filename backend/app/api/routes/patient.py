from __future__ import annotations

import secrets
import hashlib
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.config import get_settings
from app.core.clock import utc_now
from app.core.patient_auth import PATIENT_COOKIE_NAME, Database, PatientAccount
from app.models.domain import (
    AccessLog,
    Account,
    AccountPatient,
    Order,
    Patient,
    ReportLink,
    Result,
    Summary,
    SummaryProblemFlag,
)

router = APIRouter()
summary_router = APIRouter()


class SummaryFlagToggle(BaseModel):
    flagged: bool


class SummaryProblemReport(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


def _account_patients_query(account_id: int):
    return select(Patient).join(
        AccountPatient,
        AccountPatient.patient_id == Patient.id,
    ).where(AccountPatient.account_id == account_id)


def _account_order_query(account_id: int, order_id: int):
    return select(Order).join(
        AccountPatient,
        AccountPatient.patient_id == Order.patient_id,
    ).options(joinedload(Order.patient)).where(AccountPatient.account_id == account_id, Order.id == order_id)


def _access_log(request: Request, order_id: int, action: str) -> AccessLog:
    return AccessLog(
        actor='patient',
        order_id=order_id,
        action=action,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get('user-agent', '')[:255] or None,
    )


def _result_rows(db: Database, account_id: int, order_id: int) -> list[Result]:
    return db.scalars(
        select(Result)
        .join(Order, Order.id == Result.order_id)
        .join(AccountPatient, AccountPatient.patient_id == Order.patient_id)
        .where(AccountPatient.account_id == account_id, Order.id == order_id)
        .order_by(Result.id)
    ).all()


def _summary_rows(
    db: Database,
    account_id: int,
    order_id: int,
    language: Literal['en', 'te', 'hi'],
) -> dict[int, Summary]:
    rows = db.scalars(
        select(Summary)
        .join(Order, Order.id == Summary.order_id)
        .join(AccountPatient, AccountPatient.patient_id == Order.patient_id)
        .outerjoin(Result, Result.id == Summary.result_id)
        .where(
            AccountPatient.account_id == account_id,
            Order.id == order_id,
            Summary.lang == language,
            or_(Summary.result_id.is_(None), Result.order_id == Order.id),
        )
        .order_by(Summary.created_at.desc(), Summary.id.desc())
    ).all()
    summaries: dict[int, Summary] = {}
    for row in rows:
        if row.result_id is not None and row.result_id not in summaries:
            summaries[row.result_id] = row
    return summaries


def _account_flagged_summary_ids(db: Database, account_id: int) -> set[int]:
    return set(db.scalars(
        select(SummaryProblemFlag.summary_id).where(SummaryProblemFlag.account_id == account_id),
    ).all())


def _report_payload(
    order: Order,
    results: list[Result],
    summaries: dict[int, Summary],
    flagged_summary_ids: set[int],
    language: Literal['en', 'te', 'hi'],
) -> dict[str, object]:
    return {
        'order': {
            'id': order.id,
            'order_no': order.order_no,
            'patient': order.patient.name,
            'status': order.status,
            'signed_at': order.signed_off_at.isoformat() if order.signed_off_at else None,
        },
        'language': language,
        'pdf_url': f'/api/patient/orders/{order.id}/pdf',
        'results': [
            {
                'id': result.id,
                'name': result.parameter,
                'value': None if result.flag.value == 'critical' else result.value,
                'unit': None if result.flag.value == 'critical' else result.unit,
                'reference_range': None if result.flag.value == 'critical' else result.reference_range,
                'flag': result.flag.value,
                'summary_id': summaries[result.id].id if result.id in summaries else None,
                'summary': summaries[result.id].text if result.id in summaries and result.flag.value != 'critical' else None,
                'flagged': summaries[result.id].id in flagged_summary_ids if result.id in summaries else False,
            }
            for result in results
        ],
    }


def _pdf_document(lines: list[str]) -> bytes:
    def pdf_text(value: str) -> bytes:
        escaped = value.encode('latin-1', errors='replace').decode('latin-1')
        escaped = escaped.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        return f'({escaped}) Tj T*'.encode('latin-1')

    content = b'BT /F1 11 Tf 48 790 Td 15 TL ' + b' '.join(pdf_text(line[:150]) for line in lines[:48]) + b' ET'
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream',
    ]
    document = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(document))
        document.extend(f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n')
    xref_offset = len(document)
    document.extend(f'xref\n0 {len(offsets)}\n'.encode())
    document.extend(b'0000000000 65535 f \n')
    for offset in offsets[1:]:
        document.extend(f'{offset:010d} 00000 n \n'.encode())
    document.extend(
        f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF'.encode(),
    )
    return bytes(document)


@router.get('/me')
def current_patient(account: PatientAccount, db: Database) -> dict[str, object]:
    patients = db.scalars(_account_patients_query(account.id).order_by(Patient.name, Patient.id)).all()
    return {
        'account': {'id': account.id},
        'patients': [{'id': patient.id, 'name': patient.name} for patient in patients],
    }


@router.post('/logout', status_code=status.HTTP_204_NO_CONTENT)
def logout_patient(response: Response) -> Response:
    response.delete_cookie(
        key=PATIENT_COOKIE_NAME,
        path='/api',
        httponly=True,
        samesite='lax',
    )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get('/patients')
def list_patients(account: PatientAccount, db: Database) -> dict[str, list[dict[str, object]]]:
    patients = db.scalars(_account_patients_query(account.id).order_by(Patient.name, Patient.id)).all()
    return {'patients': [{'id': patient.id, 'name': patient.name, 'dob': patient.dob} for patient in patients]}


@router.get('/patients/{patient_id}/orders')
def list_patient_orders(patient_id: int, account: PatientAccount, db: Database) -> dict[str, list[dict[str, object]]]:
    patient = db.scalar(_account_patients_query(account.id).where(Patient.id == patient_id))
    if patient is None:
        raise HTTPException(status_code=404, detail='Patient not found.')
    orders = db.scalars(
        select(Order)
        .join(AccountPatient, AccountPatient.patient_id == Order.patient_id)
        .where(AccountPatient.account_id == account.id, Order.patient_id == patient_id)
        .order_by(Order.created_at.desc(), Order.id.desc())
    ).all()
    return {
        'orders': [
            {
                'id': order.id,
                'order_no': order.order_no,
                'status': order.status,
                'signed_at': order.signed_off_at.isoformat() if order.signed_off_at else None,
                'created_at': order.created_at.isoformat() if order.created_at else None,
            }
            for order in orders
        ]
    }


@router.get('/orders/{order_id}')
def get_patient_report(
    order_id: int,
    request: Request,
    account: PatientAccount,
    db: Database,
    response: Response,
    lang: Literal['en', 'te', 'hi'] = 'en',
) -> dict[str, object]:
    order = db.scalar(_account_order_query(account.id, order_id))
    if order is None:
        raise HTTPException(status_code=404, detail='Report not found.')
    results = _result_rows(db, account.id, order.id)
    summaries = _summary_rows(db, account.id, order.id, lang)
    payload = _report_payload(order, results, summaries, _account_flagged_summary_ids(db, account.id), lang)
    db.add(_access_log(request, order.id, 'report_view'))
    db.commit()
    response.headers['Cache-Control'] = 'private, no-store, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return payload


@router.get('/orders/{order_id}/pdf')
def download_patient_report_pdf(
    order_id: int,
    request: Request,
    account: PatientAccount,
    db: Database,
) -> StreamingResponse:
    order = db.scalar(_account_order_query(account.id, order_id))
    if order is None:
        raise HTTPException(status_code=404, detail='Report not found.')
    results = _result_rows(db, account.id, order.id)
    summaries = _summary_rows(db, account.id, order.id, 'en')
    payload = _report_payload(order, results, summaries, _account_flagged_summary_ids(db, account.id), 'en')
    lines = [
        f'Lab report: {order.order_no}',
        f'Patient: {order.patient.name}',
        f'Signed: {order.signed_off_at.isoformat() if order.signed_off_at else "Not signed"}',
        '',
    ]
    for result in payload['results']:
        lines.append(f'{result["name"]}: Contact the lab' if result['flag'] == 'critical' else f'{result["name"]}: {result["value"]} {result["unit"] or ""} ({result["flag"]})')
        if result['summary']:
            lines.append(str(result['summary']))
    pdf = _pdf_document(lines)
    db.add(_access_log(request, order.id, 'pdf_download'))
    db.commit()
    return StreamingResponse(
        iter([pdf]),
        media_type='application/pdf',
        headers={
            'Cache-Control': 'private, no-store, max-age=0',
            'Pragma': 'no-cache',
            'Content-Disposition': f'attachment; filename="{order.order_no}.pdf"',
        },
    )


@router.put('/summaries/{summary_id}/flag')
def flag_patient_summary(
    summary_id: int,
    payload: SummaryFlagToggle,
    account: PatientAccount,
    db: Database,
) -> dict[str, object]:
    summary = db.scalar(
        select(Summary)
        .join(Order, Order.id == Summary.order_id)
        .join(AccountPatient, AccountPatient.patient_id == Order.patient_id)
        .where(AccountPatient.account_id == account.id, Summary.id == summary_id)
    )
    if summary is None:
        raise HTTPException(status_code=404, detail='Summary not found.')
    summary.flagged_by_patient = payload.flagged
    db.commit()
    return {
        'summary_id': summary.id,
        'flagged': summary.flagged_by_patient,
        'review_status': summary.review_status,
    }


@summary_router.post('/api/summaries/{summary_id}/flag')
def report_summary_problem(
    summary_id: int,
    payload: SummaryProblemReport,
    account: PatientAccount,
    db: Database,
) -> dict[str, object]:
    summary = db.scalar(
        select(Summary)
        .join(Order, Order.id == Summary.order_id)
        .join(AccountPatient, AccountPatient.patient_id == Order.patient_id)
        .where(AccountPatient.account_id == account.id, Summary.id == summary_id)
        .with_for_update()
    )
    if summary is None:
        exists = db.scalar(select(Summary.id).where(Summary.id == summary_id))
        if exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Summary not found.')
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='You cannot report on this summary.')

    db.scalar(select(Account).where(Account.id == account.id).with_for_update())
    existing = db.scalar(select(SummaryProblemFlag).where(
        SummaryProblemFlag.account_id == account.id,
        SummaryProblemFlag.summary_id == summary.id,
    ))
    if existing is not None:
        return {
            'summary_id': summary.id,
            'flagged': True,
            'reason': existing.reason,
            'created_at': existing.created_at.isoformat(),
        }

    now = utc_now()
    limit_window = now - timedelta(hours=1)
    recent_count = db.scalar(select(func.count(SummaryProblemFlag.id)).where(
        SummaryProblemFlag.account_id == account.id,
        SummaryProblemFlag.created_at >= limit_window,
    )) or 0
    if recent_count >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={'code': 'rate_limited', 'message': 'Please wait before reporting another summary.', 'retry_after': 3600},
            headers={'Retry-After': '3600'},
        )

    flag = SummaryProblemFlag(account_id=account.id, summary_id=summary.id, reason=payload.reason)
    db.add(flag)
    db.commit()
    db.refresh(flag)
    return {
        'summary_id': summary.id,
        'flagged': True,
        'reason': flag.reason,
        'created_at': flag.created_at.isoformat(),
    }


@router.post('/orders/{order_id}/links', status_code=status.HTTP_201_CREATED)
def create_patient_report_link(
    order_id: int,
    account: PatientAccount,
    db: Database,
) -> dict[str, str]:
    order = db.scalar(_account_order_query(account.id, order_id))
    if order is None:
        raise HTTPException(status_code=404, detail='Report not found.')
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(hours=get_settings().link_ttl_hours)
    db.add(ReportLink(
        order_id=order.id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=expires_at,
    ))
    db.commit()
    return {'url': f'/r/{token}', 'expires_at': expires_at.isoformat()}

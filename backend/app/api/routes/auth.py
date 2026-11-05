from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.config import get_settings
from app.core.clock import utc_now
from app.core.patient_auth import PATIENT_COOKIE_NAME, create_patient_session_token
from app.core.patient_auth import Database
from app.models.domain import Account, AccountPatient, OtpChallenge, Order, Patient, ReportLink
from app.services.notifications import DemoNotificationProvider

router = APIRouter()
public_router = APIRouter()
settings = get_settings()


def normalise_mobile(value: str) -> str:
    digits = ''.join(ch for ch in value if ch.isdigit())
    if len(digits) == 11 and digits.startswith('0'):
        digits = digits[1:]
    if len(digits) == 12 and digits.startswith('91'):
        return '+' + digits
    if len(digits) == 10:
        return '+91' + digits
    raise ValueError('Enter a valid 10-digit mobile number.')


def mobile_hash(value: str) -> str:
    return hashlib.sha256(normalise_mobile(value).encode('utf-8')).hexdigest()


def _otp_hash(challenge_id: str, code: str) -> str:
    secret = get_settings().jwt_secret.encode()
    return hmac.new(secret, f'{challenge_id}:{code}'.encode(), hashlib.sha256).hexdigest()


def _mask_mobile(value: str) -> str:
    return f'{value[:3]}******{value[-2:]}'


def _mobile_storage_candidates(value: str) -> tuple[str, ...]:
    digits = value.removeprefix('+')
    national = digits[-10:]
    return (value, digits, national, '0' + national)


class OtpRequest(BaseModel):
    mobile: str = Field(..., min_length=10, max_length=32)
    consent: bool = False
    consent_version: str = Field(default='dpdp-v1', max_length=32)
    link_token: str | None = Field(default=None, max_length=128)


class OtpVerify(BaseModel):
    challenge_id: str = Field(..., min_length=20, max_length=64)
    code: str = Field(..., min_length=4, max_length=6)


_demo_outbox: list[dict[str, str]] = []
_demo_provider = DemoNotificationProvider(_demo_outbox)


@router.post('/otp/request', status_code=status.HTTP_202_ACCEPTED)
def request_otp(payload: OtpRequest, db: Database) -> dict[str, object]:
    try:
        mobile = normalise_mobile(payload.mobile)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not payload.consent:
        raise HTTPException(status_code=400, detail='Consent is required to receive a report link.')
    if not settings.demo_mode:
        raise HTTPException(status_code=503, detail='OTP delivery is not configured.')

    link = None
    if payload.link_token:
        link = db.scalar(select(ReportLink).where(
            ReportLink.token_hash == hashlib.sha256(payload.link_token.encode()).hexdigest(),
            ReportLink.revoked_at.is_(None),
        ))
        if link is None:
            raise HTTPException(status_code=404, detail='This report link is not valid.')
        # A link-bound challenge may be requested before an account exists; validate
        # the supplied mobile against the order without returning patient details.
        patient = db.scalar(
            select(Patient)
            .join(Order, Order.patient_id == Patient.id)
            .where(Order.id == link.order_id)
        )
        if patient is None or mobile_hash(patient.mobile) != mobile_hash(mobile):
            raise HTTPException(status_code=403, detail='Mobile number does not match this report.')

    phone_digest = hashlib.sha256(mobile.encode('utf-8')).hexdigest()
    now = utc_now()
    recent_count = db.scalar(
        select(func.count(OtpChallenge.id)).where(
            OtpChallenge.mobile_hash == phone_digest,
            OtpChallenge.created_at >= now - timedelta(minutes=1),
        ),
    ) or 0
    if recent_count >= 3:
        raise HTTPException(
            status_code=429,
            detail={'code': 'rate_limited', 'message': 'Please wait before requesting another code.', 'retry_after': 60},
            headers={'Retry-After': '60'},
        )

    account = db.scalar(select(Account).where(Account.mobile_hash == phone_digest))
    challenge_id = secrets.token_urlsafe(24)
    code = '123456'
    challenge = OtpChallenge(
        challenge_id=challenge_id,
        account_id=account.id if account else None,
        report_link_id=link.id if link else None,
        mobile_hash=phone_digest,
        mobile_enc=Fernet(settings.encryption_key.encode()).encrypt(mobile.encode()).decode(),
        consent_version=payload.consent_version,
        code_hash=_otp_hash(challenge_id, code),
        expires_at=now + timedelta(minutes=settings.otp_ttl_minutes),
    )
    db.add(challenge)
    db.flush()
    _demo_provider.send(mobile, f'Demo OTP: {code} (valid for {settings.otp_ttl_minutes} minutes)')
    _demo_outbox.append({'challenge_id': challenge_id, 'mobile': mobile, 'code': code})
    db.commit()
    return {
        'challenge_id': challenge_id,
        'masked_mobile': _mask_mobile(mobile),
        'expires_at': challenge.expires_at.isoformat(),
        'demo_mode': True,
    }


@router.post('/otp/verify')
def verify_otp(payload: OtpVerify, response: Response, db: Database) -> dict[str, object]:
    challenge = db.scalar(
        select(OtpChallenge).where(OtpChallenge.challenge_id == payload.challenge_id),
    )
    if challenge is None:
        raise HTTPException(status_code=404, detail='OTP challenge not found.')
    now = utc_now()
    expires_at = challenge.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise HTTPException(status_code=410, detail={'code': 'otp_expired', 'message': 'This code has expired.'})
    if challenge.verified:
        raise HTTPException(status_code=409, detail='This code has already been used.')
    remaining = max(settings.otp_max_attempts - challenge.attempts, 0)
    if remaining == 0:
        raise HTTPException(
            status_code=429,
            detail={'code': 'rate_limited', 'message': 'Too many incorrect codes. Request a new one.', 'retry_after': 0},
            headers={'Retry-After': '0'},
        )
    if not hmac.compare_digest(challenge.code_hash, _otp_hash(payload.challenge_id, payload.code)):
        challenge.attempts += 1
        remaining = max(settings.otp_max_attempts - challenge.attempts, 0)
        db.commit()
        if remaining == 0:
            raise HTTPException(
                status_code=429,
                detail={'code': 'rate_limited', 'message': 'Too many incorrect codes. Request a new one.', 'retry_after': 0, 'attempts_remaining': 0},
                headers={'Retry-After': '0'},
            )
        raise HTTPException(
            status_code=401,
            detail={'code': 'invalid_otp', 'message': 'That code is not correct.', 'attempts_remaining': remaining},
        )

    link = db.get(ReportLink, challenge.report_link_id) if challenge.report_link_id else None
    if link and link.revoked_at is not None:
        raise HTTPException(status_code=410, detail={'code': 'link_expired', 'message': 'This report link is no longer available.'})
    renewed_link_url = None
    if link:
        link_expires_at = link.expires_at
        if link_expires_at.tzinfo is None:
            link_expires_at = link_expires_at.replace(tzinfo=timezone.utc)
        if link_expires_at <= now:
            renewed_token = secrets.token_urlsafe(32)
            db.add(ReportLink(
                order_id=link.order_id,
                token_hash=hashlib.sha256(renewed_token.encode()).hexdigest(),
                expires_at=now + timedelta(hours=settings.link_ttl_hours),
            ))
            renewed_link_url = f'/r/{renewed_token}'

    account = db.get(Account, challenge.account_id) if challenge.account_id else None
    mobile = Fernet(settings.encryption_key.encode()).decrypt(challenge.mobile_enc.encode()).decode()
    if link:
        patient = db.scalar(
            select(Patient)
            .join(Order, Order.patient_id == Patient.id)
            .where(Order.id == link.order_id)
        )
        if patient is None:
            raise HTTPException(status_code=404, detail='Report not found.')
        if mobile_hash(patient.mobile) != challenge.mobile_hash:
            raise HTTPException(status_code=403, detail='Mobile number does not match this report.')

    if account is None:
        account = db.scalar(select(Account).where(Account.mobile_hash == challenge.mobile_hash))
    if account is None:
        account = Account(
            mobile_hash=challenge.mobile_hash,
            mobile_enc=Fernet(settings.encryption_key.encode()).encrypt(mobile.encode()).decode(),
            consent_at=now,
            consent_version=challenge.consent_version,
        )
        db.add(account)
        db.flush()
    else:
        account.consent_at = now
        account.consent_version = challenge.consent_version

    if link:
        linked_patient = db.scalar(
            select(Patient)
            .join(Order, Order.patient_id == Patient.id)
            .where(Order.id == link.order_id)
        )
        if linked_patient is None:
            raise HTTPException(status_code=404, detail='Report not found.')
        patients = db.scalars(
            select(Patient).where(Patient.mobile.in_(_mobile_storage_candidates(mobile))),
        ).all()
        patients = [
            candidate for candidate in patients
            if mobile_hash(candidate.mobile) == challenge.mobile_hash
        ]
    else:
        candidates = db.scalars(
            select(Patient).where(Patient.mobile.in_(_mobile_storage_candidates(mobile))),
        ).all()
        patients = [
            candidate for candidate in candidates
            if mobile_hash(candidate.mobile) == challenge.mobile_hash
        ]
    for linked_patient in patients:
        existing = db.scalar(select(AccountPatient.id).where(
            AccountPatient.account_id == account.id,
            AccountPatient.patient_id == linked_patient.id,
        ))
        if existing is None:
            db.add(AccountPatient(account_id=account.id, patient_id=linked_patient.id))
    challenge.account_id = account.id
    challenge.verified = True
    db.commit()

    response.set_cookie(
        key=PATIENT_COOKIE_NAME,
        value=create_patient_session_token(account.id),
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite='lax',
        max_age=settings.auth_token_ttl_hours * 60 * 60,
        path='/api',
    )
    next_order_id = link.order_id if link else None
    return {
        'status': 'verified',
        'account': {'id': account.id, 'mobile_masked': _mask_mobile(mobile)},
        'next_order_id': next_order_id,
        'renewed_link_url': renewed_link_url,
    }


@router.get('/demo/outbox/{challenge_id}')
def demo_outbox(challenge_id: str) -> dict[str, str]:
    if not settings.demo_mode:
        raise HTTPException(status_code=404, detail='Not found.')
    item = next((entry for entry in reversed(_demo_outbox) if entry.get('challenge_id') == challenge_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail='Demo code not found.')
    return {'challenge_id': challenge_id, 'code': item['code']}


@public_router.get('/r/{token}')
def validate_report_link(token: str, db: Database) -> dict[str, object]:
    link = db.scalar(
        select(ReportLink).where(ReportLink.token_hash == hashlib.sha256(token.encode()).hexdigest()),
    )
    if link is None or link.revoked_at is not None:
        raise HTTPException(status_code=404, detail='This report link is not valid.')
    expires_at = link.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    order_id = link.order_id
    if expires_at <= utc_now():
        raise HTTPException(
            status_code=410,
            detail={'code': 'link_expired', 'message': 'This report link has expired.', 'renewal_available': True},
        )
    patient = db.scalar(select(Patient).join(Order, Order.patient_id == Patient.id).where(Order.id == order_id))
    if patient is None:
        raise HTTPException(status_code=404, detail='This report link is not valid.')
    mobile = normalise_mobile(patient.mobile)
    return {
        'status': 'otp_required',
        'masked_mobile': _mask_mobile(mobile),
        'expires_at': expires_at.isoformat(),
    }


@router.get('/links/{token}')
def validate_report_link_api(token: str, db: Database) -> dict[str, object]:
    return validate_report_link(token, db)

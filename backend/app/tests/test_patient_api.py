from __future__ import annotations

import hashlib
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models.domain import (
    AccessLog,
    Account,
    AccountPatient,
    FlagStatus,
    Order,
    OtpChallenge,
    Patient,
    ReportLink,
    Result,
    Summary,
    SummaryProblemFlag,
)


@pytest.fixture
def patient_client() -> Generator[tuple[TestClient, sessionmaker[Session], str, str], None, None]:
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    test_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with test_session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    now = datetime.now(timezone.utc)
    with test_session() as db:
        patient_a = Patient(name='Ananya Rao', mobile='9876543210')
        patient_b = Patient(name='Vivek Nair', mobile='9876543211')
        order_a = Order(order_no='ORD-1001', patient=patient_a, status='ready', signed_off_at=now)
        order_b = Order(order_no='ORD-1002', patient=patient_b, status='ready', signed_off_at=now)
        low_result = Result(
            parameter='Haemoglobin',
            value='10.2',
            unit='g/dL',
            reference_range='12.0-15.5',
            flag=FlagStatus.low,
        )
        critical_result = Result(
            parameter='Potassium',
            value='6.8',
            unit='mEq/L',
            reference_range='3.5-5.1',
            flag=FlagStatus.critical,
        )
        order_a.results.extend([low_result, critical_result])
        order_b.results.append(Result(parameter='LDL', value='142', unit='mg/dL', reference_range='0-100', flag=FlagStatus.high))
        account_a = Account(mobile_hash=hashlib.sha256(b'+919876543210').hexdigest(), mobile_enc='encrypted-a')
        account_b = Account(mobile_hash=hashlib.sha256(b'+919876543211').hexdigest(), mobile_enc='encrypted-b')
        account_a.patients.append(AccountPatient(patient=patient_a))
        account_b.patients.append(AccountPatient(patient=patient_b))
        db.add_all([order_a, order_b, account_a, account_b])
        db.flush()
        db.add_all([
            Summary(order_id=order_a.id, result_id=low_result.id, lang='en', text='Below the usual range.'),
            Summary(order_id=order_a.id, result_id=low_result.id, lang='te', text='సాధారణ పరిధి కంటే తక్కువ.'),
            Summary(order_id=order_a.id, result_id=low_result.id, lang='hi', text='सामान्य सीमा से कम।'),
            Summary(order_id=order_b.id, result_id=order_b.results[0].id, lang='en', text='High.'),
        ])
        valid_token = 'valid-link-token-for-order-one'
        expired_token = 'expired-link-token-for-order-one'
        db.add_all([
            ReportLink(
                order_id=order_a.id,
                token_hash=hashlib.sha256(valid_token.encode()).hexdigest(),
                expires_at=now + timedelta(hours=1),
            ),
            ReportLink(
                order_id=order_a.id,
                token_hash=hashlib.sha256(expired_token.encode()).hexdigest(),
                expires_at=now - timedelta(hours=1),
            ),
        ])
        db.commit()

    with TestClient(app) as client:
        yield client, test_session, valid_token, expired_token

    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def _login(client: TestClient, mobile: str = '9876543210') -> str:
    requested = client.post('/api/auth/otp/request', json={
        'mobile': mobile,
        'consent': True,
        'consent_version': 'dpdp-v1',
    })
    assert requested.status_code == 202
    challenge_id = requested.json()['challenge_id']
    demo_code = client.get(f'/api/auth/demo/outbox/{challenge_id}')
    assert demo_code.status_code == 200
    verified = client.post('/api/auth/otp/verify', json={
        'challenge_id': challenge_id,
        'code': demo_code.json()['code'],
    })
    assert verified.status_code == 200
    return challenge_id


def test_patient_otp_session_cookie_me_and_family_lists(patient_client: Any) -> None:
    client, _, _, _ = patient_client
    requested = client.post('/api/auth/otp/request', json={'mobile': '9876543210', 'consent': True})
    assert requested.status_code == 202
    challenge_id = requested.json()['challenge_id']
    assert client.get(f'/api/auth/demo/outbox/{challenge_id}').json()['code'] == '123456'

    wrong = client.post('/api/auth/otp/verify', json={'challenge_id': challenge_id, 'code': '000000'})
    assert wrong.status_code == 401
    assert wrong.json()['detail']['attempts_remaining'] == 4
    verified = client.post('/api/auth/otp/verify', json={'challenge_id': challenge_id, 'code': '123456'})
    assert verified.status_code == 200
    assert 'lab_patient_session' in verified.headers['set-cookie']
    assert 'httponly' in verified.headers['set-cookie'].lower()
    assert client.get('/api/patient/me').json()['patients'] == [{'id': 1, 'name': 'Ananya Rao'}]
    patients = client.get('/api/patient/patients')
    assert patients.status_code == 200
    assert [patient['name'] for patient in patients.json()['patients']] == ['Ananya Rao']
    orders = client.get('/api/patient/patients/1/orders')
    assert orders.status_code == 200
    assert orders.json()['orders'][0]['order_no'] == 'ORD-1001'
    assert orders.json()['orders'][0]['signed_at']
    assert client.post('/api/patient/logout').status_code == 204
    assert client.get('/api/patient/me').status_code == 401


def test_link_validation_otp_is_bound_and_expired_link_can_be_renewed(patient_client: Any) -> None:
    client, _, valid_token, expired_token = patient_client
    assert client.get(f'/r/{valid_token}').json()['status'] == 'otp_required'
    assert client.get(f'/r/{expired_token}').status_code == 410
    assert client.get('/r/not-a-real-token').status_code == 404

    wrong_phone = client.post('/api/auth/otp/request', json={
        'mobile': '9876543211',
        'consent': True,
        'link_token': expired_token,
    })
    assert wrong_phone.status_code == 403
    challenge = client.post('/api/auth/otp/request', json={
        'mobile': '9876543210',
        'consent': True,
        'link_token': expired_token,
    }).json()['challenge_id']
    verified = client.post('/api/auth/otp/verify', json={'challenge_id': challenge, 'code': '123456'})
    assert verified.status_code == 200
    renewed_link = verified.json()['renewed_link_url']
    assert renewed_link.startswith('/r/')
    new_token = renewed_link.removeprefix('/r/')
    assert client.get(f'/r/{new_token}').status_code == 200


def test_patient_report_language_critical_suppression_pdf_headers_and_access_logs(patient_client: Any) -> None:
    client, session_factory, _, _ = patient_client
    _login(client)
    report = client.get('/api/patient/orders/1?lang=en')
    assert report.status_code == 200
    assert report.headers['cache-control'] == 'private, no-store, max-age=0'
    data = report.json()
    assert data['language'] == 'en'
    assert data['results'][0]['summary'] == 'Below the usual range.'
    assert data['results'][0]['summary_id'] == 1
    critical = data['results'][1]
    assert critical['flag'] == 'critical'
    assert critical['value'] is None
    assert critical['unit'] is None
    assert critical['reference_range'] is None
    assert critical['summary'] is None

    telugu = client.get('/api/patient/orders/1?lang=te')
    assert telugu.json()['results'][0]['summary'] == 'సాధారణ పరిధి కంటే తక్కువ.'
    pdf = client.get('/api/patient/orders/1/pdf')
    assert pdf.status_code == 200
    assert pdf.headers['content-type'].startswith('application/pdf')
    assert pdf.headers['cache-control'] == 'private, no-store, max-age=0'
    assert pdf.content.startswith(b'%PDF-1.4\n')
    assert b'6.8' not in pdf.content

    with session_factory() as db:
        logs = db.scalars(select(AccessLog).where(AccessLog.order_id == 1)).all()
        assert [log.action for log in logs].count('report_view') == 2
        assert [log.action for log in logs].count('pdf_download') == 1


def test_patient_idor_is_rejected_for_orders_reports_pdf_flags_and_links(patient_client: Any) -> None:
    client, _, _, _ = patient_client
    _login(client)
    assert client.get('/api/patient/patients/2/orders').status_code == 404
    assert client.get('/api/patient/orders/2?lang=en').status_code == 404
    assert client.get('/api/patient/orders/2/pdf').status_code == 404
    assert client.put('/api/patient/summaries/4/flag', json={'flagged': True}).status_code == 404
    assert client.post('/api/patient/orders/2/links').status_code == 404


def test_summary_flagging_is_idempotent_and_requires_patient_session(patient_client: Any) -> None:
    client, _, _, _ = patient_client
    assert client.put('/api/patient/summaries/1/flag', json={'flagged': True}).status_code == 401
    _login(client)
    flagged = client.put('/api/patient/summaries/1/flag', json={'flagged': True})
    assert flagged.status_code == 200
    assert flagged.json()['flagged'] is True
    unflagged = client.put('/api/patient/summaries/1/flag', json={'flagged': False})
    assert unflagged.status_code == 200
    assert unflagged.json()['flagged'] is False


def test_summary_problem_flag_is_idempotent_and_preserves_original_reason(patient_client: Any) -> None:
    client, session_factory, _, _ = patient_client
    assert client.post('/api/summaries/1/flag', json={'reason': 'unclear'}).status_code == 401
    _login(client)
    first = client.post('/api/summaries/1/flag', json={'reason': 'The explanation is unclear.'})
    duplicate = client.post('/api/summaries/1/flag', json={'reason': 'A changed reason should not replace it.'})
    assert first.status_code == 200
    assert duplicate.status_code == 200
    assert first.json()['flagged'] is True
    assert duplicate.json()['reason'] == 'The explanation is unclear.'
    with session_factory() as db:
        rows = db.scalars(select(SummaryProblemFlag).where(
            SummaryProblemFlag.account_id == 1,
            SummaryProblemFlag.summary_id == 1,
        )).all()
        assert len(rows) == 1


def test_summary_problem_flag_rejects_other_accounts_and_overlong_reason(patient_client: Any) -> None:
    client, _, _, _ = patient_client
    _login(client)
    assert client.post('/api/summaries/4/flag', json={'reason': 'Not mine'}).status_code == 403
    assert client.post('/api/summaries/1/flag', json={'reason': 'x' * 301}).status_code == 422


def test_summary_problem_flags_are_rate_limited_per_account(patient_client: Any) -> None:
    client, session_factory, _, _ = patient_client
    _login(client)
    with session_factory() as db:
        summaries = [Summary(order_id=1, lang='en', text=f'Additional summary {index}') for index in range(5)]
        db.add_all(summaries)
        db.flush()
        ids = [summary.id for summary in summaries]
        db.commit()
    for summary_id in [1, *ids[:4]]:
        assert client.post(f'/api/summaries/{summary_id}/flag', json={}).status_code == 200
    limited = client.post(f'/api/summaries/{ids[4]}/flag', json={})
    assert limited.status_code == 429
    assert limited.headers['retry-after'] == '3600'


def test_patient_can_issue_an_order_scoped_report_link(patient_client: Any) -> None:
    client, _, _, _ = patient_client
    _login(client)
    created = client.post('/api/patient/orders/1/links')
    assert created.status_code == 201
    token = created.json()['url'].removeprefix('/r/')
    assert client.get(f'/r/{token}').status_code == 200


def test_otp_request_rate_limit_and_exhausted_attempts(patient_client: Any) -> None:
    client, _, _, _ = patient_client
    challenges = []
    for _ in range(3):
        response = client.post('/api/auth/otp/request', json={'mobile': '9876543210', 'consent': True})
        assert response.status_code == 202
        challenges.append(response.json()['challenge_id'])
    limited = client.post('/api/auth/otp/request', json={'mobile': '9876543210', 'consent': True})
    assert limited.status_code == 429
    assert limited.json()['detail']['retry_after'] == 60
    for attempt in range(5):
        response = client.post('/api/auth/otp/verify', json={'challenge_id': challenges[0], 'code': '000000'})
        assert response.status_code == (429 if attempt == 4 else 401)


def test_expired_otp_challenge_is_rejected(patient_client: Any) -> None:
    client, session_factory, _, _ = patient_client
    with session_factory() as db:
        from app.api.routes.auth import _otp_hash
        from app.config import get_settings
        from cryptography.fernet import Fernet

        mobile = '+919876543210'
        challenge_id = 'expired-challenge-reference-123'
        db.add(OtpChallenge(
            challenge_id=challenge_id,
            mobile_hash=hashlib.sha256(mobile.encode()).hexdigest(),
            mobile_enc=Fernet(get_settings().encryption_key.encode()).encrypt(mobile.encode()).decode(),
            consent_version='dpdp-v1',
            code_hash=_otp_hash(challenge_id, '123456'),
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        ))
        db.commit()
    response = client.post('/api/auth/otp/verify', json={'challenge_id': challenge_id, 'code': '123456'})
    assert response.status_code == 410

from __future__ import annotations

from collections.abc import Generator

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db import Base, get_db
from app.main import app
from app.models.domain import (
    Account,
    AccountPatient,
    FlagStatus,
    Notification,
    NotificationStatus,
    Order,
    Patient,
    Result,
    StaffUser,
    Summary,
    SummaryProblemFlag,
)


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
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
    with test_session() as db:
        db.add(StaffUser(
            email='staff@example.com',
            password_hash=PasswordHasher().hash('password123'),
            role='front_desk',
        ))
        db.add_all([
            StaffUser(email='ops@example.com', password_hash=PasswordHasher().hash('password123'), role='ops'),
            StaffUser(email='pathologist@example.com', password_hash=PasswordHasher().hash('password123'), role='pathologist'),
        ])
        patient = Patient(name='Demo Patient One', mobile='9876543210')
        order = Order(order_no='ORD-1001', patient=patient, status='ready')
        flagged_result = Result(parameter='Haemoglobin', value='10.2', unit='g/dL', reference_range='12-15', flag=FlagStatus.low)
        regular_result = Result(parameter='Glucose', value='90', unit='mg/dL', reference_range='70-100', flag=FlagStatus.normal)
        order.results.extend([flagged_result, regular_result])
        db.add(order)
        db.flush()
        flagged_summary = Summary(order_id=order.id, result_id=flagged_result.id, lang='en', text='Below range.')
        regular_summary = Summary(order_id=order.id, result_id=regular_result.id, lang='en', text='Within range.')
        account = Account(mobile_hash='test-account-hash', mobile_enc='encrypted')
        account.patients.append(AccountPatient(patient=patient))
        db.add_all([flagged_summary, regular_summary, account])
        db.flush()
        db.add(SummaryProblemFlag(account_id=account.id, summary_id=flagged_summary.id, reason='The text is confusing.'))
        db.commit()

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_staff_login_requires_valid_credentials(client: TestClient) -> None:
    rejected = client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'wrong'})
    assert rejected.status_code == 401

    accepted = client.post('/api/staff/login', json={'email': 'STAFF@example.com', 'password': 'password123'})
    assert accepted.status_code == 200
    assert accepted.json()['user'] == {'id': 1, 'email': 'staff@example.com', 'role': 'front_desk'}
    assert 'httponly' in accepted.headers['set-cookie'].lower()


def test_staff_login_is_rate_limited_after_five_failures(client: TestClient) -> None:
    for _ in range(5):
        response = client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'wrong'})
        assert response.status_code == 401
    limited = client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'password123'})
    assert limited.status_code == 429
    assert limited.headers['Retry-After'] == '900'


def test_staff_session_protects_database_orders_and_logout(client: TestClient) -> None:
    assert client.get('/api/staff/orders').status_code == 401
    assert client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'password123'}).status_code == 200

    session = client.get('/api/staff/me')
    assert session.status_code == 200
    assert session.json()['user']['email'] == 'staff@example.com'

    orders = client.get('/api/staff/orders')
    assert orders.status_code == 200
    assert orders.json()['orders'][0]['order'] == 'ORD-1001'

    queued = client.post('/api/staff/orders/1/resend', json={'confirmed': True})
    assert queued.status_code == 202
    assert queued.json()['status'] == 'queued'
    assert client.post('/api/staff/orders/999/resend', json={'confirmed': True}).status_code == 404

    assert client.post('/api/staff/logout').status_code == 204
    assert client.get('/api/staff/me').status_code == 401


def test_staff_orders_masks_mobile_and_reveal_is_audited(client: TestClient) -> None:
    client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'password123'})
    orders = client.get('/api/staff/orders?search=9876543210')
    assert orders.status_code == 200
    order = orders.json()['orders'][0]
    assert order['mobile'] == '98••••3210'
    assert order['delivery_state'] == 'not_sent'

    revealed = client.post(f"/api/staff/orders/{order['id']}/reveal-mobile")
    assert revealed.status_code == 200
    assert revealed.json()['mobile'] == '9876543210'
    logs = client.get(f"/api/staff/orders/{order['id']}/access-logs").json()['access_logs']
    assert logs[0]['action'] == 'mobile_reveal'
    assert logs[0]['actor'] == 'staff:1'


def test_resend_requires_confirmation_and_is_rate_limited(client: TestClient) -> None:
    client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'password123'})
    assert client.post('/api/staff/orders/1/resend', json={'confirmed': False}).status_code == 400
    for _ in range(3):
        response = client.post('/api/staff/orders/1/resend', json={'confirmed': True})
        assert response.status_code == 202
    limited = client.post('/api/staff/orders/1/resend', json={'confirmed': True})
    assert limited.status_code == 429
    outbox = client.get('/api/staff/outbox').json()['messages']
    assert any('DEMO-' not in message['body'] and '/r/' in message['body'] for message in outbox)


def test_pathologist_review_queue_prioritizes_patient_flags_and_reasons(client: TestClient) -> None:
    client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'password123'})
    response = client.get('/api/staff/summaries/review')
    assert response.status_code == 200
    summaries = response.json()['summaries']
    assert summaries[0]['flagged'] is True
    assert summaries[0]['reasons'] == ['The text is confusing.']
    assert summaries[1]['flagged'] is False


def test_demo_outbox_is_role_limited_and_returns_masked_message_metadata(client: TestClient) -> None:
    client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'password123'})
    assert client.get('/api/staff/outbox').status_code == 200

    client.post('/api/staff/logout')
    client.post('/api/staff/login', json={'email': 'ops@example.com', 'password': 'password123'})
    assert client.get('/api/staff/outbox').status_code == 200

    client.post('/api/staff/logout')
    client.post('/api/staff/login', json={'email': 'pathologist@example.com', 'password': 'password123'})
    assert client.get('/api/staff/outbox').status_code == 403


def test_demo_outbox_is_hidden_when_demo_mode_is_disabled(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr('app.api.routes.staff.get_settings', lambda: Settings(demo_mode=False))
    client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'password123'})
    assert client.get('/api/staff/outbox').status_code == 404


def test_demo_outbox_lists_only_the_latest_50_messages_with_masked_recipients(client: TestClient) -> None:
    db_generator = app.dependency_overrides[get_db]()
    db = next(db_generator)
    try:
        db.add_all([
            Notification(
                channel='sms',
                recipient='987******10',
                purpose='otp',
                payload=f'Demo OTP: {index:06d}',
                status=NotificationStatus.sent,
            )
            for index in range(51)
        ])
        db.commit()
    finally:
        db_generator.close()

    client.post('/api/staff/login', json={'email': 'staff@example.com', 'password': 'password123'})
    response = client.get('/api/staff/outbox')
    assert response.status_code == 200
    messages = response.json()['messages']
    assert len(messages) == 50
    assert messages[0]['body'] == 'Demo OTP: 000050'
    assert messages[0]['purpose'] == 'otp'
    assert messages[0]['recipient'] == '987******10'
    assert {'time', 'channel', 'status'} <= messages[0].keys()

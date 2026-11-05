from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import app


client = TestClient(app)


@pytest.mark.parametrize(
    ('overrides', 'message'),
    [
        ({'jwt_secret': 'short', 'demo_mode': False, 'auth_cookie_secure': True}, 'JWT_SECRET'),
        ({'jwt_secret': 's' * 32, 'demo_mode': True, 'auth_cookie_secure': True}, 'DEMO_MODE'),
        ({'jwt_secret': 's' * 32, 'demo_mode': False, 'auth_cookie_secure': False}, 'AUTH_COOKIE_SECURE'),
    ],
)
def test_production_settings_reject_unsafe_values(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        Settings(environment='production', **overrides)


def test_production_settings_require_process_environment_not_dotenv() -> None:
    assert Settings.model_config['env_file'] is None


def test_security_headers_and_request_id_are_returned() -> None:
    response = client.get('/', headers={'X-Request-ID': 'test-request-123'})

    assert response.status_code == 200
    assert response.headers['X-Request-ID'] == 'test-request-123'
    assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
    assert response.headers['Strict-Transport-Security'].startswith('max-age=')
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert response.headers['Referrer-Policy'] == 'strict-origin-when-cross-origin'


def test_cookie_auth_rejects_cross_origin_state_changes() -> None:
    response = client.post(
        '/api/staff/logout',
        headers={
            'Cookie': 'lab_staff_session=session-placeholder',
            'Origin': 'https://attacker.invalid',
        },
    )

    assert response.status_code == 403


def test_cookie_auth_rejects_cross_site_fetch_metadata() -> None:
    response = client.post(
        '/api/staff/logout',
        headers={
            'Cookie': 'lab_staff_session=session-placeholder',
            'Sec-Fetch-Site': 'cross-site',
        },
    )

    assert response.status_code == 403


def test_cookie_auth_allows_same_origin_and_api_clients_without_origin() -> None:
    same_origin = client.post(
        '/api/staff/logout',
        headers={
            'Cookie': 'lab_staff_session=session-placeholder',
            'Origin': 'http://localhost:5173',
            'X-CSRF-Token': '1',
        },
    )
    api_client = client.post(
        '/api/staff/logout',
        headers={'Cookie': 'lab_staff_session=session-placeholder'},
    )

    assert same_origin.status_code != 403
    assert api_client.status_code != 403


def test_cookie_auth_rejects_browser_mutations_without_csrf_header() -> None:
    response = client.post(
        '/api/staff/logout',
        headers={
            'Cookie': 'lab_staff_session=session-placeholder',
            'Origin': 'http://localhost:5173',
        },
    )
    assert response.status_code == 403


def test_cors_is_restricted_to_the_configured_frontend_origin() -> None:
    allowed = client.options(
        '/api/staff/logout',
        headers={
            'Origin': 'http://localhost:5173',
            'Access-Control-Request-Method': 'POST',
        },
    )
    denied = client.options(
        '/api/staff/logout',
        headers={
            'Origin': 'https://attacker.invalid',
            'Access-Control-Request-Method': 'POST',
        },
    )

    assert allowed.headers['Access-Control-Allow-Origin'] == 'http://localhost:5173'
    assert 'Access-Control-Allow-Origin' not in denied.headers

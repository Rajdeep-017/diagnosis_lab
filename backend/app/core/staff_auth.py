from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models.domain import StaffUser

COOKIE_NAME = 'lab_staff_session'


def create_session_token(user: StaffUser) -> str:
    settings = get_settings()
    payload = {
        'sub': user.id,
        'role': user.role,
        'exp': int(time.time()) + settings.auth_token_ttl_hours * 60 * 60,
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(',', ':')).encode()).rstrip(b'=').decode()
    signature = hmac.new(settings.jwt_secret.encode(), encoded.encode(), hashlib.sha256).digest()
    signed = base64.urlsafe_b64encode(signature).rstrip(b'=').decode()
    return f'{encoded}.{signed}'


def get_session_user(token: str | None, db: Session) -> StaffUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Please sign in to continue.',
        headers={'WWW-Authenticate': 'Cookie'},
    )
    if not token:
        raise unauthorized

    try:
        encoded, supplied_signature = token.split('.', 1)
        expected = hmac.new(get_settings().jwt_secret.encode(), encoded.encode(), hashlib.sha256).digest()
        decoded_signature = base64.urlsafe_b64decode(supplied_signature + '=' * (-len(supplied_signature) % 4))
        if not hmac.compare_digest(expected, decoded_signature):
            raise unauthorized
        payload = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
        user_id = int(payload['sub'])
        if int(payload['exp']) <= int(time.time()):
            raise unauthorized
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise unauthorized from None

    user = db.get(StaffUser, user_id)
    if user is None:
        raise unauthorized
    return user


def request_staff_user(request: Request, db: Session = Depends(get_db)) -> StaffUser:
    return get_session_user(request.cookies.get(COOKIE_NAME), db)

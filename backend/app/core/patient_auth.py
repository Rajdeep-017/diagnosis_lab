from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models.domain import Account

PATIENT_COOKIE_NAME = 'lab_patient_session'


def create_patient_session_token(account_id: int) -> str:
    settings = get_settings()
    payload = {
        'sub': account_id,
        'exp': int(time.time()) + settings.auth_token_ttl_hours * 60 * 60,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(',', ':')).encode(),
    ).rstrip(b'=').decode()
    signature = hmac.new(settings.jwt_secret.encode(), encoded.encode(), hashlib.sha256).digest()
    signed = base64.urlsafe_b64encode(signature).rstrip(b'=').decode()
    return f'{encoded}.{signed}'


def get_patient_account(token: str | None, db: Session) -> Account:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Please verify your mobile number to continue.',
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
        account_id = int(payload['sub'])
        if int(payload['exp']) <= int(time.time()):
            raise unauthorized
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise unauthorized from None

    account = db.get(Account, account_id)
    if account is None:
        raise unauthorized
    return account


def request_patient_account(request: Request, db: Session = Depends(get_db)) -> Account:
    return get_patient_account(request.cookies.get(PATIENT_COOKIE_NAME), db)


PatientAccount = Annotated[Account, Depends(request_patient_account)]
Database = Annotated[Session, Depends(get_db)]

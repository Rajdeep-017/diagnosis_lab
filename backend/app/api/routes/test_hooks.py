from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.core.clock import advance_test_clock, reset_test_clock

router = APIRouter(prefix='/api/test', tags=['test hooks'])


class ClockAdvance(BaseModel):
    hours: int = Field(ge=0, le=168)


def _authorize_test_hook(x_e2e_token: Annotated[str | None, Header()] = None) -> None:
    settings = get_settings()
    if not settings.e2e_test_mode or not settings.e2e_test_token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Not found.')
    if x_e2e_token is None or not secrets.compare_digest(x_e2e_token, settings.e2e_test_token):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Not found.')


TestHookAccess = Annotated[None, Depends(_authorize_test_hook)]


@router.post('/clock/advance')
def advance_clock(payload: ClockAdvance, _: TestHookAccess) -> dict[str, str]:
    return {'now': advance_test_clock(payload.hours).isoformat()}


@router.post('/clock/reset')
def reset_clock(_: TestHookAccess) -> dict[str, str]:
    return {'now': reset_test_clock().isoformat()}

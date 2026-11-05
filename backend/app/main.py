from __future__ import annotations

import re
import time
import uuid
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.routes.auth import public_router as public_auth_router
from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.patient import router as patient_router, summary_router
from app.api.routes.staff import router as staff_router
from app.api.routes.test_hooks import router as test_hooks_router
from app.config import get_settings
from app.db import engine, get_db
from app.logging_config import configure_request_logging

settings = get_settings()
request_logger = configure_request_logging(settings.log_level)
request_id_pattern = re.compile(r'^[A-Za-z0-9._-]{8,128}$')
state_changing_methods = {'POST', 'PUT', 'PATCH', 'DELETE'}
session_cookie_names = {'lab_patient_session', 'lab_staff_session'}
security_headers = {
    'Content-Security-Policy': (
        "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; "
        "form-action 'self'; object-src 'none'; script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        "font-src 'self' data:; connect-src 'self'"
    ),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
}


def _origin(value: str) -> tuple[str, str, int | None] | None:
    parsed = urlsplit(value)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    return parsed.scheme.lower(), parsed.hostname.lower(), port


def _is_same_origin(value: str) -> bool:
    configured_origin = _origin(settings.frontend_origin)
    supplied_origin = _origin(value)
    return configured_origin is not None and supplied_origin == configured_origin


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    engine.dispose()


app = FastAPI(title='Lab report delivery portal', version='0.1.0', lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allow_headers=['Content-Type', 'X-CSRF-Token', 'X-Request-ID'],
    max_age=600,
)


@app.middleware('http')
async def production_security_middleware(request: Request, call_next) -> Response:
    request_id = request.headers.get('x-request-id', '')
    if not request_id_pattern.fullmatch(request_id):
        request_id = str(uuid.uuid4())
    request.state.request_id = request_id

    if request.method in state_changing_methods and session_cookie_names.intersection(request.cookies):
        fetch_site = request.headers.get('sec-fetch-site', '').lower()
        origin = request.headers.get('origin')
        referer = request.headers.get('referer')
        supplied_origin = origin or referer
        origin_is_invalid = supplied_origin is not None and not _is_same_origin(supplied_origin)
        fetch_site_is_invalid = bool(fetch_site and fetch_site != 'same-origin')
        csrf_header_missing = bool((supplied_origin or fetch_site) and not request.headers.get('x-csrf-token'))
        if origin_is_invalid or fetch_site_is_invalid or csrf_header_missing:
            response = JSONResponse({'detail': 'Cross-origin request rejected'}, status_code=403)
        else:
            response = await call_next(request)
    else:
        response = await call_next(request)

    for header, value in security_headers.items():
        response.headers.setdefault(header, value)
    response.headers['X-Request-ID'] = request_id
    request_logger.info(
        'request_complete',
        extra={
            'request_id': request_id,
            'method': request.method,
            'status_code': response.status_code,
            'duration_ms': round((time.perf_counter() - request.state.started_at) * 1000, 2),
        },
    )
    return response


@app.middleware('http')
async def start_request_timer(request: Request, call_next) -> Response:
    request.state.started_at = time.perf_counter()
    return await call_next(request)


app.include_router(health_router, tags=['health'])
app.include_router(auth_router, prefix='/api/auth', tags=['auth'])
app.include_router(staff_router, prefix='/api/staff', tags=['staff'])
app.include_router(patient_router, prefix='/api/patient', tags=['patient'])
app.include_router(summary_router, tags=['patient feedback'])
app.include_router(public_auth_router, tags=['patient links'])
app.include_router(test_hooks_router)


@app.get('/ready')
def ready(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text('SELECT 1'))
    return {'status': 'ready'}


@app.get('/')
def read_root() -> dict[str, str]:
    return {'service': 'lab-report-delivery', 'status': 'ok'}

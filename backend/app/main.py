from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes.health import router as health_router
from app.api.routes.auth import router as auth_router
from app.api.routes.staff import router as staff_router
from app.api.routes.patient import router as patient_router, summary_router
from app.api.routes.auth import public_router as public_auth_router
from app.api.routes.test_hooks import router as test_hooks_router

settings = get_settings()

app = FastAPI(title='Lab report delivery portal', version='0.1.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(health_router, tags=['health'])
app.include_router(auth_router, prefix='/api/auth', tags=['auth'])
app.include_router(staff_router, prefix='/api/staff', tags=['staff'])
app.include_router(patient_router, prefix='/api/patient', tags=['patient'])
app.include_router(summary_router, tags=['patient feedback'])
app.include_router(public_auth_router, tags=['patient links'])
app.include_router(test_hooks_router)


@app.get('/')
def read_root() -> dict[str, str]:
    return {'service': 'lab-report-delivery', 'status': 'ok'}

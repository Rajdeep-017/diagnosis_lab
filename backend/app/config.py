from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = 'lab-report-delivery'
    environment: Literal['development', 'test', 'production'] = 'development'
    database_url: str = 'postgresql+psycopg://postgres:postgres@localhost:5432/labportal'
    frontend_origin: str = 'http://localhost:5173'
    gemini_api_key: str = ''
    gemini_model: str = 'gemini-1.5-flash'
    jwt_secret: str = 'dev-secret'
    encryption_key: str = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    link_ttl_hours: int = 72
    otp_ttl_minutes: int = 5
    otp_max_attempts: int = 5
    demo_mode: bool = True
    demo_staff_email: str = 'staff@example.com'
    demo_staff_password: str = ''
    demo_ops_email: str = 'ops@example.com'
    demo_pathologist_email: str = 'pathologist@example.com'
    auth_token_ttl_hours: int = 8
    auth_cookie_secure: bool = False
    e2e_test_mode: bool = False
    e2e_test_token: str = ''
    db_pool_size: int = Field(default=5, gt=0)
    db_max_overflow: int = Field(default=10, ge=0)
    db_pool_timeout_seconds: int = Field(default=30, gt=0)
    db_statement_timeout_ms: int = Field(default=15000, gt=0)
    log_level: str = 'INFO'

    model_config = SettingsConfigDict(env_file=None, env_file_encoding='utf-8', case_sensitive=False)

    @model_validator(mode='after')
    def reject_unsafe_production_settings(self) -> Settings:
        if self.environment == 'production':
            if len(self.jwt_secret) < 32:
                raise ValueError('JWT_SECRET must be at least 32 characters in production')
            if self.demo_mode:
                raise ValueError('DEMO_MODE must be false in production')
            if not self.auth_cookie_secure:
                raise ValueError('AUTH_COOKIE_SECURE must be true in production')
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()

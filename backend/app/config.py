from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = 'lab-report-delivery'
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

    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8')


@lru_cache
def get_settings() -> Settings:
    return Settings()

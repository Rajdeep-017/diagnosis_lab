from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import get_settings

settings = get_settings()
engine_options: dict[str, object] = {
    'future': True,
    'pool_pre_ping': True,
}
if not settings.database_url.startswith('sqlite'):
    engine_options.update({
        'pool_size': settings.db_pool_size,
        'max_overflow': settings.db_max_overflow,
        'pool_timeout': settings.db_pool_timeout_seconds,
        'connect_args': {'options': f'-c statement_timeout={settings.db_statement_timeout_ms}'},
    })
engine = create_engine(settings.database_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

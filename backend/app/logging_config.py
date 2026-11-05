from __future__ import annotations

import json
import logging
from datetime import datetime, timezone


class RequestJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event: dict[str, object] = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'level': record.levelname,
            'event': record.getMessage(),
        }
        for field in ('request_id', 'method', 'status_code', 'duration_ms'):
            value = getattr(record, field, None)
            if value is not None:
                event[field] = value
        return json.dumps(event, separators=(',', ':'))


def configure_request_logging(level: str) -> logging.Logger:
    logger = logging.getLogger('app.request')
    logger.handlers.clear()
    handler = logging.StreamHandler()
    handler.setFormatter(RequestJsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(level.upper())
    logger.propagate = False
    return logger

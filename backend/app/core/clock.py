from __future__ import annotations

from datetime import datetime, timedelta, timezone

_test_offset = timedelta(0)


def utc_now() -> datetime:
    return datetime.now(timezone.utc) + _test_offset


def advance_test_clock(hours: int) -> datetime:
    global _test_offset
    _test_offset += timedelta(hours=hours)
    return utc_now()


def reset_test_clock() -> datetime:
    global _test_offset
    _test_offset = timedelta(0)
    return utc_now()

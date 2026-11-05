from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any


class FlagEvaluationError(ValueError):
    """Raised when a lab result cannot be evaluated safely."""


@dataclass(frozen=True)
class ParsedRange:
    low: float | None
    high: float | None
    kind: str


CRITICAL_THRESHOLDS = {
    'potassium': {'critical_low': 2.5, 'critical_high': 6.0},
    'haemoglobin': {'critical_low': 7.0, 'critical_high': 18.0},
    'glucose': {'critical_low': 3.0, 'critical_high': 20.0},
    'creatinine': {'critical_low': 0.5, 'critical_high': 4.0},
    'sodium': {'critical_low': 120.0, 'critical_high': 155.0},
    'platelets': {'critical_low': 50.0, 'critical_high': 700.0},
}


def parse_reference_range(reference: str) -> ParsedRange:
    if reference is None or not str(reference).strip():
        raise FlagEvaluationError('Reference range is required')

    text = str(reference).strip()
    match = re.fullmatch(r'\s*(<|>)?\s*(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?)\s*)?\s*', text)
    if not match:
        raise FlagEvaluationError(f'Unsupported reference range: {reference!r}')

    operator, lower_text, upper_text = match.groups()
    lower = float(lower_text) if lower_text is not None else None
    upper = float(upper_text) if upper_text is not None else None

    if operator == '<':
        return ParsedRange(low=None, high=lower, kind='lt')
    if operator == '>':
        return ParsedRange(low=lower, high=None, kind='gt')
    if upper is None:
        return ParsedRange(low=lower, high=lower, kind='equals')
    return ParsedRange(low=lower, high=upper, kind='range')


def _safe_float(value: Any) -> float:
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        cleaned = value.strip().replace(',', '')
        if cleaned.lower() in {'', 'negative', 'neg', 'n/a'}:
            raise FlagEvaluationError('Non-numeric result')
        number = float(cleaned)
    else:
        raise FlagEvaluationError('Non-numeric result')

    if not math.isfinite(number):
        raise FlagEvaluationError('Result is not finite')
    return number


def _normalise_result(value: Any) -> str:
    if value is None:
        raise FlagEvaluationError('Result is missing')
    if isinstance(value, str) and value.strip().lower() in {'negative', 'n/a', 'na'}:
        raise FlagEvaluationError('Non-numeric result')
    return str(value)


def _check_critical(parameter: str | None, value: float) -> bool:
    name = (parameter or '').strip().lower()
    if not name:
        return False
    thresholds = CRITICAL_THRESHOLDS.get(name)
    if thresholds is None:
        return False
    return value <= thresholds['critical_low'] or value >= thresholds['critical_high']


def evaluate_result(value: Any, reference_range: str, parameter: str | None = None) -> str:
    """Return a deterministic status: normal|low|high|critical."""
    numeric = _safe_float(_normalise_result(value))
    parsed = parse_reference_range(reference_range)

    if parsed.kind == 'lt':
        status = 'normal' if numeric < parsed.high else 'high'
    elif parsed.kind == 'gt':
        status = 'normal' if numeric > parsed.low else 'low'
    elif parsed.kind == 'equals':
        status = 'normal' if numeric == parsed.low else ('low' if numeric < parsed.low else 'high')
    else:
        status = 'normal'
        if parsed.low is not None and numeric < parsed.low:
            status = 'low'
        elif parsed.high is not None and numeric > parsed.high:
            status = 'high'

    if _check_critical(parameter, numeric):
        return 'critical'
    return status


def safe_evaluate_result(value: Any, reference_range: str, parameter: str | None = None) -> str:
    try:
        return evaluate_result(value, reference_range, parameter)
    except FlagEvaluationError:
        return 'needs manual review'

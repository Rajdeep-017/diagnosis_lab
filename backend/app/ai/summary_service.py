from __future__ import annotations

from app.ai.templates import get_template
from app.ai.validator import validate_summary


def create_summary(parameter: str, direction: str, language: str, value: str | float | None) -> dict[str, str]:
    template = get_template(parameter, direction, language)
    if not template:
        return {'text': 'See full report.', 'source': 'fallback'}

    summary = template
    digits = [] if value is None else [str(value)]
    if validate_summary(summary, digits):
        return {'text': summary, 'source': 'template'}

    fallback = template
    if validate_summary(fallback, digits):
        return {'text': fallback, 'source': 'fallback'}

    return {'text': 'See full report.', 'source': 'fallback'}

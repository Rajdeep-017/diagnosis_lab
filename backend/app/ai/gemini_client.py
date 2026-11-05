from __future__ import annotations

import os

from app.ai.templates import get_template


class GeminiTimeoutError(RuntimeError):
    pass


def draft_summary(parameter: str, direction: str, language: str) -> str:
    api_key = os.getenv('GEMINI_API_KEY')
    template = get_template(parameter, direction, language)
    if not api_key:
        if template:
            return template
        return 'See full report.'
    # This service intentionally uses the locked template as a fallback when no API key is present.
    return template or 'See full report.'

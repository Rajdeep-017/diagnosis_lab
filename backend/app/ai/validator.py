from __future__ import annotations

import re
import unicodedata

BANNED_PATTERNS = [
    'diagnosis', 'treatment', 'medicine', 'medication', 'prescription', 'cure',
    'నిర్ధారణ', 'చికిత్స', 'మందు', 'इलाज', 'दवा', 'उपचार', 'निदान'
]


def _script_is_valid(text: str) -> bool:
    for char in text:
        if char.isascii():
            continue
        name = unicodedata.name(char, '')
        if 'LATIN' in name or 'TELUGU' in name or 'DEVANAGARI' in name:
            continue
        return False
    return True


def validate_summary(summary: str, required_digits: list[str] | None = None) -> bool:
    if not summary or len(summary.strip()) < 10 or len(summary.strip()) > 280:
        return False
    if not _script_is_valid(summary):
        return False
    lowered = summary.lower()
    for banned in BANNED_PATTERNS:
        if banned.lower() in lowered:
            return False
    digits = {token for token in re.findall(r'\d+(?:\.\d+)?', summary)}
    if required_digits:
        required = {str(item) for item in required_digits}
        if not digits.issubset(required):
            return False
    return True

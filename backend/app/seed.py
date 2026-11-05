from __future__ import annotations

import csv
from pathlib import Path


def seed_sample_data() -> dict[str, int]:
    base = Path(__file__).resolve().parents[2]
    sample_csv = base / 'sample-data' / 'lab_reports_sample.csv'
    count = 0
    with sample_csv.open('r', encoding='utf-8', newline='') as handle:
        for _ in csv.DictReader(handle):
            count += 1
    return {'rows': count}


if __name__ == '__main__':
    print(seed_sample_data())

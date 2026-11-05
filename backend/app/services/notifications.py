from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class NotificationProvider(Protocol):
    def send(self, to: str, body: str) -> bool:
        ...


@dataclass
class DemoNotificationProvider:
    outbox: list[dict[str, str]]

    def send(self, to: str, body: str) -> bool:
        self.outbox.append({'to': to, 'body': body})
        return True

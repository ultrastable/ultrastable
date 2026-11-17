"""Connector health: expiry watch, silent refresh, auto reconnect card."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class ConnectorHealthCard:
    """Status card surfaced in QNFO.OPS for a single connector."""

    connector_id: str
    expires_at: float
    state: str = "ok"  # ok | refreshing | reconnecting | failed
    last_refresh_at: Optional[float] = None
    attempts: int = 0
    notes: list = field(default_factory=list)

    def is_expired(self, now: float) -> bool:
        return now >= self.expires_at


class ConnectorHealthMonitor:
    """Watches token expiry, performs silent refresh, auto-reconnects.

    ``refresh_fn`` must silently renew credentials and return the new
    expiry epoch (seconds). ``reconnect_fn`` performs a full reconnect.
    """

    def __init__(
        self,
        connector_id: str,
        expires_at: float,
        refresh_fn: Callable[[], float],
        reconnect_fn: Callable[[], float],
        clock: Callable[[], float] = time.time,
        expiry_margin: float = 60.0,
        max_attempts: int = 3,
    ) -> None:
        self.card = ConnectorHealthCard(
            connector_id=connector_id, expires_at=expires_at
        )
        self._refresh_fn = refresh_fn
        self._reconnect_fn = reconnect_fn
        self._clock = clock
        self._expiry_margin = expiry_margin
        self._max_attempts = max_attempts

    def check(self) -> ConnectorHealthCard:
        now = self._clock()
        if self.card.state in ("refreshing", "reconnecting"):
            return self.card
        if self.card.expires_at - now <= self._expiry_margin:
            self._silent_refresh(now)
        return self.card

    def _silent_refresh(self, now: float) -> None:
        self.card.state = "refreshing"
        try:
            self.card.expires_at = self._refresh_fn()
            self.card.last_refresh_at = now
            self.card.attempts = 0
            self.card.state = "ok"
            self.card.notes.append(f"silent refresh at {now}")
        except Exception as exc:  # noqa: BLE001 - surface any failure on card
            self.card.notes.append(f"refresh failed: {exc}")
            self._auto_reconnect(now)

    def _auto_reconnect(self, now: float) -> None:
        if self.card.attempts >= self._max_attempts:
            self.card.state = "failed"
            return
        self.card.attempts += 1
        self.card.state = "reconnecting"
        try:
            self.card.expires_at = self._reconnect_fn()
            self.card.last_refresh_at = now
            self.card.attempts = 0
            self.card.state = "ok"
            self.card.notes.append(f"auto reconnect at {now}")
        except Exception as exc:  # noqa: BLE001
            self.card.notes.append(f"reconnect failed: {exc}")
            self._auto_reconnect(now)

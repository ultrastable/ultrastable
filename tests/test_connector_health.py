"""Independent probes for connector health: expiry watch, silent refresh,
auto reconnect card."""
from src.qnfo.connector_health import ConnectorHealthMonitor


def test_expiry_triggers_silent_refresh():
    calls = []

    def refresh():
        calls.append("refresh")
        return 2000.0

    def reconnect():
        raise AssertionError("reconnect must not run on healthy refresh")

    m = ConnectorHealthMonitor("c1", 900.0, refresh, reconnect, clock=lambda: 900.0)
    card = m.check()
    assert calls == ["refresh"]
    assert card.state == "ok"
    assert card.expires_at == 2000.0
    assert card.is_expired(1900.0) is False


def test_refresh_failure_falls_back_to_auto_reconnect():
    attempts = []

    def refresh():
        raise RuntimeError("expired")

    def reconnect():
        attempts.append(1)
        return 3000.0

    m = ConnectorHealthMonitor("c1", 900.0, refresh, reconnect, clock=lambda: 900.0)
    card = m.check()
    assert len(attempts) == 1
    assert card.state == "ok"
    assert any("reconnect" in n for n in card.notes)


def test_reconnect_gives_up_after_max_attempts():
    def refresh():
        raise RuntimeError("expired")

    def reconnect():
        raise RuntimeError("down")

    m = ConnectorHealthMonitor("c1", 900.0, refresh, reconnect, clock=lambda: 900.0,
                               max_attempts=2)
    card = m.check()
    assert card.state == "failed"
    assert card.attempts == 2

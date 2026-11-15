import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from foundation.doers.q_tick import DOER_CONFIG, close_items, run


def test_complete_tick_record_is_closed():
    item = {
        "id": "q-1",
        "record": {"result": "ok", "observed_at": "2026-01-01T00:00:00Z"},
    }
    closed, remaining = close_items([item])
    assert len(closed) == 1 and closed[0]["id"] == "q-1"
    assert remaining == []


def test_failed_or_empty_records_stay_open():
    items = [
        {"id": "q-2", "record": {"result": "failed", "observed_at": "x"}},
        {"id": "q-3", "record": {"result": "ok"}},
        {"id": "q-4", "record": {}},
    ]
    closed, remaining = close_items(items)
    assert closed == []
    assert [i["id"] for i in remaining] == ["q-2", "q-3", "q-4"]


def test_run_reports_drained_state():
    state = {
        "open": [
            {"id": "a", "record": {"result": "ok", "observed_at": "t"}},
            {"id": "b", "record": {}},
        ]
    }
    out = run(state)
    assert [c["id"] for c in out["closed"]] == ["a"]
    assert [i["id"] for i in out["open"]] == ["b"]
    assert out["drained"] is False


def test_doer_config_is_registered_shape():
    assert DOER_CONFIG["family"] == "Q-TICK"
    assert DOER_CONFIG["entry"] == "close_items"

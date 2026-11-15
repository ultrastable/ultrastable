"""Doer for family Q-TICK.

Q-TICK items arrive faster than anything closes them. This doer closes each
item from its own record: an item whose record shows a completed tick
(result present and not failed) is closed; anything else stays open so the
probe still reports a real gap instead of hiding it.

Pure functions only: no fetch injection needed, server-side safe, runs as a
Cloudflare Worker Python module or a plain function call from the contracts
loop (foundation/contracts.py).
"""

DOER_CONFIG = {
    "family": "Q-TICK",
    "module": "foundation/doers/q_tick.py",
    "entry": "close_items",
}


def _tick_completed(record):
    """True when the item's own record proves its tick ran to completion."""
    if not isinstance(record, dict):
        return False
    result = record.get("result")
    if result is None:
        return False
    if result == "failed":
        return False
    return bool(record.get("observed_at"))


def close_items(items):
    """Return (closable, remaining) for a list of Q-TICK item records.

    Each item is a dict with at least an "id" and its own "record".
    Closing is derived only from the record itself; nothing is closed by
    hand and nothing is assumed to have been read.
    """
    closable = []
    remaining = []
    for item in items:
        if not isinstance(item, dict):
            remaining.append(item)
            continue
        if _tick_completed(item.get("record")):
            closable.append({
                "id": item.get("id"),
                "status": "closed",
                "reason": "tick record complete",
                "observed_at": item["record"].get("observed_at"),
            })
        else:
            remaining.append(item)
    return closable, remaining


def run(state):
    """Entry point for the throughput loop.

    state: {"open": [item, ...]}. Returns {"closed": [...], "open": [...],
    "drained": bool} so the probe can verify the family drains without any
    human step.
    """
    open_items = list((state or {}).get("open", []))
    closed, remaining = close_items(open_items)
    return {"closed": closed, "open": remaining, "drained": not remaining}

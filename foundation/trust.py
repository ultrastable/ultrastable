"""The trust ledger and ladder from the kernel's §TRUST. Trust per (surface, action class): baseline 0.5, a weight per recorded event,
decay per unexercised tick, a rung from the score. Rising trust widens only the fleet's own loop scopes, by reviewed PR; no rung reaches
harness permissions, secrets, the interrupt gate or the alignment floor (reading o). State is a repo file, so it is the system's own memory.

  python3 -m foundation trust --show
  python3 -m foundation trust --event SURFACE ACTION EVENT --evidence SRC:ID   record one externally verified outcome (EVENT is a key of rises or falls in doctrine/kernel.json)
  python3 -m foundation trust --tick                        advance one tick: decay every row not exercised since the last tick
"""
from __future__ import annotations
import json, re
from pathlib import Path
from . import kernel

REPO = Path(__file__).resolve().parent.parent
LEDGER = "instances/ultrastable/trust-ledger.json"


def load(root=REPO) -> dict:
    p = Path(root) / LEDGER
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"version": 1, "tick": 0, "rows": {}, "transitions": []}


def save(led: dict, root=REPO):
    (Path(root) / LEDGER).write_text(json.dumps(led, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def rung(score: float, k: dict) -> str:
    out = k["trust"]["ladder"][0]
    for r in k["trust"]["ladder"]:
        if score >= k["trust"]["ladder_min_score"][r]:
            out = r
    return out


def _row(led, key, k):
    return led["rows"].setdefault(key, {"score": k["trust"]["baseline"], "rung": k["trust"]["ladder"][0], "last_tick": led["tick"], "deposits": 0, "withdrawals": 0})


# EXTERNAL-TRUST-1 (kernel 9.0.0 M4): trust moves only on an outcome someone other than the actor verified. The evidence names its source:
# a CI run of the protected checks, a merge commit made by the lane's identity, a canary, or an observer probe. A self-report moves nothing.
EXTERNAL = re.compile(r"^(ci-run|merge|canary|probe):[A-Za-z0-9._/:#-]{3,200}$")


def apply(led: dict, surface: str, action: str, event: str, k: dict, evidence: str | None = None) -> dict:
    t = k["trust"]
    delta = t["rises"].get(event, t["falls"].get(event))
    if delta is None:
        raise ValueError(f"unknown trust event {event!r}")
    if not evidence or not EXTERNAL.match(evidence):
        raise ValueError(f"trust event {event!r} needs external evidence (ci-run:ID, merge:SHA, canary:ID or probe:ID), got {evidence!r}; a self-report moves nothing (kernel 9.0.0 M4)")
    key = f"{surface}|{action}"
    row = _row(led, key, k)
    row["score"] = round(min(1.0, max(0.0, row["score"] + delta)), 4)
    row["last_tick"] = led["tick"]
    row["last_external_event"] = evidence
    row["deposits" if delta > 0 else "withdrawals"] += 1
    new = rung(row["score"], k)
    if new != row["rung"]:
        led["transitions"].append({"key": key, "from": row["rung"], "to": new, "tick": led["tick"], "event": event})
        row["rung"] = new
    return row


def tick(led: dict, k: dict) -> list[str]:
    """Advance one tick; every row not exercised since the previous tick decays."""
    decayed = []
    led["tick"] += 1
    for key, row in led["rows"].items():
        if row["last_tick"] < led["tick"] - 1:
            row["score"] = round(max(0.0, row["score"] - k["trust"]["decay_per_idle_tick"]), 4)
            new = rung(row["score"], k)
            if new != row["rung"]:
                led["transitions"].append({"key": key, "from": row["rung"], "to": new, "tick": led["tick"], "event": "decay"})
                row["rung"] = new
            decayed.append(key)
    return decayed


def compounding_rate(led: dict) -> float:
    d = sum(r["deposits"] for r in led["rows"].values())
    w = sum(r["withdrawals"] for r in led["rows"].values())
    return round(d / w, 3) if w else float(d)

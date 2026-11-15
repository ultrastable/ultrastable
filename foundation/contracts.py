"""CONTRACTS-1: closing-probe contracts for every queue item, ported from QNFO's remediation contracts (scripts/remediation_consumer.py,
REMEDIATION-REOPEN-2, RELAPSE-HOLD-1). Ultrastable is the foundation for any autonomous system.

An item closes only when its own closing probe passes, and a closed item whose probe fails again is reopened. Rules (doctrine/qnfo-port.json,
mechanism `closing-probe-contracts`, `config`):

  pass        the probe ran and passed. An item never reopened closes on its first pass. An item reopened before closes only after
              `passes_after_reopen` consecutive passes whose first pass is at least the hold old (`hold_minutes` 60 after one or two reopens,
              120 after three or more), so a flapping fix cannot close and reopen every tick.
  fail        the probe ran and failed. An open item stays open; a closed item that this ledger has seen pass is reopened (relapse).
  deferred    the probe is `pending:<why>`: nothing opens or closes.
  unusable    the probe is not machine-executable (unknown kind, command not allow-listed, the command could not run). Fail-closed: the item
              stays open and the link is an ignition gap, never a guessed pass.

Baseline: a closed item that the ledger has never seen pass is recorded as `baseline` and is not reopened (closed before contracts existed,
so the first run reopens nothing). Closed items are re-probed for relapse with cheap probes (file, grep) every pass and at most
`relapse_cmd_per_pass` command probes per pass, oldest check first.

  python3 -m foundation contracts --tick [--apply]   verify every open item and re-probe closed ones; --apply writes the items and ops/contracts.jsonl
  python3 -m foundation contracts --report           relapse rate, reopened items, unusable probes (no writes)

Ledger: ops/contracts.jsonl, one row per verification (passes too). The state of each contract is a replay of its rows (foundation/ledger.py).
"""
from __future__ import annotations
import json, re, shlex, subprocess, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import ledger

REPO = Path(__file__).resolve().parents[1]
LEDGER = "ops/contracts.jsonl"
CLOSED = ("closed", "done")
FRESH = {"reopens": 0, "last_reopen": None, "streak": 0, "streak_from": None, "seen_pass": False, "closed_by_contract": False, "last_checked": None, "last_verdict": None}
DEFAULT = {"passes_after_reopen": 2, "hold_minutes": {"1": 60, "3": 120}, "relapse_cmd_per_pass": 5, "window_days": 7}


def cfg(root=REPO) -> dict:
    from . import sauce
    return {**DEFAULT, **sauce.mechanism(root, "closing-probe-contracts").get("config", {})}


def _now(now) -> datetime:
    return now or datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def run_probe(root, spec: str) -> tuple[str, str]:
    """(verdict, evidence) for one closing probe; verdict is pass, fail, deferred or unusable. Never raises."""
    from . import queue
    kind, _, rest = (spec or "").partition(":")
    if kind == "pending":
        return "deferred", spec[:160]
    if kind in ("file", "grep"):
        from . import selfhost
        try:
            return ("pass" if selfhost.probe(root, spec) else "fail"), spec[:160]
        except (OSError, re.error, ValueError) as e:
            return "unusable", f"{type(e).__name__}: {e}"[:160]
    if kind == "cmd":
        if not rest.startswith(queue.CMD_ALLOWED):
            return "unusable", f"command not allow-listed: {rest[:60]}"
        try:
            r = subprocess.run(shlex.split(rest), cwd=root, capture_output=True, text=True, timeout=60, encoding="utf-8", errors="replace")
        except (OSError, subprocess.TimeoutExpired, ValueError) as e:
            return "unusable", f"{type(e).__name__}: {e}"[:160]
        return ("pass" if r.returncode == 0 else "fail"), ((r.stdout or r.stderr).strip()[:160] or f"exit {r.returncode}")
    return "unusable", f"probe kind {kind!r} is not machine-executable" if spec else "no closing probe"


def state(rows: list[dict]) -> dict:
    """Replay the ledger: per item id, reopen count, last reopen, the current pass streak and its start, whether it was ever seen passing."""
    st: dict[str, dict] = {}
    for r in rows:
        s = st.setdefault(str(r["id"]), dict(FRESH))
        s["last_checked"], s["last_verdict"] = r.get("at"), r.get("verdict")
        if r.get("action") == "reopen":
            s["reopens"] += 1; s["last_reopen"] = r["at"]; s["streak"] = 0; s["streak_from"] = None
        elif r.get("verdict") == "pass":
            s["seen_pass"] = True
            if s["streak"] == 0:
                s["streak_from"] = r["at"]
            s["streak"] += 1
        elif r.get("verdict") == "fail":
            s["streak"] = 0; s["streak_from"] = None
        if r.get("action") == "close":
            s["closed_by_contract"] = True
    return st


def hold_minutes(reopens: int, c: dict) -> int:
    h = 0
    for k, v in sorted(((int(k), v) for k, v in c["hold_minutes"].items())):
        if reopens >= k:
            h = v
    return h


def may_close(s: dict, now: datetime, c: dict) -> tuple[bool, str]:
    """An item that was never reopened closes on its first pass; a reopened one needs the streak and the hold (RELAPSE-HOLD-1)."""
    if s["reopens"] == 0:
        return True, "first pass"
    need, hold = c["passes_after_reopen"], hold_minutes(s["reopens"], c)
    if s["streak"] < need:
        return False, f"hold: {s['streak']} of {need} consecutive passes after {s['reopens']} reopen(s)"
    age = (now - _ts(s["streak_from"])).total_seconds() / 60 if s["streak_from"] else 0
    if age < hold:
        return False, f"hold: passes span {int(age)} of {hold} minutes after {s['reopens']} reopen(s)"
    return True, f"{s['streak']} consecutive passes over {int(age)} minutes after {s['reopens']} reopen(s)"


def _close(it: dict, why: str) -> None:
    j = it["json"]
    j["body"] = re.sub(r"\*\*Status:\*\*\s*open", "**Status:** closed", j["body"], count=1) + f"\n\n**Evidence:** {why}\n"
    it["path"].write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")


def _reopen(it: dict, why: str) -> None:
    j = it["json"]
    j["body"] = re.sub(r"\*\*Status:\*\*\s*(closed|done)", "**Status:** open", j["body"], count=1) + f"\n\n**Relapse:** {why}\n"
    it["path"].write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")


def tick(root=REPO, apply=False, now=None, probe=None) -> dict:
    """One pass: every open item is verified; closed items are re-probed for relapse within the per-pass command budget."""
    from . import queue
    root, now, c = Path(root), _now(now), cfg(root)
    probe = probe or (lambda spec: run_probe(root, spec))
    st, at = state(ledger.rows(root, LEDGER)), _iso(now)
    out, cmd_budget = [], c["relapse_cmd_per_pass"]
    its = queue.items(root)
    closed = sorted((i for i in its if i["status"] in CLOSED), key=lambda i: (st.get(str(i["id"]), {}).get("last_checked") or ""))
    for it in [i for i in its if i["status"] == "open"] + closed:
        iid = str(it["id"])
        s = dict(st.get(iid) or FRESH)
        is_closed = it["status"] in CLOSED
        if is_closed and it["probe"].startswith("cmd:"):
            if cmd_budget <= 0:
                continue
            cmd_budget -= 1
        verdict, ev = probe(it["probe"])
        row = {"at": at, "id": iid, "status_before": it["status"], "probe": it["probe"][:200], "verdict": verdict, "evidence": ev, "action": "none"}
        if verdict == "pass":
            s = {**s, "streak": s["streak"] + 1, "streak_from": s["streak_from"] or at, "seen_pass": True}
        elif verdict == "fail":
            s = {**s, "streak": 0, "streak_from": None}
        if not is_closed and verdict == "pass":
            ok, why = may_close(s, now, c)
            row["action"], row["why"] = ("close", why) if ok else ("hold", why)
            if ok and apply:
                _close(it, f"closing probe passed ({why}): {ev}")
        elif is_closed and verdict == "fail":
            if s["seen_pass"]:
                row["action"], row["why"] = "reopen", f"relapse: probe failed after it had passed (reopen {s['reopens'] + 1})"
                if apply:
                    _reopen(it, f"{at} closing probe failed again: {ev} (reopen {s['reopens'] + 1}; closes again only after {c['passes_after_reopen']} passes over {hold_minutes(s['reopens'] + 1, c)} minutes)")
            else:
                row["action"], row["why"] = "baseline", "closed before contracts and never seen passing: recorded, not reopened"
        out.append(row)
    if apply:
        ledger.append(root, LEDGER, out)
    return {"at": at, "rows": out, **summary(root, out_rows=out if not apply else None, now=now)}


def summary(root=REPO, out_rows=None, now=None) -> dict:
    """Relapse rate over the window (reopens / closes), items reopened and still open, open items whose probe is unusable."""
    now, c = _now(now), cfg(root)
    rows = ledger.rows(root, LEDGER) + (out_rows or [])
    since = _iso(now - timedelta(days=c["window_days"]))
    win = [r for r in rows if (r.get("at") or "") >= since]
    closes, reopens = sum(r.get("action") == "close" for r in win), sum(r.get("action") == "reopen" for r in win)
    last: dict[str, dict] = {}
    for r in rows:
        last[str(r["id"])] = r
    after = lambda r: "closed" if r.get("action") == "close" else "open" if r.get("action") == "reopen" else ("closed" if r.get("status_before") in CLOSED else "open")
    st = state(rows)
    relapsed_open = sorted(i for i, r in last.items() if st[i]["reopens"] > 0 and after(r) == "open")
    unusable = sorted(i for i, r in last.items() if r.get("verdict") == "unusable" and r.get("status_before") == "open")
    return {"closes": closes, "reopens": reopens, "relapse_rate": round(reopens / closes, 3) if closes else 0.0,
            "relapsed_open": relapsed_open, "unusable_open": unusable}


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--tick" in a:
        r = tick(apply="--apply" in a)
        acts = [f"{x['action']:<8} {x['id']}: {x.get('why', x['verdict'])}" for x in r["rows"] if x["action"] != "none"]
        print("\n".join(acts) or "no contract changed state")
        print(json.dumps({k: r[k] for k in ("closes", "reopens", "relapse_rate", "relapsed_open", "unusable_open")}))
        return 0
    if "--report" in a:
        print(json.dumps(summary(), indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

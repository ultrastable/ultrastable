"""COST-GUARD-1: the declaration of the cost findings and the reader of the latest cost reading.

  python3 -m foundation cost --check    doctrine/cost.json is well formed and ops/cost-thresholds.json exists
  python3 -m foundation cost --level    normalized cost of the latest reading (1.0 = at budget)
  python3 -m foundation cost --guard    COST-RUNAWAY-1 + D1-GROWTH-1 (detectors cost-runaway, d1-growth): fails when the latest reading is older than
                                        max_age_days, unmeasured, has a breach, measured no database, is above warn_level of budget, or when a
                                        database's size series reaches the plan limit inside d1_size_horizon_days

Measuring and filing breaches is deploy/cost-probe.mjs (Q-COST-PROOF-1); budgets are in ops/cost-thresholds.json. This module turns the latest line of ops/cost.jsonl
into one number that foundation/criticality.py uses as the cost term of k and as the control-rod trigger.
"""
from __future__ import annotations
import datetime as dt, json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/cost.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    c, errs = load(root), []
    for k in ("standing_goal", "budgets", "findings", "account_id", "closing_probe"):
        if k not in c:
            errs.append("missing " + k)
    for f in c.get("findings", []):
        if not f.get("remedy") or not f.get("status"):
            errs.append(f"finding {f.get('id')} lacks remedy or status")
    if not (Path(root) / "ops/cost-thresholds.json").is_file():
        errs.append("ops/cost-thresholds.json is missing")
    return errs


def own(name: str, thr: dict) -> bool:
    """A database is ours when its name starts with a declared prefix (cost-thresholds file_prefixes); the Quniverse test bed on the same account is foreign and is not judged here unless file_foreign is true."""
    if thr.get("file_foreign"):
        return True
    pre = tuple(thr.get("file_prefixes", [])) + tuple(thr.get("own_prefixes", ["demo-child-ultrastable"]))
    return str(name).startswith(pre)


def level(reading: dict, thr: dict) -> float:
    """Largest share of budget used: any of our databases' rows read over its max, or the AI neurons over neurons_max.
    COST-LEVEL-SHAPES-1 (2026-11-25): deploy/cost-probe.mjs writes one day per row (d1[].rowsRead by databaseId, top-level neurons) while the
    session reads wrote a window (d1[].rows_read by name, ai.neurons). Only the second shape was read, so every probe row scored 0 and the cost
    term of k could not rise. A day is scaled to the window."""
    days = thr.get("window_days", 7)
    names = {d.get("databaseId"): d.get("name", "") for d in reading.get("d1Size", [])}
    shares = []
    for d in reading.get("d1", []):
        name = d.get("name") or names.get(d.get("databaseId"), "")
        if not own(name, thr):
            continue
        used = d["rows_read"] if "rows_read" in d else d.get("rowsRead", 0) * days
        shares.append(used / thr.get("rows_read_override", {}).get(name, thr["rows_read_max"]))
    neurons = reading.get("ai", {}).get("neurons") if "ai" in reading else (reading.get("neurons") or 0) * days
    shares.append((neurons or 0) / thr["neurons_max"])
    return round(max(shares), 3)


def _days_to_limit(series: list[tuple[str, int]], limit: int):
    """Days until a database's size reaches limit at the growth between its first and last reading; None when it is not growing."""
    if len(series) < 2:
        return None
    (d0, b0), (d1, b1) = series[0], series[-1]
    span = (dt.date.fromisoformat(d1) - dt.date.fromisoformat(d0)).days
    if span <= 0 or b1 <= b0:
        return None
    return int((limit - b1) / ((b1 - b0) / span))


def guard(root=REPO, today=None) -> list[str]:
    root, bad = Path(root), []
    thr = json.loads((root / "ops/cost-thresholds.json").read_text(encoding="utf-8"))
    p = root / "ops/cost.jsonl"
    rows = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.is_file() else []
    today = today or dt.datetime.now(dt.timezone.utc).date()
    probe_rows = [r for r in rows if "ts" in r and "date" in r]
    if not probe_rows:
        return ["no cost reading in ops/cost.jsonl: cost is unmeasured"]
    last = probe_rows[-1]
    age = (today - dt.date.fromisoformat(last["date"])).days
    if age > thr.get("max_age_days", 2):
        bad.append(f"latest cost reading is {age} days old (limit {thr.get('max_age_days', 2)}): the cost-guard loop stopped")
    if last.get("unmeasured"):
        bad.append(f"latest cost reading is unmeasured: {json.dumps(last['unmeasured'])[:200]}")
    if not last.get("d1"):
        bad.append("latest cost reading measured no D1 database (rows read and size unknown)")
    for b in last.get("breaches", []):
        bad.append(f"breach {b.get('kind')}: {json.dumps(b)[:160]}")
    lv = level(last, thr)
    if lv >= thr.get("warn_level", 0.8):
        bad.append(f"cost level {lv} of budget is at or above warn_level {thr.get('warn_level', 0.8)}")
    limit, horizon = thr.get("d1_size_max_bytes", 524288000), thr.get("d1_size_horizon_days", 90)
    series: dict[str, list] = {}
    for r in probe_rows[-60:]:
        for d in r.get("d1Size", []):
            series.setdefault(d.get("name") or d.get("databaseId"), []).append((r["date"], d.get("bytes", 0)))
    for name, s in sorted(series.items()):
        left = _days_to_limit(s, limit)
        if left is not None and left < horizon:
            bad.append(f"D1 {name} reaches the {limit // 1048576} MB limit in about {left} days at its measured growth")
    return bad


def normalized(root=REPO) -> float:
    root = Path(root)
    p, t = root / "ops/cost.jsonl", root / "ops/cost-thresholds.json"
    if not (p.is_file() and t.is_file()):
        return 0.0
    rows = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
    return level(rows[-1], json.loads(t.read_text(encoding="utf-8"))) if rows else 0.0


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "cost declaration ok"); return 1 if e else 0
    if "--level" in a:
        print(normalized()); return 0
    if "--guard" in a:
        e = guard(); print("\n".join(e) or "cost guard ok: fresh, measured, under budget, no database near its size limit"); return 1 if e else 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

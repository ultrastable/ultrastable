"""METRIC-LOOP-1: the metric closed loop, ported from QNFO's METRIC-CLOSED-LOOP-1 (metric_registry -> v_metric_trigger_state ->
analytics_metric_triggers -> agent_issues -> remedy_efficacy_30d). Ultrastable is the foundation for any autonomous system.

  registry   doctrine/metric-loop.json: each metric has a reader, a healthy condition (op, threshold), a kind (target or guard), an owner and an
             ordered list of levers (the remedies the loop may try).
  judge      every pass reads every metric; `hit` (outside the healthy condition) is the breach verdict, never a stored state.
  act        a breach with no remedy running files ONE item Q-METRIC-<ID> naming the first untried lever; its closing probe is
             `python3 -m foundation metricloop --probe <id>`, so the item closes itself on recovery (foundation/contracts.py).
  learn      after `efficacy_days` a remedy is judged against its baseline: moved toward the threshold by at least `min_move_share` of the gap
             -> kept (a new window starts); did not move -> the lever is retired for this metric and the next lever replaces it in the item
             (a remedy that did not move its metric in 7 days is replaced, not repeated). No lever left -> Q-METRIC-<ID>-LEVER asks for a new
             lever to be built, and the metric is an ignition gap until one exists.
  guards     a target metric that improved while a guard metric worsened since the previous reading is a regression, recorded every pass.

  python3 -m foundation metricloop --tick [--apply]   read, judge, act, learn; --apply writes items and ops/metric-loop.jsonl
  python3 -m foundation metricloop --probe ID         exit 0 when metric ID is healthy now (the closing probe of its item)
  python3 -m foundation metricloop --check            the registry is complete and every reader exists

Remedy efficacy (30 days) = remedies judged moved or recovered / all judged remedies.
"""
from __future__ import annotations
import json, operator, re, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import ledger

REPO = Path(__file__).resolve().parents[1]
REGISTRY = "doctrine/metric-loop.json"
LEDGER = "ops/metric-loop.jsonl"
OPS = {"<=": operator.le, ">=": operator.ge, "<": operator.lt, ">": operator.gt, "==": operator.eq}


def load(root=REPO) -> dict:
    return json.loads((Path(root) / REGISTRY).read_text(encoding="utf-8"))


# Readers: each returns a number from the repository's own records. None means unreadable, which is a breach (an unprobed measure is not a pass).
def _criticality(root):
    from . import criticality
    return criticality.compute(root, feed_ok=True)


def _executor_success_share(root, days=7):
    from . import queue
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    # Only runs that attempted a change count: idle, picked and dry-run rows are not outcomes.
    rows = [r for r in queue.executor_rows(root) if (r.get("at") or "") >= since and r.get("result") in ("pr-opened", "verified-no-change", "failed", "retry-public")]
    return round(sum(r["result"] in ("pr-opened", "verified-no-change") for r in rows) / len(rows), 3) if rows else None


READERS = {
    "criticality_k": lambda root: _criticality(root)["k"],
    "normalized_cost": lambda root: __import__("foundation.cost", fromlist=["normalized"]).normalized(root),
    "human_touches": lambda root: _criticality(root)["human_touches"],
    "open_items": lambda root: sum(1 for i in __import__("foundation.queue", fromlist=["items"]).items(root) if i["status"] == "open"),
    "contract_relapse_rate": lambda root: __import__("foundation.contracts", fromlist=["summary"]).summary(root)["relapse_rate"],
    "families_without_doer": lambda root: len(__import__("foundation.throughput", fromlist=["report"]).report(root)["without_doer"]),
    "executor_success_share": _executor_success_share,
}


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def healthy(m: dict, v) -> bool:
    return v is not None and OPS[m["op"]](v, m["threshold"])


def better(m: dict, a, b) -> bool:
    """a is better than b for this metric (direction from its op)."""
    if a is None or b is None:
        return False
    return a > b if m["op"] in (">=", ">") else a < b if m["op"] in ("<=", "<") else abs(a - m["threshold"]) < abs(b - m["threshold"])


def moved(m: dict, baseline, value, share: float) -> bool:
    if baseline is None or value is None:
        return False
    gap = abs(baseline - m["threshold"]) or 1.0
    return better(m, value, baseline) and abs(value - baseline) >= share * gap


def item_id(mid: str, suffix: str = "") -> str:
    return "Q-METRIC-" + re.sub(r"[^A-Za-z0-9]+", "-", mid).upper().strip("-") + suffix


def state(rows: list[dict]) -> dict:
    """Per metric: the remedy running now (lever, started, baseline), retired levers, whether the levers are exhausted, the last reading."""
    st: dict[str, dict] = {}
    for r in rows:
        if "metric" not in r:
            continue
        s = st.setdefault(r["metric"], {"active": None, "retired": [], "exhausted": False, "last": None})
        e = r.get("event")
        if e == "reading":
            s["last"] = r
        elif e == "remedy-start":
            s["active"] = {"lever": r["lever"], "started": r["at"], "baseline": r.get("baseline")}; s["exhausted"] = False
        elif e == "remedy-verdict":
            s["active"] = None
            if r.get("verdict") == "not-moved" and r["lever"] not in s["retired"]:
                s["retired"].append(r["lever"])
        elif e == "lever-exhausted":
            s["active"], s["exhausted"] = None, True
        elif e == "lever-added":
            s["exhausted"] = False
    return st


def _item(m: dict, lever: dict | None, value, history: str, exhausted=False) -> dict:
    mid = m["id"]
    if exhausted:
        body = (f"**Owner:** {m['owner']}\n**Trigger:** metric loop pass: every lever for metric {mid} was tried and none moved it\n"
                f"**Done check:** cmd:python3 -m foundation metricloop --probe {mid}\n**Status:** open\n\n"
                f"Metric `{mid}` ({m['kind']}) reads {value}, healthy is {m['op']} {m['threshold']}. Retired levers: {history}.\n"
                f"Build a new lever: add it to doctrine/metric-loop.json under `{mid}.levers` with the change it makes, so the loop can try it. "
                f"Until then this metric is an open ignition gap (foundation/sauce.py).\n\nsize: M")
        return {"id": item_id(mid, "-LEVER"), "title": f"{item_id(mid, '-LEVER')}: originate a new lever for metric {mid}; every lever tried did not move it"[:240],
                "body": body, "labels": [f"role:{m['owner']}", "agent-ready", "ignition", "metric-loop"], "milestone": "Now", "workstream": "Metrics"}
    body = (f"**Owner:** {m['owner']}\n**Trigger:** metric loop pass: {mid} outside its healthy condition\n"
            f"**Done check:** cmd:python3 -m foundation metricloop --probe {mid}\n**Status:** open\n\n"
            f"Metric `{mid}` ({m['kind']}) reads {value}; healthy is {m['op']} {m['threshold']}. {m.get('why', '')}\n"
            f"Lever now: **{lever['id']}**: {lever['action']}\n"
            + (f"code-task: {lever['code_task']}\n" if lever.get("code_task") else "")
            + (f"Levers retired for not moving the metric: {history}.\n" if history else "")
            + "The loop judges this lever after the efficacy window; a lever that did not move the metric is replaced here, not repeated.\n\nsize: S")
    return {"id": item_id(mid), "title": f"{item_id(mid)}: {mid} {value} vs {m['op']} {m['threshold']}; lever {lever['id']}"[:240], "body": body,
            "labels": [f"role:{m['owner']}", "agent-ready", "ignition", "metric-loop"] + (["cuts-cost"] if "cost" in mid else []), "milestone": "Now", "workstream": "Metrics"}


def _write_item(root: Path, j: dict) -> str:
    p = root / "docs/issues" / (j["id"] + ".json")
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():  # keep the item's identity and any evidence; refresh the lever and reading, reopen it if it had closed
        old = json.loads(p.read_text(encoding="utf-8"))
        if old.get("body") == j["body"]:
            return p.name
    p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
    return p.name


def tick(root=REPO, apply=False, now=None, readers=None) -> dict:
    root, reg = Path(root), load(root)
    now = now or datetime.now(timezone.utc)
    at, rd = _iso(now), {**READERS, **(readers or {})}
    st = state(ledger.rows(root, LEDGER))
    events, filed, verdicts = [], [], []
    vals = {}
    for m in reg["metrics"]:
        mid = m["id"]
        try:
            v = rd[m["reader"]](root)
        except Exception as e:  # an unreadable metric is a breach with a recorded reason, never a pass
            v, err = None, f"{type(e).__name__}: {e}"[:160]
        else:
            err = None
        vals[mid] = v
        hit = not healthy(m, v)
        events.append({"at": at, "metric": mid, "event": "reading", "value": v, "hit": hit, **({"error": err} if err else {})})
        s = st.get(mid, {"active": None, "retired": [], "exhausted": False, "last": None})
        levers = [l for l in m["levers"] if l["id"] not in s["retired"]]
        act = s["active"]
        if act:
            age_d = (now - _ts(act["started"])).total_seconds() / 86400
            if not hit:
                events.append({"at": at, "metric": mid, "event": "remedy-verdict", "lever": act["lever"], "verdict": "recovered", "baseline": act["baseline"], "value": v})
                verdicts.append((mid, "recovered"))
            elif age_d >= reg["efficacy_days"]:
                if moved(m, act["baseline"], v, reg["min_move_share"]):
                    events += [{"at": at, "metric": mid, "event": "remedy-verdict", "lever": act["lever"], "verdict": "moved", "baseline": act["baseline"], "value": v},
                               {"at": at, "metric": mid, "event": "remedy-start", "lever": act["lever"], "baseline": v}]
                    verdicts.append((mid, "moved"))
                else:
                    events.append({"at": at, "metric": mid, "event": "remedy-verdict", "lever": act["lever"], "verdict": "not-moved", "baseline": act["baseline"], "value": v})
                    verdicts.append((mid, "not-moved"))
                    retired = s["retired"] + [act["lever"]]
                    nxt = [l for l in m["levers"] if l["id"] not in retired]
                    if nxt:
                        events.append({"at": at, "metric": mid, "event": "remedy-start", "lever": nxt[0]["id"], "baseline": v, "replaces": act["lever"]})
                        filed.append(_item(m, nxt[0], v, ", ".join(retired)))
                    else:
                        events.append({"at": at, "metric": mid, "event": "lever-exhausted"})
                        filed.append(_item(m, None, v, ", ".join(retired), exhausted=True))
        elif hit and not s["exhausted"]:
            if levers:
                events.append({"at": at, "metric": mid, "event": "remedy-start", "lever": levers[0]["id"], "baseline": v})
                filed.append(_item(m, levers[0], v, ", ".join(s["retired"])))
            else:
                events.append({"at": at, "metric": mid, "event": "lever-exhausted"})
                filed.append(_item(m, None, v, ", ".join(s["retired"]), exhausted=True))
        elif s["exhausted"] and levers:  # a lever was added to the registry after exhaustion: the loop may try again
            events.append({"at": at, "metric": mid, "event": "lever-added"})
    # Guard rule: a target that improved while a guard worsened since the previous reading is a regression.
    improved = [m["id"] for m in reg["metrics"] if m["kind"] == "target" and st.get(m["id"], {}).get("last") and better(m, vals[m["id"]], st[m["id"]]["last"]["value"])]
    worsened = [m["id"] for m in reg["metrics"] if m["kind"] == "guard" and st.get(m["id"], {}).get("last") and better(m, st[m["id"]]["last"]["value"], vals[m["id"]])]
    regressions = [{"target": t, "guard": g} for t in improved for g in worsened]
    events += [{"at": at, "event": "guard-regression", **r} for r in regressions]
    written = []
    if apply:
        ledger.append(root, LEDGER, events)
        written = [_write_item(root, j) for j in filed]
    allrows = ledger.rows(root, LEDGER) + ([] if apply else events)
    fin = state(allrows)
    return {"at": at, "values": vals, "breached": [m["id"] for m in reg["metrics"] if not healthy(m, vals[m["id"]])],
            "exhausted": sorted(k for k, v in fin.items() if v["exhausted"]), "regressions": regressions, "verdicts": verdicts,
            "filed": written or [j["id"] for j in filed], "efficacy_30d": efficacy(allrows, now)}


def efficacy(rows: list[dict], now: datetime, days: int = 30):
    since = _iso(now - timedelta(days=days))
    v = [r for r in rows if r.get("event") == "remedy-verdict" and (r.get("at") or "") >= since]
    return round(sum(r["verdict"] in ("moved", "recovered") for r in v) / len(v), 3) if v else None


def probe(mid: str, root=REPO, readers=None) -> tuple[bool, str]:
    m = next((x for x in load(root)["metrics"] if x["id"] == mid), None)
    if not m:
        return False, f"unknown metric {mid}"
    try:
        v = {**READERS, **(readers or {})}[m["reader"]](root)
    except Exception as e:
        return False, f"{mid} unreadable: {type(e).__name__}: {e}"[:160]
    return healthy(m, v), f"{mid}={v} (healthy {m['op']} {m['threshold']})"


def check(root=REPO) -> list[str]:
    errs, reg, seen = [], load(root), set()
    for k in ("efficacy_days", "min_move_share", "metrics"):
        if k not in reg:
            errs.append(f"registry lacks {k}")
    for m in reg.get("metrics", []):
        i = m.get("id", "?")
        if i in seen:
            errs.append(f"{i}: duplicate metric")
        seen.add(i)
        for k in ("id", "kind", "reader", "op", "threshold", "owner", "levers"):
            if k not in m:
                errs.append(f"{i}: lacks {k}")
        if m.get("kind") not in ("target", "guard"):
            errs.append(f"{i}: kind must be target or guard")
        if m.get("reader") not in READERS:
            errs.append(f"{i}: reader {m.get('reader')} has no code")
        if m.get("op") not in OPS:
            errs.append(f"{i}: op {m.get('op')} unknown")
        if not m.get("levers"):
            errs.append(f"{i}: a metric needs at least one lever (a breach with no remedy is not a loop)")
        for l in m.get("levers", []):
            if not (l.get("id") and l.get("action")):
                errs.append(f"{i}: every lever needs id and action")
    return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        e = check(); print("\n".join(e) or "metricloop ok"); return 1 if e else 0
    if "--probe" in a:
        ok, ev = probe(a[a.index("--probe") + 1]); print(ev); return 0 if ok else 1
    if "--tick" in a:
        print(json.dumps(tick(apply="--apply" in a), indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

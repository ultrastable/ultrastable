"""THROUGHPUT-1: per-family throughput of the queue, ported from QNFO's ISSUE-THROUGHPUT-1 (v_issue_family_throughput) and the no-silent-drop
issue lifecycle ledger (AUTONOMOUS-OPERATION-DOCTRINE section 6, issue_lifecycle). Ultrastable is the foundation for any autonomous system.

Every pass compares the queue (docs/issues, foundation/queue.items) with the last known state replayed from ops/issue-lifecycle.jsonl and appends
one event per change: opened, closed, reopened, deleted (an item that vanished while open is a silent drop). The first pass seeds the ledger from
git history (the commit that added each item file opened it; the last commit of a closed item closed it), so throughput is measured from day one.

Per family (the id prefix: Q-CRIT-IGNITION -> Q-CRIT, OL-20261112-3 -> OL) over `window_days`: opened (opened + reopened), closed, open now,
net inflow = opened - closed, drain ratio = closed / opened. A family has a doer when a closer is registered for it (`config.doers`), something
closed one of its items in the window, or the executor can take one of its open items (foundation/queue.takeable before the criticality gate);
a family whose open items are all owner-held, parked after repeated failures or behind a protected probe has none. A family with net inflow above 0, an open backlog and no doer is missing a loop: it becomes ONE item
Q-DOER-<FAMILY> ("build the doer"), whose closing probe is `python3 -m foundation throughput --doer <FAMILY>`.

  python3 -m foundation throughput --tick [--apply]   record lifecycle events, compute families, file doer items
  python3 -m foundation throughput --report           the family table (no writes)
  python3 -m foundation throughput --doer FAMILY      exit 0 when FAMILY has a doer or no net inflow
"""
from __future__ import annotations
import json, re, subprocess, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import ledger

REPO = Path(__file__).resolve().parents[1]
LEDGER = "ops/issue-lifecycle.jsonl"
CLOSED = ("closed", "done")
DEFAULT = {"window_days": 7, "doers": {}}


def cfg(root=REPO) -> dict:
    from . import sauce
    return {**DEFAULT, **sauce.mechanism(root, "family-throughput").get("config", {})}


def family(item_id: str) -> str:
    m = re.match(r"^([A-Z]+)(?:-([A-Z]{2,}))?(?=-|$)", item_id)
    if not m:
        return item_id.split("-")[0] or item_id
    return m[1] + ("-" + m[2] if m[2] else "")


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def _norm(status: str) -> str:
    return "closed" if status in CLOSED else "open"


def git_seed(root: Path, current: dict[str, str]) -> list[dict]:
    """Opened/closed events from the history of docs/issues: one git call. Items git does not know are left for the live pass."""
    try:
        r = subprocess.run(["git", "-C", str(root), "log", "--format=\x1e%cI", "--name-status", "--", "docs/issues"], capture_output=True, text=True, encoding="utf-8", timeout=60)
    except (OSError, subprocess.SubprocessError):
        return []
    if r.returncode:
        return []
    added, touched = {}, {}
    for block in r.stdout.split("\x1e"):
        lines = [l for l in block.splitlines() if l.strip()]
        if not lines:
            continue
        when = datetime.fromisoformat(lines[0].strip()).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for l in lines[1:]:
            parts = l.split("\t")
            path = parts[-1]
            iid = Path(path).stem
            if iid not in current:
                continue
            touched[iid] = max(touched.get(iid, when), when)
            if parts[0].startswith("A"):
                added[iid] = min(added.get(iid, when), when)
    ev = []
    for iid, st in current.items():
        if iid in added:
            ev.append({"at": added[iid], "id": iid, "family": family(iid), "event": "opened", "source": "git-seed"})
            if st == "closed":
                ev.append({"at": touched.get(iid, added[iid]), "id": iid, "family": family(iid), "event": "closed", "source": "git-seed"})
    return ev


def known(rows: list[dict]) -> dict[str, str]:
    st = {}
    for r in rows:
        e = r.get("event")
        st[r["id"]] = "closed" if e == "closed" else "deleted" if e == "deleted" else "open"
    return st


def tick(root=REPO, apply=False, now=None, seed=True, takeable=None) -> dict:
    from . import queue
    root, now = Path(root), now or datetime.now(timezone.utc)
    at = _iso(now)
    current = {str(i["id"]): _norm(i["status"]) for i in queue.items(root)}
    rows = ledger.rows(root, LEDGER)
    ev = []
    if not rows and seed:
        ev = git_seed(root, current)
    st = known(rows + ev)
    for iid, s in current.items():
        k = st.get(iid)
        if k is None:
            ev.append({"at": at, "id": iid, "family": family(iid), "event": "opened" if s == "open" else "closed", "source": "first-seen" if not rows else "tick"})
        elif k in ("closed", "deleted") and s == "open":
            ev.append({"at": at, "id": iid, "family": family(iid), "event": "reopened", "source": "tick"})
        elif k == "open" and s == "closed":
            ev.append({"at": at, "id": iid, "family": family(iid), "event": "closed", "source": "tick"})
    for iid, k in st.items():
        if k != "deleted" and iid not in current:
            ev.append({"at": at, "id": iid, "family": family(iid), "event": "deleted", "was": k, "source": "tick"})
    if apply:
        ledger.append(root, LEDGER, ev)
    rep = report(root, now=now, extra=None if apply else ev, current=current, takeable=takeable)
    filed = file_doers(root, rep, apply)
    return {"at": at, "events": len(ev), **rep, "filed": filed}


def _executor_families(root) -> set[str]:
    from . import queue
    try:
        return {family(str(i["number"])) for i in queue.takeable(root, gated=False)}
    except Exception:  # an unreadable executor reach credits no family, so the gap shows instead of hiding
        return set()


def report(root=REPO, now=None, extra=None, current=None, takeable=None) -> dict:
    from . import queue
    root, now, c = Path(root), now or datetime.now(timezone.utc), cfg(root)
    exe = _executor_families(root) if takeable is None else {family(str(t)) for t in takeable}
    rows = ledger.rows(root, LEDGER) + (extra or [])
    since = _iso(now - timedelta(days=c["window_days"]))
    current = current if current is not None else {str(i["id"]): _norm(i["status"]) for i in queue.items(root)}
    fams: dict[str, dict] = {}
    for iid, s in current.items():
        f = fams.setdefault(family(iid), {"family": family(iid), "opened": 0, "closed": 0, "open": 0, "deleted_open": 0})
        f["open"] += s == "open"
    for r in rows:
        if (r.get("at") or "") < since or r.get("source") == "first-seen":
            continue  # first-seen rows are the baseline of a ledger that started without history, not inflow
        f = fams.setdefault(r["family"], {"family": r["family"], "opened": 0, "closed": 0, "open": 0, "deleted_open": 0})
        if r["event"] in ("opened", "reopened"):
            f["opened"] += 1
        elif r["event"] == "closed":
            f["closed"] += 1
        elif r["event"] == "deleted" and r.get("was") == "open":
            f["deleted_open"] += 1
    out = []
    for f in sorted(fams.values(), key=lambda x: x["family"]):
        f["net_inflow"] = f["opened"] - f["closed"]
        f["drain_ratio"] = round(f["closed"] / f["opened"], 2) if f["opened"] else None
        f["doer"] = c["doers"].get(f["family"]) or ("closed in window" if f["closed"] else "executor" if f["family"] in exe else None)
        out.append(f)
    without = [f["family"] for f in out if f["net_inflow"] > 0 and f["open"] > 0 and not f["doer"]]
    return {"window_days": c["window_days"], "families": out, "without_doer": without,
            "silent_drops": sum(f["deleted_open"] for f in out), "net_inflow_total": sum(f["net_inflow"] for f in out)}


def doer_item(f: dict) -> dict:
    fam = f["family"]
    iid = "Q-DOER-" + fam
    body = (f"**Owner:** operations\n**Trigger:** throughput pass: family {fam} has net inflow {f['net_inflow']} with {f['open']} open and no doer\n"
            f"**Done check:** cmd:python3 -m foundation throughput --doer {fam}\n**Status:** open\n\n"
            f"Items of family `{fam}` arrive faster than anything closes them: {f['opened']} opened and {f['closed']} closed in the window, {f['open']} open now. "
            "A family with net inflow and no doer is missing a loop, a probe or a closer. Build it: either a module that closes these items from their own "
            f"records (then register it under `config.doers.{fam}` of mechanism family-throughput in doctrine/qnfo-port.json), or give the items closing probes "
            "the contracts loop can run (foundation/contracts.py). Closing items by hand does not count: the probe passes when a doer is registered or the "
            "family drains.\n\nsize: M")
    return {"id": iid, "title": f"{iid}: build the doer for family {fam} (net inflow {f['net_inflow']}, {f['open']} open, nothing closes them)"[:240], "body": body,
            "labels": ["role:operations", "agent-ready", "ignition", "throughput"], "milestone": "Now", "workstream": "Autonomy"}


def file_doers(root: Path, rep: dict, apply: bool) -> list[str]:
    out = []
    for f in rep["families"]:
        if f["family"] not in rep["without_doer"] or f["family"] == "Q-DOER":
            continue
        j = doer_item(f)
        p = root / "docs/issues" / (j["id"] + ".json")
        if p.exists() and "**Status:** open" in json.loads(p.read_text(encoding="utf-8")).get("body", ""):
            continue  # one item per family, never duplicated
        out.append(j["id"])
        if apply:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
    return out


def doer_ok(fam: str, root=REPO) -> tuple[bool, str]:
    f = next((x for x in report(root)["families"] if x["family"] == fam), None)
    if not f:
        return True, f"family {fam} has no items"
    if f["doer"] or f["net_inflow"] <= 0:
        return True, f"{fam}: doer {f['doer'] or 'none needed'}, net inflow {f['net_inflow']}"
    return False, f"{fam}: net inflow {f['net_inflow']}, {f['open']} open, no doer"


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--doer" in a:
        ok, ev = doer_ok(a[a.index("--doer") + 1]); print(ev); return 0 if ok else 1
    if "--tick" in a:
        r = tick(apply="--apply" in a)
        print(json.dumps({k: r[k] for k in ("events", "without_doer", "silent_drops", "net_inflow_total", "filed")}))
        return 0
    if "--report" in a:
        r = report()
        for f in r["families"]:
            print(f"{f['family']:<14} opened {f['opened']:>3} closed {f['closed']:>3} open {f['open']:>3} net {f['net_inflow']:>+3} doer {f['doer'] or '-'}")
        print(json.dumps({k: r[k] for k in ("without_doer", "silent_drops", "net_inflow_total")}))
        return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DISPOSE-1 (Rowan, 2026-11-20): nothing sits in the queue for months. Ultrastable is the foundation for any autonomous system.

Every open item in docs/issues/ ends with a recorded disposition inside a bounded time, decided by code on the fleet pass (server-side: GitHub
Actions `fleet`, no person and no code agent session). Rules, first match wins (doctrine/dispose.json):

  gate      the owner field or a label says only the owner's account, money or signature can do it: closed at once, default in effect
  shelved   the executor failed `fail_limit` consecutive runs on it, or it has been open `ttl_days` and no loop closed it

A disposed item is closed, never deleted: the file keeps the rule, the measured evidence and its closing probe. The probe keeps running
(foundation/contracts.py): a pass turns the disposition into `fixed`, a fail does not reopen it. When the executor's open queue is empty it retries
shelved items, oldest attempt first (`revive()`, called by foundation/queue.py takeable), so capability added later still reaches them.

  python3 -m foundation dispose --run [--apply]   decide every open item; --apply writes the item files and ops/dispose.jsonl
  python3 -m foundation dispose --report          counts by status and disposition, and the age of the oldest open item
  python3 -m foundation dispose --check           the rules are well formed and no open item is older than ttl_days plus two days (exit 1 otherwise)
"""
from __future__ import annotations
import json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

from . import ledger

REPO = Path(__file__).resolve().parents[1]
DATA = "doctrine/dispose.json"
LEDGER = "ops/dispose.jsonl"
ISSUES = "docs/issues"
STATUS = re.compile(r"^\*\*Status:\*\*\s*(\S+)", re.M)
DISPOSITION = re.compile(r"^\*\*Disposition:\*\*\s*(gate|shelved|superseded|fixed)\b", re.M)
FIELD = lambda body, name: (re.search(rf"^\*\*{name}:\*\*\s*(.+)$", body, re.M) or [None, ""])[1].strip()


def cfg(root=REPO) -> dict:
    p = Path(root) / DATA
    return json.loads((p if p.is_file() else REPO / DATA).read_text(encoding="utf-8"))  # a root without its own rules (a temp copy, a new org) uses the platform default


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(s: str) -> datetime:
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def items(root=REPO) -> list[dict]:
    """Every item file with a Status line, queue items and the older roadmap rows alike (a row no loop reads is exactly what sits for months)."""
    out = []
    for p in sorted((Path(root) / ISSUES).glob("*.json")):
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        b = j.get("body", "") if isinstance(j, dict) else ""
        m = STATUS.search(b)
        if not m or "id" not in j:
            continue
        d = DISPOSITION.search(b)
        out.append({"id": str(j["id"]), "path": p, "json": j, "status": m.group(1).lower(), "owner": FIELD(b, "Owner"), "probe": FIELD(b, "Done check"),
                    "labels": [str(x) for x in j.get("labels", [])], "disposition": d.group(1).lower() if d else ""})
    return out


def created(root=REPO) -> dict[str, str]:
    """When each item file was added, from git history (one call). An item git cannot date is absent and is treated as new, so a shallow
    checkout never shelves anything by age."""
    r = subprocess.run(["git", "-C", str(root), "log", "--diff-filter=A", "--name-only", "--format=@%aI", "--", ISSUES], capture_output=True, text=True, encoding="utf-8", errors="replace")
    out, at = {}, ""
    for line in r.stdout.splitlines() if r.returncode == 0 else []:
        if line.startswith("@"):
            at = line[1:]
        elif line.strip():
            out[Path(line.strip()).name] = at  # the log runs newest first, so the last write per name is the oldest commit that added it
    return out


# DECISION-METRIC: work-queue-priority (which items leave the open queue and why; each disposition is a row in ops/dispose.jsonl, scored by whether the open count and the oldest open age fall)
def decide(it: dict, age_days: float | None, fails: int, c: dict, last_detail: str = "") -> tuple[str, str, str] | None:
    """(disposition, rule, evidence) for one open item, or None while it stays open. Pure."""
    if re.search(c["owner_bound"], it["owner"] + " " + " ".join(it["labels"]), re.I):
        return "gate", "owner-bound", (f"owner field '{it['owner'] or 'label'}' binds this to the owner's own account, money or signature, which no server-side loop holds. "
                                       f"Default in effect: {c['gate_default']}.")
    # LADDER-LIVE-1: a run that failed because no model answered says nothing about the item; shelving on it turned a dead ladder into 20 silent drops.
    if fails >= c["fail_limit"] and "every code agent rung failed" not in last_detail:
        return "shelved", "executor-failed", f"the executor failed {fails} consecutive runs on this item" + (f"; last reason: {last_detail[:240]}" if last_detail else "") + "."
    lim = ttl_days(c)
    if age_days is not None and age_days >= lim:
        return "shelved", "ttl", f"open {age_days * 24:.1f} hours (limit {lim * 24:g} hours) and no loop closed it (SLA-8H-1)."
    return None


def ttl_days(c: dict) -> float:
    """The age limit in days: ttl_hours (SLA-8H-1) when set, else ttl_days."""
    return c["ttl_hours"] / 24 if isinstance(c.get("ttl_hours"), (int, float)) and c["ttl_hours"] > 0 else c["ttl_days"]


def _write(it: dict, disposition: str, rule: str, evidence: str, at: str, c: dict) -> None:
    j = it["json"]
    body = STATUS.sub("**Status:** closed", j["body"], count=1)
    tail = "Its closing probe still runs on every fleet pass and records `fixed` when it passes"
    tail += "." if disposition == "gate" else f"; the executor retries it when its open queue is empty (every {c['revive_days']} days at most)."
    j["body"] = body.rstrip("\n") + f"\n\n**Disposition:** {disposition} ({rule}, {at}, DISPOSE-1)\n\n**Evidence:** {evidence} {tail}\n"
    it["path"].write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")


def mark_fixed(it: dict, why: str) -> None:
    """A disposed item whose closing probe now passes: the disposition becomes `fixed` and says what showed it."""
    j = it["json"]
    j["body"] = DISPOSITION.sub("**Disposition:** fixed", j["body"], count=1).rstrip("\n") + f"\n\n**Evidence:** {why}\n"
    it["path"].write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")


def run(root=REPO, apply=False, now=None, fails=None, born=None, details=None) -> list[dict]:
    """One pass over every open item. Returns the rows of the items that were disposed (and, with apply, writes them)."""
    root, now, c = Path(root), now or datetime.now(timezone.utc), cfg(root)
    if fails is None or details is None:
        from . import queue
        rows = queue.executor_rows(root)
        fails = queue.fail_counts(root) if fails is None else fails
        details = {str(r["issue"]): str(r.get("detail") or "") for r in rows if r.get("issue") is not None and r.get("result") == "failed"} if details is None else details
    born = created(root) if born is None else born
    out, at = [], _iso(now)
    for it in items(root):
        if it["status"] in c["final_statuses"]:
            continue
        b = born.get(it["path"].name)
        age = (now - _ts(b)).total_seconds() / 86400 if b else None
        d = decide(it, age, fails.get(it["id"], 0), c, details.get(it["id"], ""))
        if not d or len(out) >= c["max_per_pass"]:
            continue
        out.append({"at": at, "id": it["id"], "disposition": d[0], "rule": d[1], "evidence": d[2][:400], "age_days": None if age is None else round(age, 1), "status_before": it["status"]})
        if apply:
            _write(it, *d, at, c)
    if apply:
        ledger.append(root, LEDGER, out)
        _prune_pins(root, {r["id"] for r in out})
    return out


PINS = "doctrine/pins-baseline.json"


def _prune_pins(root, ids: set) -> None:
    """The pins check keeps a shrink-only list of open items whose done check is prose and fails when a listed item closes (the first live pass broke main on 11 gated
    roadmap rows). A disposed item leaves that list in the same pass."""
    p = Path(root) / PINS
    if not ids or not p.is_file():
        return
    j = json.loads(p.read_text(encoding="utf-8"))
    from . import pins
    still = {r["id"] for r in pins.unprobed(root)}  # the pins check's own reading of "still open without a probe"
    keep = [i for i in j.get("unprobed", []) if i not in ids or i in still]
    if len(keep) != len(j.get("unprobed", [])):
        j["unprobed"] = keep
        p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")


def revive(root=REPO, now=None, rows=None, born=None) -> list[dict]:
    """Shelved queue items the executor may retry now, least recently attempted first. Called only when its open queue is empty. An item is
    eligible when it has a machine probe and neither an executor row nor its shelving is younger than `revive_days`."""
    root, now, c = Path(root), now or datetime.now(timezone.utc), cfg(root)
    if rows is None:
        from . import queue
        rows = queue.executor_rows(root)
    last = {}
    for r in rows:
        if r.get("issue") is not None:
            last[str(r["issue"])] = r.get("at") or ""
    shelved_at = {str(r["id"]): r["at"] for r in ledger.rows(root, LEDGER) if r.get("disposition") == "shelved"}
    out = []
    for it in items(root):
        if it["disposition"] != "shelved" or not it["probe"].startswith(("file:", "grep:", "cmd:")) or not it["path"].name.startswith(("OL-", "Q-", "PORT-BRANCH-")):
            continue
        ref = max(last.get(it["id"], ""), shelved_at.get(it["id"], ""))
        if ref and (now - _ts(ref)).total_seconds() < c["revive_days"] * 86400:
            continue
        out.append((ref, it))
    return [it for _, it in sorted(out, key=lambda x: (x[0], x[1]["id"]))][: c["revive_per_pass"]]


def report(root=REPO, now=None) -> dict:
    root, now, born = Path(root), now or datetime.now(timezone.utc), created(root)
    c, counts, oldest = cfg(root), {}, 0.0
    for it in items(root):
        final = it["status"] in c["final_statuses"]
        k = (it["disposition"] or "closed") if final else "open"
        counts[k] = counts.get(k, 0) + 1
        b = born.get(it["path"].name)
        if not final and b:
            oldest = max(oldest, (now - _ts(b)).total_seconds() / 86400)
    return {"counts": dict(sorted(counts.items())), "open": counts.get("open", 0), "oldest_open_days": round(oldest, 1), "oldest_open_hours": round(oldest * 24, 1), "ttl_days": c["ttl_days"], "ttl_hours": round(ttl_days(c) * 24, 1)}


def check(root=REPO, now=None) -> list[str]:
    c, bad = cfg(root), []
    for k in ("ttl_days", "fail_limit", "revive_days", "revive_per_pass", "max_per_pass"):
        if not isinstance(c.get(k), int) or c[k] < 1:
            bad.append(f"{DATA}: {k} must be a positive integer")
    try:
        re.compile(c["owner_bound"])
    except (re.error, KeyError) as e:
        bad.append(f"{DATA}: owner_bound is not a usable pattern ({e})")
    if not bad:
        r = report(root, now)
        if r["oldest_open_hours"] > ttl_days(c) * 24 + 2:
            bad.append(f"an open item is {r['oldest_open_hours']} hours old, past the {ttl_days(c) * 24:g} hour limit plus two: the fleet pass is not disposing (DISPOSE-1, SLA-8H-1)")
    return bad


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--run" in a:
        rows = run(apply="--apply" in a)
        print("\n".join(f"{r['disposition']:<8} {r['id']}: {r['rule']}" for r in rows) or "nothing to dispose")
        print(json.dumps({"disposed": len(rows), **report()}))
        return 0
    if "--report" in a:
        print(json.dumps(report(), indent=1)); return 0
    if "--check" in a:
        bad = check()
        print("\n".join(bad) or "dispose ok"); return 1 if bad else 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLOW-BALANCE-1 (Rowan, 2026-11-21): every issue is resolved within its SLA, and the daily and weekly inflow of new issues never exceeds the
issues closed. Ultrastable is the foundation for any autonomous system, and this is the work queue's own ultrastable second loop.

First loop: the queue pass closes items by probe, the executor fixes them, dispose gives stale items a recorded disposition.
Second loop (this module), on every fleet pass (foundation/queue.py run), server-side:

  measure   inflow = items filed in the window (git add date), outflow = items closed with evidence in the window (git date of the status
            change), per day and per week; SLA = days allowed by priority label (doctrine/balance.json sla_days) against each open item's age.
  tipped    inflow > outflow in either window, or any open item past its SLA.
  correct   when tipped: (1) an open item whose normalised title equals an older open item's is superseded by it, with evidence;
            (2) a family (id prefix) that filed more than batch_threshold open items inside batch_window_days becomes one BATCH item that lists
            every member and closes only when every member's own probe has passed; (3) filing is throttled: admit() returns False once the day's
            quota (weekly outflow / 7, at least daily_quota_floor) is spent, and filers that call it skip a new item; (4) closure capacity rises:
            ops/balance.json closure_boost (read by the executor) goes up.
  honesty   superseded items lower NET inflow and are never counted as closures; outflow counts only fixed, gate and shelved closures, each of
            which carries evidence. Nothing is closed to move the number.

  python3 -m foundation balance --run [--apply]   measure, correct (with --apply writes items, ops/balance.json, site/balance-data.js)
  python3 -m foundation balance --report [--publish] the measurement as JSON; --publish writes ops/balance.json and the page data only
  python3 -m foundation balance --probe           exit 0 when balanced and inside SLA (closing probe of Q-BALANCE-*)
  python3 -m foundation balance --gate [--apply]   the filing gate every workflow runs before it commits docs/issues
  python3 -m foundation balance --check           the rules are well formed (exit 1 otherwise)
Stdlib only and free of other foundation imports, so seed/scripts/balance.py is this file and every system inherits it.
"""
from __future__ import annotations
import json, re, subprocess, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

_HERE = Path(__file__).resolve().parents[1]
# One copy for every system (FLOW-BALANCE-1, USER-BACKEND-1): in a seeded system this file is scripts/balance.py at the repository root; inside the
# platform repository it is seed/scripts/balance.py and foundation/balance.py loads it, so the root is one level higher.
REPO = _HERE.parent if _HERE.name == "seed" and (_HERE.parent / "foundation").is_dir() else _HERE
DATA = "doctrine/balance.json"
STATE = "ops/balance.json"
LEDGER = "ops/balance.jsonl"
SITE = "site/balance-data.js"
ISSUES = "docs/issues"
STATUS = re.compile(r"^\*\*Status:\*\*\s*(\S+)", re.M)
DISPOSITION = re.compile(r"^\*\*Disposition:\*\*\s*(\w+)", re.M)
PRIO = {"p0", "p1", "p2", "p3"}


def cfg(root=REPO) -> dict:
    for p in (Path(root) / DATA, Path(root) / "autonomy/balance.json", _HERE / "autonomy/balance.json"):
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    raise FileNotFoundError(DATA)


def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(s: str) -> datetime:
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def items(root=REPO) -> list[dict]:
    out = []
    for p in sorted((Path(root) / ISSUES).glob("*.json")):
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        b = j.get("body", "") if isinstance(j, dict) else ""
        m = STATUS.search(b or "")
        if not m or "id" not in j:
            continue
        d = DISPOSITION.search(b)
        out.append({"id": str(j["id"]), "name": p.name, "path": p, "json": j, "title": str(j.get("title", j["id"])), "status": m.group(1).lower(),
                    "labels": [str(x) for x in j.get("labels", [])], "probe": (re.search(r"^\*\*Done check:\*\*\s*(.+)$", b, re.M) or [None, ""])[1].strip(), "trigger": (re.search(r"^\*\*Trigger:\*\*\s*(.+)$", b, re.M) or [None, ""])[1].strip(), "disposition": d.group(1).lower() if d else ""})
    return out


def _git_dates(root, extra: list[str], oldest: bool) -> dict[str, str]:
    r = subprocess.run(["git", "-C", str(root), "log", *extra, "--name-only", "--format=@%aI", "--", ISSUES], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(f"balance: git log failed ({r.returncode}): {r.stderr.strip()[:200]}", file=sys.stderr)
        return {}
    out, at = {}, ""
    for line in r.stdout.splitlines():
        if line.startswith("@"):
            at = line[1:]
        elif line.strip():
            n = Path(line.strip()).name
            if oldest or n not in out:  # log is newest first: keep the last seen for the add date, the first seen for the close date
                out[n] = at
    return out


def born(root=REPO) -> dict[str, str]:
    return _git_dates(root, ["--diff-filter=A"], oldest=True)


def closed_at(root=REPO) -> dict[str, str]:
    return _git_dates(root, ["-E", r"-G\*\*Status:\*\* (closed|done|live)"], oldest=False)


def _shallow(root) -> bool:
    r = subprocess.run(["git", "-C", str(root), "rev-parse", "--is-shallow-repository"], capture_output=True, text=True)
    return r.returncode == 0 and r.stdout.strip() == "true"


def family(item_id: str, c: dict) -> str:
    m = re.match(c["family"], item_id)
    return m.group(1) if m else item_id


def norm_title(t: str) -> str:
    t = re.sub(r"^\S+:\s*", "", t or "")  # drop the item's own id; numbers stay, so "PR #830" and "PR #817" are different work
    return re.sub(r"[^a-z0-9#]+", " ", t.lower()).strip()


def sla_days(it: dict, c: dict) -> int:
    for lab in it["labels"]:
        if lab in c["sla_days"]:
            return int(c["sla_days"][lab])
    return int(c["sla_days"]["default"])


# DECISION-METRIC: issue-flow-balance (net inflow minus outflow per day and week, and SLA breaches; each pass is a row in ops/balance.jsonl and is scored by whether both fall)
def measure(its: list[dict], b: dict, cl: dict, now: datetime, c: dict) -> dict:
    """Pure: inflow, outflow and SLA per window from item files and their git dates."""
    fin = set(c["final_statuses"])
    win = {}
    for name, days in c["windows"].items():
        since = now - timedelta(days=days)
        filed = [i for i in its if b.get(i["name"]) and _ts(b[i["name"]]) >= since]
        sup = [i for i in filed if i["status"] in fin and i["disposition"] in c["never_closure"]]
        closed = [i for i in its if i["status"] in fin and i["disposition"] not in c["never_closure"] and cl.get(i["name"]) and _ts(cl[i["name"]]) >= since]
        net_in = len(filed) - len(sup)
        win[name] = {"days": days, "filed": len(filed), "superseded": len(sup), "net_inflow": net_in, "closed": len(closed),
                     "balance": len(closed) - net_in, "ok": net_in <= len(closed)}
    open_ = [i for i in its if i["status"] not in fin]
    breaches, ages = [], []
    for i in open_:
        a = (now - _ts(b[i["name"]])).total_seconds() / 86400 if b.get(i["name"]) else 0.0
        ages.append(a)
        if a > sla_days(i, c):
            breaches.append({"id": i["id"], "age_days": round(a, 1), "sla_days": sla_days(i, c)})
    breaches.sort(key=lambda r: -r["age_days"])
    within = len(open_) - len(breaches)
    tipped = not all(w["ok"] for w in win.values()) or bool(breaches)
    week_out = win.get("week", {}).get("closed", 0)
    quota = max(int(c["throttle"]["daily_quota_floor"]), int(week_out * c["throttle"]["quota_share_of_weekly_outflow"] / 7))
    filed_today = win.get("day", {}).get("net_inflow", 0)
    return {"at": _iso(now), "windows": win, "open": len(open_), "sla": {"within": within, "breached": len(breaches),
            "compliance": round(within / len(open_), 3) if open_ else 1.0, "oldest_days": round(max(ages), 1) if ages else 0.0, "worst": breaches[:10]},
            "tipped": tipped, "throttle": {"on": tipped, "daily_quota": quota, "quota_left": max(0, quota - filed_today) if tipped else None},
            "closure_boost": c["boost"]["tipped"] if tipped else c["boost"]["normal"]}


def consolidate(its: list[dict], b: dict, now: datetime, c: dict) -> list[dict]:
    """Pure: the corrective actions for one pass. Exact duplicates first, then floods from one family."""
    fin = set(c["final_statuses"])
    open_ = [i for i in its if i["status"] not in fin and not i["id"].startswith("BATCH-")]
    age = lambda i: b.get(i["name"]) or "9999"
    acts, gone = [], set()
    seen: dict[str, dict] = {}
    for i in sorted(open_, key=age):
        k = " || ".join((norm_title(i["title"]), i.get("trigger", ""), i.get("probe", "")))  # same words, trigger and closing probe: the same work, filed twice
        if len(k) < 16:
            continue
        if k in seen:
            acts.append({"act": "supersede", "id": i["id"], "by": seen[k]["id"], "why": f"same normalised title as the older open item {seen[k]['id']} with the same trigger and closing probe ('{k[:80]}')"})
            gone.add(i["id"])
        else:
            seen[k] = i
    since = now - timedelta(days=c["batch_window_days"])
    fams: dict[str, list] = {}
    for i in open_:
        if i["id"] in gone or not b.get(i["name"]) or _ts(b[i["name"]]) < since:
            continue
        f = family(i["id"], c)
        if f not in c.get("batch_exclude", []):
            fams.setdefault(f, []).append(i)
    for f, members in sorted(fams.items()):
        if len(members) <= c["batch_threshold"]:
            continue
        bid = f"BATCH-{f}-{now.strftime('%Y%m%d')}"
        acts.append({"act": "batch", "id": bid, "family": f, "members": sorted(m["id"] for m in members)})
    return acts[: c["max_supersede_per_pass"]]


def _close(it: dict, why: str, at: str) -> None:
    j = it["json"]
    j["body"] = STATUS.sub("**Status:** closed", j["body"], count=1).rstrip("\n") + f"\n\n**Disposition:** superseded (FLOW-BALANCE-1, {at})\n\n**Evidence:** {why}. Its closing probe still runs on every pass and marks it fixed when it passes; it is never counted as a closure.\n"
    it["path"].write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")


def apply_actions(root, its: list[dict], acts: list[dict], now: datetime) -> list[dict]:
    root, at, by_id, done = Path(root), _iso(now), {i["id"]: i for i in its}, []
    for a in acts:
        if a["act"] == "supersede" and a["id"] in by_id:
            _close(by_id[a["id"]], f"superseded by {a['by']}: {a['why']}", at)
            done.append(a)
        elif a["act"] == "batch":
            p = root / ISSUES / f"{a['id']}.json"
            if p.exists():
                continue
            lst = "\n".join(f"- {m}" for m in a["members"])
            body = (f"**Owner:** executor\n**Trigger:** FLOW-BALANCE-1: family {a['family']} filed {len(a['members'])} open items in one day while inflow exceeded closures\n"
                    f"**Done check:** cmd:python3 -m foundation balance --batch-probe {a['id']}\n**Status:** open\n\n"
                    f"One item for one flood: fix the shared cause once. Members (each keeps its own closing probe and turns fixed when it passes):\n\n{lst}\n\n"
                    "size: M\n\n**Closing probe:** every member's own probe has passed (its file shows Disposition fixed or Status closed with no superseded disposition).\n")
            p.write_text(json.dumps({"id": a["id"], "title": f"{a['id']}: {len(a['members'])} {a['family']} findings batched into one fix", "body": body,
                                     "labels": ["p1", "agent-ready", "batch"], "milestone": "Now", "workstream": "Operations", "members": a["members"]}, indent=2) + "\n", encoding="utf-8")
            for m in a["members"]:
                if m in by_id:
                    _close(by_id[m], f"batched into {a['id']} with {len(a['members']) - 1} siblings from family {a['family']}", at)
            done.append(a)
    return done


def batch_probe(root, bid: str) -> tuple[bool, str]:
    p = Path(root) / ISSUES / f"{bid}.json"
    if not p.is_file():
        return False, f"{bid} not found"
    members = json.loads(p.read_text(encoding="utf-8")).get("members", [])
    by = {i["id"]: i for i in items(root)}
    left = [m for m in members if m in by and by[m]["disposition"] in ("superseded", "") and by[m]["status"] not in ("done", "live")
            and not (by[m]["status"] == "closed" and by[m]["disposition"] == "")]
    return (not left), (f"{len(members) - len(left)} of {len(members)} members fixed" + (f"; open: {', '.join(left[:8])}" if left else ""))


def admit(root=REPO, item_id: str = "") -> bool:
    """Filers call this before writing a new item. False while the balance is tipped and today's quota is spent. A missing or unreadable state
    admits (the filer must never fail closed on the measurement)."""
    try:
        s = json.loads((Path(root) / STATE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return True
    t = s.get("throttle") or {}
    return not t.get("on") or (t.get("quota_left") or 0) > 0


def _file_balance_item(root, m: dict) -> str | None:
    i = "Q-BALANCE-flow"
    p = Path(root) / ISSUES / f"{i}.json"
    if not m["tipped"]:
        return None
    if p.exists():
        j = json.loads(p.read_text(encoding="utf-8"))
        if STATUS.search(j.get("body", "")) and STATUS.search(j["body"]).group(1).lower() == "open":
            return None
    w = m["windows"]
    body = (f"**Owner:** executor\n**Trigger:** FLOW-BALANCE-1 tipped at {m['at']}\n**Done check:** cmd:python3 -m foundation balance --probe\n**Status:** open\n\n"
            f"Day: {w['day']['net_inflow']} filed (net) vs {w['day']['closed']} closed. Week: {w['week']['net_inflow']} vs {w['week']['closed']}. "
            f"SLA: {m['sla']['breached']} of {m['open']} open items past their SLA, oldest {m['sla']['oldest_days']} days.\n\n"
            "Close the oldest SLA breaches first (fix, or an honest disposition with evidence), and remove the cause of the busiest filing family.\n\n"
            "size: M\n\n**Closing probe:** `python3 -m foundation balance --probe` exits 0.\n")
    p.write_text(json.dumps({"id": i, "title": f"{i}: issue inflow exceeds closures or items are past SLA", "body": body, "labels": ["p0", "agent-ready"],
                             "milestone": "Now", "workstream": "Operations"}, indent=2) + "\n", encoding="utf-8")
    return i


def run(root=REPO, apply=False, now=None, b=None, cl=None, publish=False) -> dict:
    root, now, c = Path(root), now or datetime.now(timezone.utc), cfg(root)
    if b is None and _shallow(root):  # a shallow clone dates every item to its graft commit: unmeasured, never "tipped" and never acted on
        return {"at": _iso(now), "unmeasured": "shallow checkout: git history cannot date the items", "tipped": False, "windows": {}, "sla": {}, "actions": {}, "open": None}
    b = born(root) if b is None else b
    cl = closed_at(root) if cl is None else cl
    its = items(root)
    before = measure(its, b, cl, now, c)
    acts = consolidate(its, b, now, c) if before["tipped"] else []
    done = apply_actions(root, its, acts, now) if apply else []
    m = measure(items(root), b, cl, now, c) if done else before
    m["actions"] = {"superseded": sum(1 for a in done if a["act"] == "supersede"), "batches": [a["id"] for a in done if a["act"] == "batch"], "planned": len(acts)}
    if apply:
        m["filed"] = _file_balance_item(root, m)
    if apply or publish:
        (root / "ops").mkdir(exist_ok=True)
        hist = []
        try:
            hist = json.loads((root / STATE).read_text(encoding="utf-8")).get("history", [])
        except (OSError, ValueError):
            pass
        row = {"at": m["at"], "day_in": m["windows"]["day"]["net_inflow"], "day_out": m["windows"]["day"]["closed"], "week_in": m["windows"]["week"]["net_inflow"],
               "week_out": m["windows"]["week"]["closed"], "week_balance": m["windows"]["week"]["balance"], "open": m["open"], "sla": m["sla"]["compliance"], "tipped": m["tipped"]}
        m["history"] = (hist + [row])[-90:]
        (root / STATE).write_text(json.dumps(m, indent=1) + "\n", encoding="utf-8")
        with (root / LEDGER).open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        if (root / "site").is_dir():
            (root / SITE).write_text("// GENERATED by python3 -m foundation balance --run --apply; do not edit.\n// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\nexport const BALANCE = "
                                     + json.dumps({k: v for k, v in m.items() if k != "filed"}) + ";\n", encoding="utf-8")
    return m


HELD = "ops/balance-held.jsonl"


def _untracked(root) -> list[Path]:
    r = subprocess.run(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=all", "--", ISSUES], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print(f"balance gate: git status failed: {r.stderr.strip()[:200]}", file=sys.stderr)
        return []
    return [Path(root) / l[3:].strip() for l in r.stdout.splitlines() if l.startswith("?? ") and l.strip().endswith(".json")]


def _rank(j: dict) -> int:
    labs = [str(x) for x in j.get("labels", [])]
    return next((n for n, p in enumerate(("p0", "p1", "p2", "p3")) if p in labs), 4)


# DECISION-METRIC: issue-flow-balance (which newly filed items enter the queue this pass while the balance is tipped)
def gate(root=REPO, apply=False, now=None, m=None) -> dict:
    """The one filing gate every source passes through (FLOW-BALANCE-1). Runs before a workflow commits docs/issues: new item files (not yet in
    git) above today's quota, while the balance is tipped, are held, not filed. A held item is kept whole in ops/balance-held.jsonl and is filed
    on a later pass when the balance has room, highest priority first; a source that files it again while it is held is just held again. Held
    items are not inflow and are never counted as closed."""
    root, now = Path(root), now or datetime.now(timezone.utc)
    m = m or run(root, now=now)
    new = sorted(_untracked(root), key=lambda p: (_rank(_load(p)), p.name))
    room = ((m.get("throttle") or {}).get("quota_left") or 0) if m.get("tipped") else 10 ** 6  # unmeasured (shallow clone) admits everything
    held_rows = _held(root)
    held_ids = {r["id"] for r in held_rows if not r.get("released")}
    hold, keep = [], []
    for p in new:
        (keep if room > 0 else hold).append(p)
        room -= 1 if p in keep else 0
    out = {"at": _iso(now), "tipped": m.get("tipped"), "admitted": [p.stem for p in keep], "held": [p.stem for p in hold], "released": []}
    rel = []
    if room > 0:
        for r in sorted((r for r in held_rows if not r.get("released")), key=lambda r: (_rank(r["json"]), r["at"])):
            if room <= 0:
                break
            if not (root / ISSUES / f"{r['id']}.json").exists():
                rel.append(r); room -= 1
    out["released"] = [r["id"] for r in rel]
    if apply:
        rows = []
        for p in hold:
            j = _load(p)
            if p.stem not in held_ids:
                rows.append({"at": out["at"], "id": p.stem, "json": j})
            p.unlink()
        for r in rel:
            (root / ISSUES / f"{r['id']}.json").write_text(json.dumps(r["json"], indent=2) + "\n", encoding="utf-8")
            rows.append({"at": out["at"], "id": r["id"], "released": True})
        if rows:
            (root / "ops").mkdir(exist_ok=True)
            with (root / HELD).open("a", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r) + "\n")
    return out


def _load(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _held(root) -> list[dict]:
    """Latest row per id: a hold, or a release that ends it."""
    last = {}
    f = Path(root) / HELD
    for line in (f.read_text(encoding="utf-8").splitlines() if f.is_file() else []):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        last[r["id"]] = {**last.get(r["id"], {}), **r} if r.get("released") else r
    return list(last.values())


def check(root=REPO) -> list[str]:
    c, bad = cfg(root), []
    for k in ("sla_days", "windows", "family", "batch_threshold", "throttle", "boost", "final_statuses", "never_closure"):
        if k not in c:
            bad.append(f"doctrine/balance.json: missing {k}")
    import glob as _g
    for wf in sorted(_g.glob(str(Path(root) / ".github/workflows/*.yml"))):  # every workflow that lands items passes the one filing gate first
        t = Path(wf).read_text(encoding="utf-8")
        if re.search(r"git add\b[^\n]*\bdocs/issues\b", t) and not re.search(r"balance(\.py)? --gate", t):
            bad.append(f"{Path(wf).name}: commits docs/issues without `python3 -m foundation balance --gate --apply` first (FLOW-BALANCE-1)")
    if "superseded" in c.get("counts_as_closure", []):
        bad.append("doctrine/balance.json: superseded may never count as a closure")
    try:
        re.compile(c.get("family", ""))
    except re.error as e:
        bad.append(f"doctrine/balance.json: family regex: {e}")
    return bad


def main(argv: list[str]) -> int:
    root = Path(argv[argv.index("--root") + 1]) if "--root" in argv else REPO
    if "--gate" in argv:
        print(json.dumps(gate(root, apply="--apply" in argv), indent=1)); return 0
    if "--batch-probe" in argv:
        ok, why = batch_probe(root, argv[argv.index("--batch-probe") + 1])
        print(why); return 0 if ok else 1
    if "--run" in argv or "--report" in argv or "--probe" in argv:
        m = run(root, apply="--apply" in argv and "--run" in argv, publish="--publish" in argv)
        if "--probe" in argv:
            if m.get("unmeasured"):
                print("unmeasured:", m["unmeasured"]); return 1
            w = m["windows"]
            print(f"day {w['day']['net_inflow']} in / {w['day']['closed']} out; week {w['week']['net_inflow']} in / {w['week']['closed']} out; SLA {m['sla']['breached']} breached")
            return 1 if m["tipped"] else 0
        print(json.dumps({k: v for k, v in m.items() if k != "history"}, indent=1)); return 0
    bad = check(root)
    print("\n".join(bad) or "balance ok: rules well formed"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

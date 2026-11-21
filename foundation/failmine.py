# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FAILMINE-1 (Rowan, 2026-11-21): "The Ultrastable system shall always audit and remediate all failure modes and their root causes automatically."

failure_audit.py runs the detectors of failure modes somebody registered. This module finds the failures nobody registered, from what the loops
already write, and closes the loop on recurrence:

  1. mine: every failure record the system writes becomes an event: queue items of the failure families in docs/issues/ (Q-CIFAIL, Q-AUDIT,
     OL-PR, STALL, MISSED, Q-OPENLOOP, tick failures, breaches, ...), red runs in ops/ciwatch.jsonl, failed rows in ops/executor-log.jsonl and
     failing rows of ops/failure-audit.jsonl. Opened and closed times come from git history and the item body, never from a guess.
  2. signature: the event text with ids, numbers, hashes and dates removed, so one failure seen on PR 596 and PR 1461 is one signature.
  3. root cause class: a fixed taxonomy (ROOT_CAUSES) that names the class, the 5-whys root cause, the mechanism that owns the fix and the
     registered failure mode it belongs to. A class with no registered mode is unregistered.
  4. discover (--apply): a signature seen DISCOVER_MIN times whose class has no registered failure mode is appended to doctrine/registers.json
     as fm-discovered-<hash> with a command detector in doctrine/detectors.json (`failmine --probe <hash>`), so failure_audit watches it daily.
  5. escalate (--apply): a signature seen twice is filed as Q-RECUR-<hash> with disposition `mutate` (change the approach); three times or more
     `incident` (redesign, no fourth attempt of the same fix). The item closes itself when its probe passes: no event of that signature is open
     and none opened within QUIET_DAYS.
  6. measure: recurrence rate (events that repeat an earlier signature / events), mean and median time to remediation of closed events, open
     events, written to ops/failmine.json and site/failmine-data.js; /failures shows it.

  python3 -m foundation failmine --report            the measurement as JSON (no writes)
  python3 -m foundation failmine --run [--apply]     mine, discover, escalate, measure; --apply writes registers, detectors, items and data
  python3 -m foundation failmine --probe HASH        exit 0 when the signature is quiet (closing probe of Q-RECUR-HASH and fm-discovered-HASH)
  python3 -m foundation failmine --check             taxonomy valid, every class maps to a registered mode or is marked unregistered
"""
from __future__ import annotations
import hashlib, json, re, statistics, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DISCOVER_MIN = 3
QUIET_DAYS = 7
OUT = "ops/failmine.json"
SITE = "site/failmine-data.js"
FAMILIES = re.compile(r"^(Q-CIFAIL|Q-AUDIT|OL-PR|STALL|MISSED|Q-OPENLOOP|NC-PLUS-TICKFAIL|Q-CRIT-STALL|BREACH|EXEC-SPARK|Q-RUNWAY|Q-INCIDENT|IGNITE)")

# class, regex over the event text, 5-whys root cause, owning mechanism, registered failure mode (None = unregistered, discover registers it)
ROOT_CAUSES = [
    ("merge-conflict", r"conflict|marker|<<<<<<<|cannot be merged|not mergeable|dirty",
     "two writers change one generated or append-only file and the second PR cannot apply", "scripts/resolve_generated.py, scripts/no_markers.py", "fm-lane-rebase-wedge"),
    ("gate-skipped", r"merged without a green|checks run at .skipped|bypass",
     "a merge path reads mergeable_state instead of a green full checks run", "foundation/mergeaudit.py, green guard", "fm-merge-without-checks"),
    ("pr-stuck", r"^ol-pr|stuck|open for \d|idle pr|waiting on|not merged",
     "nothing server-side owns the PR after the session that opened it ends", "seed/worker/src/sweeper.js lane", "fm-waiting-on-person"),
    ("loop-stalled", r"stall|missed|stopped|late clock|idle|no beat|silent",
     "a loop has one trigger and that trigger did not fire", "foundation/resilience.py, seed/worker/src/pulse.js", "fm-clock-silent"),
    ("tick-step-failed", r"tickfail|tick step|tick failed",
     "a tick step throws on a table or binding whose migration did not run", "seed/worker/src/tick.js", "fm-clock-silent"),
    ("model-retired", r"retired|model .*not found|no such model|deprecated model|unknown model",
     "a hosted model id is hard-coded and the provider retires it", "foundation/modelwatch.py", None),
    ("credential", r"token|sign.?in|expired|unauthori[sz]ed|\b401\b|\b403\b|oauth|session expired",
     "a credential lapses with no renewal probe ahead of expiry", "foundation/credwatch.py, seed/worker/src/auth/", None),
    ("quota-governor", r"quota|governor|budget|\b429\b|rate.?limit|neurons|spending limit|billing",
     "a fixed cap refuses work instead of throttling against measured spend", "seed/worker/src/budget.js soft throttle", None),
    ("trivial-change", r"trivial|substan|only a hash|illusion",
     "a generator or bot commits volatile values instead of behaviour", "foundation/substance.py", None),
    ("migration-incomplete", r"migration|half.?done|cutover|domain move|account move|transfer",
     "a migration has no end-state probe, so it stops part way", "deploy/transfer, foundation/platformaudit.py", None),
    ("test-host", r"importerror|incorrectly imported|module .*not found|host.?depend|no module named",
     "a test depends on import order or on the host it runs on", "tests/foundation/test_layout.py", "fm-tests-red"),
    ("ci-red", r"cifail|checks fail|red|failed step|workflow fail|failure",
     "a change merged or main moved while a check was red", "foundation/redmain.py", "fm-tests-red"),
]
_RX = [(c, re.compile(rx, re.I), why, own, fm) for c, rx, why, own, fm in ROOT_CAUSES]


def classify(text: str) -> str:
    for c, rx, *_ in _RX:
        if rx.search(text):
            return c
    return "other"


def signature(text: str) -> str:
    t = text.lower()
    t = re.sub(r"\b[a-z]+(-[a-z0-9]+)*-\d[\w-]*", " ", t)          # item ids such as q-cifail-mergeaudit-1461
    t = re.sub(r"\b[0-9a-f]{7,40}\b", " ", t)                     # hashes
    t = re.sub(r"\d{4}-\d\d-\d\d[t ]?[\d:.z]*", " ", t)            # dates
    t = re.sub(r"[#\d]+", " ", t)
    t = re.sub(r"[^a-z ]+", " ", t)
    return " ".join(t.split()[:14])


def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:10]


def _git(root, *a) -> str:
    try:
        r = subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout if r.returncode == 0 else ""


def _shallow_boundary(root) -> set:
    """Commits at the edge of a shallow clone. git reports every file they hold as added there, so their time is the clone
    depth, not when an event happened (root cause of Q-RECUR probes that never go quiet in CI checkouts)."""
    p = _git(root, "rev-parse", "--git-path", "shallow").strip()
    if not p:
        return set()
    f = Path(p) if Path(p).is_absolute() else Path(root) / p
    try:
        return {line.strip() for line in f.read_text(encoding="utf-8").splitlines() if line.strip()}
    except OSError:
        return set()


def _git_times(root) -> tuple[dict, dict]:
    """First-added and last-changed commit time per docs/issues file, from two git passes. Commits at a shallow-clone
    boundary are skipped, so a file whose history is cut off has no git time rather than the boundary's time."""
    boundary = _shallow_boundary(root)
    first, last = {}, {}
    for out, keep in ((_git(root, "log", "--diff-filter=A", "--format=@%H %cI", "--name-only", "--", "docs/issues"), first),
                      (_git(root, "log", "--format=@%H %cI", "--name-only", "--", "docs/issues"), last)):
        at = ""
        for line in out.splitlines():
            if line.startswith("@"):
                sha, _, when = line[1:].partition(" ")
                at = "" if sha in boundary else when
            elif line.strip():
                n = Path(line.strip()).name
                if not at:
                    continue
                if keep is first:
                    keep[n] = at          # log is newest first; the last write is the oldest add
                else:
                    keep.setdefault(n, at)
    return first, last


_ID_TIME = re.compile(r"(\d{4}-\d\d-\d\d)(?:T(\d\d))?")


def _event_time(stem: str, body: str, git_first: str) -> str:
    """When an issue event happened: the git add time, else a date the id or body carries (shallow clones cut history)."""
    if git_first:
        return git_first
    m = _ID_TIME.search(stem) or _ID_TIME.search(body)
    if m:
        return f"{m.group(1)}T{m.group(2) or '00'}:00:00+00:00"
    return ""


def _ts(s: str):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, AttributeError):
        return None


def _jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue  # a torn line in an append-only ledger is skipped, counted below as unread
    return rows


def mine(root=REPO) -> list[dict]:
    root = Path(root)
    first, last = _git_times(root)
    ev = []
    for p in sorted((root / "docs/issues").glob("*.json")):
        if not FAMILIES.match(p.stem):
            continue
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        body = j.get("body", "")
        closed = "**Status:** closed" in body or "**Status:** done" in body or "**Disposition:**" in body
        m = re.search(r"\*\*(?:Evidence|Disposition)[^\n]*?(\d{4}-\d\d-\d\dT[\d:]+Z)", body)
        text = (j.get("title", "") + " " + body[:600])
        ev.append({"source": "issue", "id": p.stem, "text": j.get("title", "") or p.stem, "class": classify(p.stem + " " + text),
                   "opened": _event_time(p.stem, body, first.get(p.name, "")),
                   "closed": (m.group(1) if m else (last.get(p.name, "") or "unknown")) if closed else ""})
    for r in _jsonl(root / "ops/ciwatch.jsonl"):
        if r.get("conclusion") in ("failure", "timed_out", "startup_failure"):
            t = f"{r.get('workflow', '')} workflow failure {r.get('conclusion')}"
            ev.append({"source": "ci", "id": f"ci-{r.get('run')}", "text": t, "class": classify("ci-red " + t), "opened": r.get("at", ""), "closed": ""})
    for r in _jsonl(root / "ops/executor-log.jsonl"):
        if str(r.get("result", "")).startswith("failed"):
            t = str(r.get("result")) + " " + str(r.get("reason") or r.get("error") or "")
            ev.append({"source": "executor", "id": f"exec-{r.get('at')}", "text": t[:200], "class": classify(t), "opened": r.get("at", ""), "closed": ""})
    for r in _jsonl(root / "ops/failure-audit.jsonl"):
        if r.get("status") not in (None, "pass") and r.get("streak") == 1:
            t = f"{r.get('id')} {r.get('evidence', '')[-160:]}"
            ev.append({"source": "audit", "id": f"audit-{r.get('id')}-{r.get('at')}", "text": t, "class": classify(t), "opened": r.get("at", ""), "closed": ""})
    for e in ev:
        if e["source"] == "issue":  # the id carries the structure (family, workflow, tick step); the title adds the reason for generic families
            stem = re.sub(r"-?\d.*$", "", e["id"])
            e["signature"] = (stem.lower() + " " + (" ".join(signature(e["text"]).split()[:6]) if stem.count("-") <= 2 else "")).strip()
        else:
            e["signature"] = signature(e["text"]) or e["class"]
        e["sig"] = _h(e["class"] + "|" + e["signature"])
    return ev


def measure(ev: list[dict], now=None) -> dict:
    now = now or datetime.now(timezone.utc)
    by = {}
    for e in sorted(ev, key=lambda e: e["opened"] or ""):
        by.setdefault(e["sig"], []).append(e)
    repeats = sum(len(v) - 1 for v in by.values())
    hours = []
    for e in ev:
        o, c = _ts(e["opened"]), _ts(e["closed"])
        if o and c and c >= o:
            hours.append((c - o).total_seconds() / 3600)
    classes = {}
    for e in ev:
        k = classes.setdefault(e["class"], {"events": 0, "open": 0, "signatures": set()})
        k["events"] += 1
        k["open"] += 0 if e["closed"] else 1
        k["signatures"].add(e["sig"])
    meta = {c: (why, own, fm) for c, _, why, own, fm in ROOT_CAUSES}
    sigs = []
    for s, v in by.items():
        if len(v) < 2:
            continue
        sigs.append({"sig": s, "class": v[0]["class"], "signature": v[0]["signature"], "count": len(v), "open": sum(1 for e in v if not e["closed"]),
                     "last": max(e["opened"] for e in v), "ids": [e["id"] for e in v][-6:], "disposition": "incident" if len(v) >= 3 else "mutate"})
    sigs.sort(key=lambda s: (-s["count"], s["sig"]))
    return {
        "schema": "ultrastable-failmine/1", "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "events": len(ev), "open": sum(1 for e in ev if not e["closed"]), "signatures": len(by),
        "recurrence_rate": round(repeats / len(ev), 3) if ev else 0.0,
        "mttr_hours_mean": round(statistics.mean(hours), 1) if hours else None,
        "mttr_hours_median": round(statistics.median(hours), 1) if hours else None, "remediated": len(hours),
        "classes": [{"class": c, "events": k["events"], "open": k["open"], "signatures": len(k["signatures"]),
                     "root_cause": meta.get(c, ("unclassified: register a class in foundation/failmine.py ROOT_CAUSES", "", None))[0],
                     "owner": meta.get(c, ("", "foundation/failmine.py", None))[1], "failure_mode": meta.get(c, ("", "", None))[2]}
                    for c, k in sorted(classes.items(), key=lambda t: -t[1]["events"])],
        "recurring": sigs[:40],
    }


def _registered(root) -> set:
    return {m["id"] for m in json.loads((Path(root) / "doctrine/registers.json").read_text(encoding="utf-8"))["failure_modes"]}


def discover(ev: list[dict], root=REPO, apply=False) -> list[str]:
    """Signatures seen DISCOVER_MIN times whose class has no registered failure mode become fm-discovered-<hash> with a live detector."""
    root = Path(root)
    reg_ids = _registered(root)
    fm_of = {c: fm for c, _, _, _, fm in ROOT_CAUSES}
    counts = {}
    for e in ev:
        counts.setdefault(e["sig"], []).append(e)
    new = []
    for s, v in sorted(counts.items()):
        fm = fm_of.get(v[0]["class"])
        if len(v) < DISCOVER_MIN or (fm and fm in reg_ids) or f"fm-discovered-{s}" in reg_ids:
            continue
        new.append((s, v))
    if apply and new:
        rp, dp = root / "doctrine/registers.json", root / "doctrine/detectors.json"
        reg, det = json.loads(rp.read_text(encoding="utf-8")), json.loads(dp.read_text(encoding="utf-8"))
        why = {c: (w, o) for c, _, w, o, _ in ROOT_CAUSES}
        for s, v in new:
            w, o = why.get(v[0]["class"], ("unclassified recurring failure", "foundation/failmine.py"))
            reg["failure_modes"].append({"id": f"fm-discovered-{s}", "trigger": v[0]["signature"][:160], "symptom": f"{len(v)} events of class {v[0]['class']}",
                                         "blast_radius": "unknown until remediated", "detection": f"python3 -m foundation failmine --probe {s}",
                                         "root_cause": w, "remediation": f"fix in {o}; the probe passes when the signature is quiet {QUIET_DAYS} days",
                                         "status": "open", "cadence_ticks": 144, "probe": f"grep:foundation/failmine.py::def probe"})
            det["detectors"].append({"id": f"discovered-{s}", "failure_mode": f"fm-discovered-{s}", "kind": "command",
                                     "run": ["python3", "-m", "foundation", "failmine", "--probe", s], "timeout": 60,
                                     "root_cause": w, "owner": "operations", "remedy": f"Remove the cause in {o}; seen in " + ", ".join(e["id"] for e in v[-4:])})
        rp.write_text(json.dumps(reg, indent=1) + "\n", encoding="utf-8")
        dp.write_text(json.dumps(det, indent=1) + "\n", encoding="utf-8")
    return [f"fm-discovered-{s}" for s, _ in new]


def escalate(m: dict, root=REPO, apply=False) -> list[str]:
    root = Path(root)
    filed = []
    for s in m["recurring"]:
        p = root / "docs/issues" / f"Q-RECUR-{s['sig']}.json"
        quiet, why = probe(s["sig"], root, m=m)
        if quiet:
            if apply and p.exists():
                j = json.loads(p.read_text(encoding="utf-8"))
                if "**Status:** open" in j["body"]:
                    j["body"] = j["body"].replace("**Status:** open", "**Status:** closed") + f"\n**Evidence:** {why}\n"
                    p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
            continue
        k = next((c for c in m["classes"] if c["class"] == s["class"]), {})
        body = (f"**Owner:** executor\n**Trigger:** the failure miner files it after every merge and daily\n"
                f"**Done check:** cmd:python3 -m foundation failmine --probe {s['sig']}\n**Status:** open\n\n"
                f"Recurring failure, class `{s['class']}`, seen {s['count']} times (open {s['open']}, last {s['last']}).\n"
                f"Signature: {s['signature']}\nEvents: {', '.join(s['ids'])}\n"
                f"Root cause (5 whys): {k.get('root_cause', '')}\nOwning mechanism: {k.get('owner', '')}\n"
                + ("Seen twice: the last fix did not hold. Change the approach, do not repeat the fix.\n" if s["disposition"] == "mutate" else
                   "Seen three or more times: incident. Redesign the owning mechanism so this class cannot recur; a fourth attempt of the same fix is not allowed.\n")
                + f"\n**Closing probe:** cmd:python3 -m foundation failmine --probe {s['sig']}\n")
        item = {"id": f"Q-RECUR-{s['sig']}", "title": f"Q-RECUR-{s['sig']}: {s['class']} recurred {s['count']}x: {s['signature'][:80]}"[:200], "body": body,
                "labels": ["audit", s["disposition"], "agent-ready", "p1", "raises-self"], "milestone": "Now", "workstream": "Failure modes"}
        if apply:
            old = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
            if not old or old.get("labels") != item["labels"] or f"seen {s['count']} times" not in old.get("body", ""):
                p.write_text(json.dumps(item, indent=2) + "\n", encoding="utf-8")
        filed.append(item["id"])
    return filed


def probe(sig: str, root=REPO, m=None) -> tuple[bool, str]:
    root = Path(root)
    if m is None:
        ev = [e for e in mine(root) if e["sig"] == sig]
    else:
        ev = None
    now = datetime.now(timezone.utc)
    if ev is None:
        s = next((s for s in m["recurring"] if s["sig"] == sig), None)
        if not s:
            return True, f"{sig}: not recurring"
        o, last = s["open"], _ts(s["last"])
    else:
        if not ev:
            return True, f"{sig}: no events"
        o = sum(1 for e in ev if not e["closed"])
        last = max((_ts(e["opened"]) for e in ev if _ts(e["opened"])), default=None)
    recent = last is not None and (now - last).days < QUIET_DAYS
    ok = o == 0 and not recent
    return ok, f"{sig}: {o} open, last seen {last.isoformat() if last else 'unknown'}" + ("" if ok else f" (quiet means 0 open and none in {QUIET_DAYS} days)")


def write(m: dict, root=REPO) -> None:
    root = Path(root)
    stable = {k: v for k, v in m.items() if k != "at"}
    op = root / OUT
    if op.exists():
        try:
            if {k: v for k, v in json.loads(op.read_text(encoding="utf-8")).items() if k != "at"} == stable:
                return  # SUBSTANCE-1: no rewrite for a timestamp alone
        except ValueError:
            pass
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(m, indent=1) + "\n", encoding="utf-8")
    (root / SITE).write_text("// GENERATED by python3 -m foundation failmine --run --apply; do not edit.\n// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n"
                             "export const FAILMINE = " + json.dumps(m, indent=1) + ";\n", encoding="utf-8")


def check(root=REPO) -> list[str]:
    problems, reg = [], _registered(root)
    seen = set()
    for c, rx, why, own, fm in ROOT_CAUSES:
        if c in seen:
            problems.append(f"{c}: duplicate class")
        seen.add(c)
        re.compile(rx)
        if fm and fm not in reg:
            problems.append(f"{c}: maps to {fm}, which doctrine/registers.json does not list")
        if not why or not own:
            problems.append(f"{c}: needs a root cause and an owning mechanism")
    if not (Path(root) / SITE).exists():
        problems.append(f"{SITE} missing: run failmine --run --apply")
    return problems


def run(root=REPO, apply=False) -> dict:
    ev = mine(root)
    m = measure(ev)
    m["discovered"] = discover(ev, root, apply)
    m["escalated"] = escalate(m, root, apply)
    if apply:
        write(m, root)
    return m


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        p = check()
        print("failmine ok" if not p else "\n".join(p))
        return 1 if p else 0
    if "--probe" in a:
        ok, why = probe(a[a.index("--probe") + 1])
        print(why)
        return 0 if ok else 1
    if "--report" in a:
        print(json.dumps(measure(mine()), indent=1))
        return 0
    if "--run" in a:
        m = run(apply="--apply" in a)
        print(json.dumps({k: m[k] for k in ("events", "open", "signatures", "recurrence_rate", "mttr_hours_median", "discovered", "escalated")}, indent=1))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())

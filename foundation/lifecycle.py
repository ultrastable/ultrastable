"""LIFECYCLE-1: every session ends with a disposition, and every loop improves itself. Ultrastable is the foundation for any autonomous system.

SESSIONS. Each agent session is an append-only lease in ops/sessions.jsonl: open, beat (heartbeat), close. A lease with no heartbeat inside its TTL is a
zombie; the reaper closes it with disposition 'reaped', re-queues its item and files an incident when one agent is reaped repeatedly. Accounting
invariant: entered = open + closed_with_disposition, and open sessions that are stale = 0.

STRANGE LOOP. The improver reads the loops' own evidence (ops/loop-evidence), scores each loop (pass rate, consecutive failures), and acts on the
loop-breaker rule: same loop failing twice -> a mutation item; three times -> a redesign incident; a pass-rate regression -> a mutation item. It scores
itself with the same rules (loop id 'improve': mutation items opened vs closed), so the mechanism that improves loops is itself improved.
Every change is a logged prediction in ops/improvements.jsonl, scored later: kept if the target moved, else an OL-REVERT item.

  python3 -m foundation lifecycle --open AGENT [--item ID] | --beat SID | --close SID DISPOSITION [--item ID] | --reap | --check [--agent A] | --hooks
  python3 -m foundation lifecycle --improve | --score | --report | --passing LOOP
"""
from __future__ import annotations
import datetime as dt, json, re, secrets
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SESSIONS = "ops/sessions.jsonl"
IMPROVE = "ops/improvements.jsonl"
EVIDENCE = "ops/loop-evidence"
TTL_MIN = 45
DISPOSITIONS = ("done", "backlogged", "superseded", "reaped")
REAPS_BEFORE_INCIDENT = 3
WINDOW_DAYS = 7


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(t: dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(s: str) -> dt.datetime:
    return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def _append(root, rel: str, rec: dict) -> None:
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(rec, separators=(",", ":")) + "\n")


def _read(root, rel: str) -> list:
    p = Path(root) / rel
    if not p.exists():
        return []
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


# ---------------------------------------------------------------- sessions
def open_session(root, agent: str, item: str = "", ttl_min: int = TTL_MIN, now=None) -> str:
    sid = "S-" + secrets.token_hex(4)
    _append(root, SESSIONS, {"ev": "open", "id": sid, "agent": agent, "item": item, "ttl_min": ttl_min, "at": _iso(now or _now())})
    return sid


def beat(root, sid: str, now=None) -> None:
    _append(root, SESSIONS, {"ev": "beat", "id": sid, "at": _iso(now or _now())})


def close_session(root, sid: str, disposition: str, item: str = "", now=None) -> None:
    if disposition not in DISPOSITIONS:
        raise ValueError(f"disposition must be one of {DISPOSITIONS}")
    if disposition == "backlogged" and not (item and (Path(root) / "docs/issues" / f"{item}.json").is_file()):
        raise ValueError("backlogged needs the id of an existing item in docs/issues (owner, trigger, probe)")
    _append(root, SESSIONS, {"ev": "close", "id": sid, "disposition": disposition, "item": item, "at": _iso(now or _now())})


def state(root) -> dict:
    s = {}
    for e in _read(root, SESSIONS):
        r = s.setdefault(e["id"], {"id": e["id"], "agent": e.get("agent"), "item": e.get("item", ""), "ttl_min": e.get("ttl_min", TTL_MIN), "opened": e["at"], "last": e["at"], "closed": None})
        if e["ev"] == "open":
            r.update(agent=e["agent"], item=e.get("item", ""), ttl_min=e.get("ttl_min", TTL_MIN), opened=e["at"])
        r["last"] = max(r["last"], e["at"])
        if e["ev"] == "close":
            r["closed"] = {"disposition": e["disposition"], "item": e.get("item", ""), "at": e["at"]}
    return s


def _incident(root, agent: str, n: int) -> str:
    iid = f"OL-ZOMBIE-{re.sub('[^A-Za-z0-9]+', '-', agent)}"
    p = Path(root) / "docs/issues" / f"{iid}.json"
    if not p.exists():
        body = (f"**Owner:** operations\n**Trigger:** every heartbeat\n**Done check:** cmd:python3 -m foundation lifecycle --check --agent {agent}\n**Status:** open\n\n"
                f"Agent {agent} had {n} sessions reaped without a heartbeat in {WINDOW_DAYS} days. Root cause, not symptom: find why it stops beating "
                f"(no hook, TTL too short for its work, crash) and fix that. Closes when its reaped count falls below {REAPS_BEFORE_INCIDENT}.")
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: agent {agent} keeps leaving zombie sessions", "body": body,
                                 "labels": ["role:operations", "open-loop", "lifecycle"], "milestone": "Now", "workstream": "Open loops"}, indent=2) + "\n", encoding="utf-8")
    return iid


def reaped_count(root, agent: str, now=None) -> int:
    cut = _iso((now or _now()) - dt.timedelta(days=WINDOW_DAYS))
    return sum(1 for r in state(root).values() if r["agent"] == agent and r["closed"] and r["closed"]["disposition"] == "reaped" and r["closed"]["at"] >= cut)


def reap(root, now=None) -> dict:
    """Close every lease whose heartbeat is older than its TTL. The item it held is not lost: it stays open in docs/issues and its claim lapses."""
    now = now or _now()
    reaped, incidents = [], []
    for r in state(root).values():
        if r["closed"] or now - _parse(r["last"]) <= dt.timedelta(minutes=r["ttl_min"]):
            continue
        _append(root, SESSIONS, {"ev": "close", "id": r["id"], "disposition": "reaped", "item": r["item"], "at": _iso(now)})
        reaped.append(r["id"])
    for a in {state(root)[i]["agent"] for i in reaped}:
        n = reaped_count(root, a, now)
        if n >= REAPS_BEFORE_INCIDENT:
            incidents.append(_incident(root, a, n))
    return {"reaped": reaped, "incidents": incidents}


def check(root=REPO, agent: str = "", now=None) -> list:
    now, bad = now or _now(), []
    st = state(root)
    if agent:
        n = reaped_count(root, agent, now)
        return [f"agent {agent}: {n} reaped sessions in {WINDOW_DAYS} days (limit {REAPS_BEFORE_INCIDENT - 1})"] if n >= REAPS_BEFORE_INCIDENT else []
    entered = len({e["id"] for e in _read(root, SESSIONS) if e["ev"] == "open"})
    openn = [r for r in st.values() if not r["closed"]]
    closed = [r for r in st.values() if r["closed"]]
    if entered != len(openn) + len(closed):
        bad.append(f"accounting: entered {entered} != open {len(openn)} + closed {len(closed)} (a session closed or beat without opening)")
    for r in openn:
        if now - _parse(r["last"]) > dt.timedelta(minutes=r["ttl_min"]):
            bad.append(f"zombie {r['id']} ({r['agent']}): no heartbeat since {r['last']}, ttl {r['ttl_min']} min (run lifecycle --reap)")
    return bad


def hooks() -> dict:
    """Claude Code settings.json hooks that make session open / beat / close automatic, with no one remembering to do it."""
    cmd = "python3 -m foundation lifecycle"
    return {"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": f"{cmd} --open claude-code"}]}],
                      "PostToolUse": [{"hooks": [{"type": "command", "command": f"{cmd} --beat-latest"}]}],
                      "Stop": [{"hooks": [{"type": "command", "command": f"{cmd} --close-latest"}]}]}}


# ---------------------------------------------------------------- strange loop: loops improve loops
def history(root=REPO) -> dict:
    h = {}
    for f in sorted((Path(root) / EVIDENCE).glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            for l in rec.get("loops", []):
                h.setdefault(l["loop"], []).append({"at": rec["at"], "ok": bool(l.get("ok")), "sig": json.dumps(l.get("verifier_problems") or l.get("detail") or l.get("tail") or "", sort_keys=True)[:200]})
    return h


def stats(runs: list, now=None, days: int = WINDOW_DAYS) -> dict:
    cut = _iso((now or _now()) - dt.timedelta(days=days))
    w = [r for r in runs if r["at"] >= cut] or runs[-1:]
    streak, sig = 0, None
    for r in reversed(runs):
        if r["ok"]:
            break
        streak += 1
        sig = sig or r["sig"]
        if r["sig"] != sig:
            streak -= 1
            break
    return {"runs": len(w), "pass_rate": round(sum(r["ok"] for r in w) / max(1, len(w)), 3), "fail_streak": streak}


def _item(root, iid: str, owner_loop: str, title: str, text: str, probe: str) -> bool:
    p = Path(root) / "docs/issues" / f"{iid}.json"
    if p.exists():
        return False
    body = f"**Owner:** operations\n**Trigger:** every loop pass\n**Done check:** {probe}\n**Status:** open\n\n{text}"
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": body, "labels": ["role:operations", "open-loop", "improve"], "milestone": "Now", "workstream": "Open loops"}, indent=2) + "\n", encoding="utf-8")
    return True


def improve(root=REPO, now=None, evidence: dict | None = None) -> dict:
    """Score every loop (itself included) and act: same signature twice -> mutate; three times -> redesign; regression -> mutate. Log each as a prediction."""
    now = now or _now()
    h = dict(evidence if evidence is not None else history(root))
    prior = {}
    for r in _read(root, IMPROVE):
        if r.get("ev") == "snapshot":
            prior[r["loop"]] = r
    # the improver is a loop too: mutation items it opened vs closed (closed = file gone or status closed)
    opened = sorted((Path(root) / "docs/issues").glob("OL-MUTATE-*.json"))
    acted, filed = [], []
    for loop, runs in sorted(h.items()):
        if not runs:
            continue  # a loop with no history has no score, not a zero
        s = stats(runs, now)
        _append(root, IMPROVE, {"ev": "snapshot", "loop": loop, "at": _iso(now), **s})
        lid = re.sub("[^A-Za-z0-9]+", "-", loop)
        probe = f"cmd:python3 -m foundation lifecycle --passing {loop}"
        if s["fail_streak"] >= 3:
            if _item(root, f"OL-REDESIGN-{lid}", loop, f"redesign loop {loop}", f"Loop {loop} failed {s['fail_streak']} times with the same signature. A fourth retry is forbidden: change the design (different tool, path, credential or agent), then keep it only if the pass rate rises.", probe):
                filed.append(f"OL-REDESIGN-{lid}")
        elif s["fail_streak"] == 2:
            if _item(root, f"OL-MUTATE-{lid}", loop, f"mutate the approach of loop {loop}", f"Loop {loop} failed twice with the same signature. Same action twice -> mutate the approach, do not retry. Predicted: pass_rate_{WINDOW_DAYS}d rises above {s['pass_rate']} within {WINDOW_DAYS} days; scored by lifecycle --score.", probe):
                filed.append(f"OL-MUTATE-{lid}")
                _append(root, IMPROVE, {"ev": "prediction", "loop": loop, "at": _iso(now), "baseline": s["pass_rate"], "metric": "pass_rate", "op": ">", "due": _iso(now + dt.timedelta(days=WINDOW_DAYS))})
        old = prior.get(loop)
        if old and s["pass_rate"] < old["pass_rate"] - 0.2 and s["fail_streak"] < 2:
            if _item(root, f"OL-MUTATE-{lid}", loop, f"pass rate of loop {loop} regressed", f"Pass rate fell from {old['pass_rate']} to {s['pass_rate']}. Find the change that caused it and revert or fix it.", probe):
                filed.append(f"OL-MUTATE-{lid}")
        acted.append({"loop": loop, **s})
    # self-reference: score the improver with the same rule. Mutation items older than a window and still open count as a failed run of 'improve'.
    stale = [p.stem for p in opened if (now - dt.datetime.fromtimestamp(p.stat().st_mtime, dt.timezone.utc)) > dt.timedelta(days=WINDOW_DAYS)]
    _append(root, IMPROVE, {"ev": "self", "at": _iso(now), "mutation_items": len(opened), "stale_mutations": stale, "efficacy": round(1 - len(stale) / max(1, len(opened)), 3)})
    if len(opened) >= 4 and len(stale) / len(opened) > 0.5:
        if _item(root, "OL-MUTATE-improve", "improve", "mutate the improver", f"{len(stale)} of {len(opened)} mutation items are stale: the improvement loop is not improving anything. Change how mutations are chosen or worked.", "cmd:python3 -m foundation lifecycle --report"):
            filed.append("OL-MUTATE-improve")
    return {"loops": acted, "filed": filed, "stale_mutations": stale}


def score(root=REPO, now=None, evidence: dict | None = None) -> list:
    """Keep or revert: a due prediction is kept if its loop's pass rate is above the baseline, otherwise an OL-REVERT item is filed."""
    now = now or _now()
    h = evidence if evidence is not None else history(root)
    scored = {r["loop"] + r["at"] for r in _read(root, IMPROVE) if r.get("ev") == "verdict"}
    out = []
    for r in _read(root, IMPROVE):
        if r.get("ev") != "prediction" or r["loop"] + r["at"] in scored or _parse(r["due"]) > now:
            continue
        s = stats(h.get(r["loop"], []), now)
        kept = s["pass_rate"] > r["baseline"] or (s["pass_rate"] == 1.0 and s["fail_streak"] == 0)
        _append(root, IMPROVE, {"ev": "verdict", "loop": r["loop"], "at": r["at"], "kept": kept, "observed": s["pass_rate"], "baseline": r["baseline"], "scored_at": _iso(now)})
        if not kept:
            _item(root, f"OL-REVERT-{re.sub('[^A-Za-z0-9]+', '-', r['loop'])}", r["loop"], f"revert and replace the remedy for {r['loop']}", f"Pass rate {s['pass_rate']} did not beat baseline {r['baseline']} within {WINDOW_DAYS} days. A remedy that did not move its metric is replaced, not repeated.", f"cmd:python3 -m foundation lifecycle --passing {r['loop']}")
        out.append({"loop": r["loop"], "kept": kept})
    return out


def passing(root, loop: str) -> bool:
    runs = history(root).get(loop, [])
    return bool(runs) and runs[-1]["ok"]


def report(root=REPO) -> dict:
    snaps = {}
    for r in _read(root, IMPROVE):
        if r.get("ev") == "snapshot":
            snaps.setdefault(r["loop"], []).append(r["pass_rate"])
    return {l: {"first": v[0], "last": v[-1], "trend": "up" if v[-1] > v[0] else "down" if v[-1] < v[0] else "flat", "snapshots": len(v)} for l, v in sorted(snaps.items())}


def main(argv) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation lifecycle")
    ap.add_argument("--open"); ap.add_argument("--item", default=""); ap.add_argument("--beat"); ap.add_argument("--close", nargs=2, metavar=("SID", "DISPOSITION"))
    ap.add_argument("--reap", action="store_true"); ap.add_argument("--check", action="store_true"); ap.add_argument("--agent", default="")
    ap.add_argument("--hooks", action="store_true"); ap.add_argument("--improve", action="store_true"); ap.add_argument("--score", action="store_true")
    ap.add_argument("--report", action="store_true"); ap.add_argument("--passing")
    ap.add_argument("--beat-latest", action="store_true"); ap.add_argument("--close-latest", action="store_true")
    a = ap.parse_args(argv)
    if a.open:
        print(open_session(REPO, a.open, a.item)); return 0
    if a.beat:
        beat(REPO, a.beat); return 0
    if a.beat_latest or a.close_latest:
        live = [r for r in state(REPO).values() if not r["closed"]]
        if not live:
            return 0
        sid = max(live, key=lambda r: r["last"])["id"]
        beat(REPO, sid) if a.beat_latest else close_session(REPO, sid, "done")
        return 0
    if a.close:
        close_session(REPO, a.close[0], a.close[1], a.item); return 0
    if a.reap:
        print(json.dumps(reap(REPO))); return 0
    if a.hooks:
        print(json.dumps(hooks(), indent=1)); return 0
    if a.improve:
        print(json.dumps(improve(REPO), indent=1)); return 0
    if a.score:
        print(json.dumps(score(REPO), indent=1)); return 0
    if a.report:
        print(json.dumps(report(REPO), indent=1)); return 0
    if a.passing:
        ok = passing(REPO, a.passing)
        print("passing" if ok else f"{a.passing} is not passing"); return 0 if ok else 1
    bad = check(REPO, a.agent)
    print("lifecycle ok" if not bad else "\n".join(bad))
    return 1 if bad else 0

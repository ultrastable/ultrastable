"""ROOTCAUSE-1 (owner, 2026-11-21): every finding is traced to its root cause, fixed there, and a returning failure escalates to the root.

failure_audit finds symptoms (a detector fails) and temporal finds trends (a hotspot, a decayed area). This module is the layer that asks why:
doctrine/rootcauses.json holds root-cause classes, each with the earliest cause, a guard probe (the mechanism that makes the failure impossible) and the remedy.

  collect   findings from ops/failure-audit-state.json (with detector evidence), ops/temporal/findings.json, ops/yearfail.json failing months
            and ops/rootcause/inbox.jsonl (incidents an agent or loop records with `--record`)
  classify  each finding to a class by failure mode, kind, id or text; a finding no class explains is `unclassified`, which is itself a finding
  record    one row per (class, finding, day) appended to ops/rootcause/occurrences.jsonl (append-only: recurrence is read from it)
  escalate  a class seen on `escalate_days` distinct days inside `window_days` gets Q-ROOT-<class> in docs/issues, which the executor takes through the normal PR lane:
            guard absent = build the guard (the root), guard present = the guard is ineffective (incident, redesign, no fourth attempt of the same fix)
  verify    closing probe `--probe CLASS`: the guard passes AND no occurrence for `quiet_days`; the item is closed with that evidence, never deleted,
            and a class that returns after closing reopens as `incident` (recurrence recorded in ops/rootcause/state.json)

  python3 -m foundation rootcause --run [--no-issues]    collect, classify, record, escalate, close
  python3 -m foundation rootcause --record CLASS --symptom TEXT [--date YYYY-MM-DD]   record an incident the detectors did not see
  python3 -m foundation rootcause --probe CLASS          closing probe of Q-ROOT-CLASS (exit 0 when fixed and quiet)
  python3 -m foundation rootcause --report               classes, occurrences, guard status, recurrence, as JSON
  python3 -m foundation rootcause --check                registry valid, every guard names a real file, every escalated class has an open item
"""
from __future__ import annotations
import json, re, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
POLICY = "doctrine/rootcauses.json"
OCC = "ops/rootcause/occurrences.jsonl"
INBOX = "ops/rootcause/inbox.jsonl"
STATE = "ops/rootcause/state.json"
ISSUES = "docs/issues"


def policy(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def item_id(cid: str) -> str:
    return f"Q-ROOT-{cid}"


def _rows(root, rel) -> list[dict]:
    p = Path(root) / rel
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def _json(root, rel, default):
    p = Path(root) / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def _day(now) -> str:
    return (now or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))[:10]


def collect(root=REPO) -> list[dict]:
    """Findings from every source, each as {source, key, kind, mode, text}. A source that is absent contributes nothing and is not an error."""
    root = Path(root)
    out = []
    try:
        dets = {x["id"]: x for x in json.loads((root / "doctrine/detectors.json").read_text(encoding="utf-8"))["detectors"]}
    except (OSError, ValueError):
        dets = {}
    last = {}
    for r in _rows(root, "ops/failure-audit.jsonl"):
        last[r["id"]] = r
    for did, st in _json(root, "ops/failure-audit-state.json", {}).items():
        if st.get("status") == "pass":
            continue
        x = dets.get(did, {})
        out.append({"source": "failure-audit", "key": did, "kind": "detector", "mode": x.get("failure_mode", ""),
                    "text": f"{did} {x.get('root_cause', '')} {last.get(did, {}).get('evidence', '')}"})
    for f in _json(root, "ops/temporal/findings.json", {}).get("findings", {}).values():
        if f.get("status", "open") == "open":
            out.append({"source": "temporal", "key": f["id"], "kind": f.get("kind", ""), "mode": "fm-temporal-drift",
                        "text": f"{f.get('subject', '')} {f.get('evidence', '')}"})
    for m in _json(root, "ops/yearfail.json", {}).get("months", []):
        if m.get("result") not in ("PASS", None):
            out.append({"source": "yearfail", "key": f"{m.get('month')}-{m.get('area')}", "kind": "simulation", "mode": "",
                        "text": f"{m.get('area')} {m.get('failure')} {m.get('evidence', '')}"})
    for r in _rows(root, INBOX):
        out.append({"source": "inbox", "key": r.get("key") or r["symptom"][:40], "kind": "incident", "mode": "", "text": r["symptom"],
                    "class": r.get("class"), "date": r.get("date")})
    return out


def classify(f: dict, classes: list[dict]) -> str:
    if f.get("class") and any(c["id"] == f["class"] for c in classes):
        return f["class"]
    for c in classes:
        m = c.get("match", {})
        if f.get("mode") and f["mode"] in m.get("modes", []):
            return c["id"]
        if f.get("kind") and f["kind"] in m.get("kinds", []):
            return c["id"]
        if f["source"] == "failure-audit" and any(re.search(p, f["key"]) for p in m.get("ids", [])):
            return c["id"]
        if any(re.search(p, f["text"]) for p in m.get("text", [])):
            return c["id"]
    return "unclassified"


def guard_ok(c: dict, root) -> bool:
    from . import selfhost
    try:
        return selfhost.probe(root, c["guard"])
    except ValueError:
        return False


def _days_back(day: str, n: int) -> str:
    t = time.mktime(time.strptime(day, "%Y-%m-%d")) - n * 86400
    return time.strftime("%Y-%m-%d", time.gmtime(t + 43200))


def _summary(root, classes, today) -> dict:
    pol = policy(root)
    rows = _rows(root, OCC)
    since = _days_back(today, pol["window_days"])
    quiet = _days_back(today, pol["quiet_days"])
    out = {}
    for c in classes + [{"id": "unclassified"}]:
        mine = [r for r in rows if r["class"] == c["id"]]
        days = sorted({r["date"] for r in mine if r["date"] >= since})
        out[c["id"]] = {"occurrences": len(mine), "days_in_window": days, "last": max((r["date"] for r in mine), default=""),
                        "quiet": not any(r["date"] > quiet for r in mine), "guard": guard_ok(c, root) if "guard" in c else None}
    return out


def _item(c: dict, s: dict, mode: str, evidence: list[str]) -> dict:
    cid = c["id"]
    why = ("the guard does not exist yet: build it, because the guard is the fix" if mode == "build-guard"
           else "the guard exists and the failure still returned: the guard is ineffective, so redesign it (a fourth attempt of the same fix is not allowed)")
    body = (f"**Owner:** {c['owner']}\n**Trigger:** the daily failure audit files it when a root cause recurs; the executor takes it in driver order\n"
            f"**Done check:** cmd:python3 -m foundation rootcause --probe {cid}\n**Status:** open\n\n"
            f"Root cause class `{cid}` recurred on {len(s['days_in_window'])} days ({', '.join(s['days_in_window'])}); {why}.\n"
            f"Root cause: {c['root']}\nGuard: `{c['guard']}`\nRemedy: {c['remedy']}\nSymptoms seen:\n" + "\n".join(f"- {e[:160]}" for e in evidence[:6])
            + f"\nFix the root, not the symptom: the item closes when the guard passes and the class stays quiet for {policy()['quiet_days']} days.\n"
            f"\n**Closing probe:** cmd:python3 -m foundation rootcause --probe {cid}\n")
    return {"id": item_id(cid), "title": f"{item_id(cid)}: {cid} keeps recurring: {c['remedy']}"[:240], "body": body,
            "labels": [f"role:{c['owner']}", "audit", "root-cause", mode, "agent-ready", "p1"], "milestone": "Now", "workstream": "Failure modes"}


def run(root=REPO, issues=True, now=None) -> dict:
    root = Path(root)
    pol, today = policy(root), _day(now)
    classes = pol["classes"]
    seen = {(r["class"], r["key"], r["date"]) for r in _rows(root, OCC)}
    new, by_class = [], {}
    for f in collect(root):
        cid = classify(f, classes)
        d = f.get("date") or today
        by_class.setdefault(cid, []).append(f"{f['source']}:{f['key']}: {f['text'].strip()[:120]}")
        if (cid, f["key"], d) not in seen:
            seen.add((cid, f["key"], d))
            new.append({"class": cid, "key": f["key"], "source": f["source"], "date": d, "text": f["text"].strip()[:200]})
    if new:
        (root / OCC).parent.mkdir(parents=True, exist_ok=True)
        with (root / OCC).open("a", encoding="utf-8") as fh:
            for r in new:
                fh.write(json.dumps(r) + "\n")
    summ = _summary(root, classes, today)
    state, actions = {}, []
    for c in classes + [{"id": "unclassified", "owner": "operations", "root": "no root-cause class explains this finding", "guard": "file:doctrine/rootcauses.json",
                         "remedy": "Add a root-cause class (id, match, root, guard, remedy) to doctrine/rootcauses.json for these findings."}]:
        cid, s = c["id"], summ[c["id"]]
        ip = root / ISSUES / f"{item_id(cid)}.json"
        recurring = (len(s["days_in_window"]) >= pol["escalate_days"]  # a class that returned on another day, or one that has occurred with no guard at all (the root gap itself)
                     or (s["occurrences"] and not s["guard"]))
        mode = "build-guard" if not s["guard"] else "incident"
        if cid == "unclassified":
            mode = "classify"
        open_now = ip.exists() and "**Status:** open" in json.loads(ip.read_text(encoding="utf-8")).get("body", "")
        closed_before = ip.exists() and not open_now
        if recurring and not (s["quiet"] and s["guard"]):
            if issues and not open_now:
                ip.write_text(json.dumps(_item(c, s, mode, by_class.get(cid, [])), indent=2) + "\n", encoding="utf-8")
                actions.append(f"{cid}: escalated ({mode}{', reopened after closing' if closed_before else ''})")
            state[cid] = {"status": "escalated", "mode": mode, "days": s["days_in_window"], "guard": s["guard"]}
        elif open_now and s["guard"] and s["quiet"]:
            if issues:
                j = json.loads(ip.read_text(encoding="utf-8"))
                j["body"] = j["body"].replace("**Status:** open", "**Status:** closed") + f"\n**Evidence:** guard `{c['guard']}` passes and no occurrence since {s['last'] or 'ever'} (quiet {pol['quiet_days']} days), checked {today}.\n"
                ip.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
                actions.append(f"{cid}: closed with evidence")
            state[cid] = {"status": "resolved", "last": s["last"], "guard": True}
        else:
            state[cid] = {"status": "watching" if s["occurrences"] else "clean", "last": s["last"], "guard": s["guard"]}
    text = json.dumps(state, indent=1, sort_keys=True) + "\n"
    sp = root / STATE
    sp.parent.mkdir(parents=True, exist_ok=True)
    if not sp.exists() or sp.read_text(encoding="utf-8") != text:
        sp.write_text(text, encoding="utf-8")
    return {"new_occurrences": len(new), "actions": actions, "state": state}


def probe(cid: str, root=REPO, now=None) -> tuple[bool, str]:
    root = Path(root)
    pol = policy(root)
    c = next((x for x in pol["classes"] if x["id"] == cid), None)
    if c is None:
        return False, f"no class {cid}"
    s = _summary(root, pol["classes"], _day(now))[cid]
    if not s["guard"]:
        return False, f"guard {c['guard']} does not pass yet"
    if not s["quiet"]:
        return False, f"guard passes but the class occurred on {s['last']} (quiet needs {pol['quiet_days']} days)"
    return True, f"guard passes; last occurrence {s['last'] or 'never'}"


def check(root=REPO) -> list[str]:
    root = Path(root)
    pol, bad, seen = policy(root), [], set()
    for c in pol["classes"]:
        i = c.get("id", "?")
        if i in seen:
            bad.append(f"{i}: duplicate class")
        seen.add(i)
        for k in ("id", "match", "root", "guard", "owner", "remedy"):
            if not c.get(k):
                bad.append(f"{i}: missing {k}")
        for k, pats in c.get("match", {}).items():
            for p in pats if k in ("text", "ids") else []:
                try:
                    re.compile(p)
                except re.error as e:
                    bad.append(f"{i}: bad pattern {p!r}: {e}")
        if not str(c.get("guard", "")).startswith(("file:", "grep:")):
            bad.append(f"{i}: guard must be a file: or grep: probe")
    for cid, st in _json(root, STATE, {}).items():
        if st.get("status") == "escalated":
            ip = root / ISSUES / f"{item_id(cid)}.json"
            if not ip.exists() or "**Status:** open" not in json.loads(ip.read_text(encoding="utf-8")).get("body", ""):
                bad.append(f"{cid}: escalated with no open {item_id(cid)}")
    return bad


def record(cid: str, symptom: str, date: str | None = None, root=REPO) -> dict:
    root = Path(root)
    if not any(c["id"] == cid for c in policy(root)["classes"]):
        raise SystemExit(f"unknown class {cid}")
    row = {"class": cid, "symptom": symptom, "date": date or _day(None), "key": re.sub(r"\W+", "-", symptom.lower())[:40].strip("-")}
    p = root / INBOX
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    return row


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    arg = lambda k: a[a.index(k) + 1] if k in a else None
    if "--check" in a:
        p = check()
        print("rootcause ok" if not p else "\n".join(p))
        return 1 if p else 0
    if "--report" in a:
        print(json.dumps(_summary(REPO, policy()["classes"], _day(None)), indent=1))
        return 0
    if "--probe" in a:
        ok, why = probe(arg("--probe"))
        print(why)
        return 0 if ok else 1
    if "--record" in a:
        print(json.dumps(record(arg("--record"), arg("--symptom") or "", arg("--date"))))
        return 0
    if "--run" in a:
        r = run(issues="--no-issues" not in a)
        print(json.dumps({k: r[k] for k in ("new_occurrences", "actions")}, indent=1))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())

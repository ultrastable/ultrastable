"""The guiding directive as code (owner, 2026-11-12). `docs/doctrine/GUIDING-DIRECTIVE.md` holds the text verbatim; `doctrine/directive.json` its machine form;
`doctrine/registers.json` the SPOF, failure-mode and control registers; `doctrine/durable-facts.json` the facts that must live in the repo.

  python3 -m foundation directive --check          text vs JSON, registers, durable facts, instruction files, seed copy
  python3 -m foundation directive --lint FILE...   owner-handback shapes in reports (question, menu, courtesy stop, blocker as owner issue)
  python3 -m foundation directive --ledger        silent-drop accounting over docs/issues
  python3 -m foundation directive --probe         run every register probe and append evidence to doctrine/probe-log.jsonl
  python3 -m foundation directive --bootstrap     the memory-free reading order, verified (works with project memory disabled)

Library: accounting(), loop_breaker(), validate_provenance(), scorecard(). Layers on kernel.py; section 4 is IC-GATE-001.
"""
from __future__ import annotations
import datetime as dt, json, re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PATH = "doctrine/directive.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def registers(root=REPO) -> dict:
    return json.loads((Path(root) / load(root)["registers"]).read_text(encoding="utf-8"))


def _probe(root, spec):
    from . import selfhost
    return selfhost.probe(root, spec)


def _headings(md: str) -> list[str]:
    return [re.sub(r"^#+\s*", "", l).strip() for l in md.splitlines() if l.startswith("## ")]


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    d = load(root)
    md = (root / d["text"]).read_text(encoding="utf-8")
    heads = _headings(md)
    for s in d["sections"]:
        if s not in heads:
            bad.append(f"section '{s}' is missing from {d['text']}")
    # precedence: the order in the text is the order in the JSON
    pm = re.search(r"## 0\. Precedence.*?\n((?:\d\. .*\n)+)", md, re.S)
    text_prec = re.findall(r"^\d\. (.*)$", pm.group(1), re.M) if pm else []
    if len(text_prec) != len(d["precedence"]):
        bad.append("precedence in directive.json differs in length from the text")
    for line, p in zip(text_prec, d["precedence"]):
        if not all(c.split("-")[0] in line for c in p["clause"].split(",")):
            bad.append(f"precedence rank {p['rank']}: clause {p['clause']} not in text line {line[:50]!r}")
    if text_prec and "§4 interrupt gate" not in text_prec[0]:
        bad.append("precedence rank 1 must be the section 4 interrupt gate")
    for m in d["scorecard"]:
        if m["id"] == "capability_gain":
            continue
        word = m["id"].replace("_", " ").replace(" rate", "").replace(" p95 ticks", "")
        if not re.search(re.escape(word).replace(r"\ ", r"[\s-]+"), md, re.I):
            bad.append(f"scorecard metric {m['id']} is not in the directive text")
    for f in d["provenance_fields"]:
        if f.replace("_", " ") not in md and f not in md:
            bad.append(f"provenance field {f} not in the directive text")
    for f in d["failure_mode_fields"]:
        if f.replace("detection", "detection method").replace("_", " ") not in md:
            bad.append(f"failure-mode field {f} not in the directive text")
    if d["loop_breaker"]["mutate_after"] != 2 or d["loop_breaker"]["incident_after"] != 3:
        bad.append("loop-breaker thresholds must be 2 (mutate) and 3 (incident)")
    for l in d["lint"]:
        for p in l["patterns"]:
            re.compile(p)
    seed = root / d["seed_copy"]
    if not seed.exists() or seed.read_bytes() != (root / d["text"]).read_bytes():
        bad.append(f"{d['seed_copy']} is not a byte copy of {d['text']} (new systems must inherit the directive)")
    bad += registers_check(root, d)
    bad += facts_check(root, d)
    bad += instruction_check(root, d)
    return bad


def registers_check(root, d=None) -> list[str]:
    root, d, bad = Path(root), d or load(root), []
    r = registers(root)
    seen = set()
    for kind, need in (("spofs", ["id", "kind", "what", "owner", "trigger", "remediation", "status", "probe"]),
                       ("failure_modes", ["id", *d["failure_mode_fields"], "cadence_ticks", "probe"]),
                       ("controls", ["id", "kind", "what", "disposition", "critical_path", "alternate", "probe"])):
        if not r.get(kind):
            bad.append(f"register {kind} is empty")
        for e in r.get(kind, []):
            i = e.get("id", "?")
            if i in seen:
                bad.append(f"{i}: defined twice")
            seen.add(i)
            for f in need:
                if f not in e or e[f] in ("", None):
                    bad.append(f"{i}: lacks {f}")
            for pf in ("probe", "alternate", "second_path_exercised"):
                if e.get(pf) and not _probe(root, e[pf]):
                    bad.append(f"{i}: {pf} fails ({e[pf]})")
    for s in r.get("spofs", []):
        if s.get("status") in ("remediated", "mitigated") and not s.get("second_path_exercised"):
            bad.append(f"{s['id']}: remediation means a second path that was exercised")
        if s.get("status") == "backlogged" and not all((s.get("backlog") or {}).get(k) for k in ("owner", "trigger", "verification")):
            bad.append(f"{s['id']}: a backlogged SPOF needs owner, trigger and verification")
        if s.get("status") not in ("remediated", "mitigated", "backlogged"):
            bad.append(f"{s['id']}: status must be remediated, mitigated or backlogged")
    for c in r.get("controls", []):
        if c.get("critical_path"):
            bad.append(f"{c['id']}: no hold, filter, pause or kill switch on a critical path")
        if c.get("disposition") not in d["control_dispositions"] + ["keep"]:
            bad.append(f"{c['id']}: disposition must be one of {d['control_dispositions']} (or keep for the interrupt gate)")
        if c.get("disposition") == "keep" and c.get("kind") != "gate":
            bad.append(f"{c['id']}: only the interrupt gate is kept as is; every other control is removed, demoted or replaced")
    return bad


def facts_check(root, d=None) -> list[str]:
    root, d, bad = Path(root), d or load(root), []
    f = json.loads((root / d["durable_facts"]).read_text(encoding="utf-8"))
    for x in f["facts"]:
        for k in ("probe", "also"):
            if x.get(k) and not _probe(root, x[k]):
                bad.append(f"durable fact {x['id']} is not in the repo ({x[k]}): it exists only outside it")
        if not x.get("statement"):
            bad.append(f"durable fact {x['id']}: lacks statement")
    return bad


def instruction_check(root, d=None) -> list[str]:
    """Every agent instruction file carries the directive, and none makes tool memory a dependency."""
    root, d, bad = Path(root), d or load(root), []
    names = []
    for g in d["instruction_files"]:
        names += [p for p in sorted(root.glob(g)) if p.is_file()]
    for p in names:
        t = p.read_text(encoding="utf-8")
        rel = p.relative_to(root).as_posix()
        if p.name == "CLAUDE.md" and ("@agents/AGENTS.md" in t or "@AGENTS.md" in t.splitlines()):
            continue  # imports AGENTS.md
        if d["instruction_marker"] not in t:
            bad.append(f"{rel}: does not carry the guiding directive ({d['instruction_marker']})")
    for rel in ("agents/AGENTS.md", "seed/agents/AGENTS.md"):
        t = (root / rel).read_text(encoding="utf-8")
        if not re.search(r"memory[^.\n]{0,80}not (a )?(storage|record)|not storage", t, re.I):
            bad.append(f"{rel}: must state that project and tool memory are not storage")
    return bad


def _prose(text):
    from .kernel import _prose as p
    return p(text)


def lint(text: str, d: dict | None = None) -> list[dict]:
    d = d or load()
    excused = re.compile(d["excused_by"], re.I)
    out = []
    for n, ln in _prose(text):
        if excused.search(ln):
            continue
        for r in d["lint"]:
            if any(re.search(p, ln, re.I) for p in r["patterns"]):
                out.append({"line": n, "recognition": r["id"], "text": ln.strip()[:100]})
    # a report that ends in a question to the owner
    lines = [(n, l) for n, l in _prose(text) if l.strip()]
    if lines and lines[-1][1].rstrip().endswith("?") and not excused.search(lines[-1][1]):
        out.append({"line": lines[-1][0], "recognition": "question-to-owner", "text": lines[-1][1].strip()[:100]})
    return out


def accounting(items: list[dict], d: dict | None = None) -> dict:
    """Section 6: entered = open + closed_with_disposition + superseded_with_evidence. Returns counts and the problems."""
    d = d or load()
    c = {"entered": len(items), "open": 0, "closed": 0, "superseded": 0, "backlogged": 0}
    problems = []
    for it in items:
        s, i = it.get("state", ""), it.get("id", "?")
        if s == "open":
            c["open"] += 1
        elif s in ("closed", "fixed"):
            c["closed"] += 1
            if not (it.get("disposition") and it.get("evidence")):
                problems.append(f"{i}: closed without disposition and evidence (silent drop)")
        elif s == "superseded":
            c["superseded"] += 1
            if not it.get("evidence"):
                problems.append(f"{i}: superseded without evidence (silent drop)")
        elif s == "backlogged":
            c["backlogged"] += 1
            miss = [k for k in d["dispositions"]["backlogged"] if not it.get(k)]
            if miss:
                problems.append(f"{i}: backlogged without {', '.join(miss)}")
        else:
            problems.append(f"{i}: state {s!r} is not open, closed, superseded or backlogged (silent drop)")
    accounted = c["open"] + c["closed"] + c["superseded"] + c["backlogged"]
    if accounted != c["entered"]:
        problems.append(f"accounting invariant: entered {c['entered']} != accounted {accounted}")
    c["balanced"] = not problems
    c["problems"] = problems
    return c


def _classify(status: str):
    """Free-text **Status:** to (state, evidence). done/cancelled need evidence (a path or link in the status); waiting/blocked is backlogged; the rest is open."""
    t = status.strip().lower()
    ev = bool(re.search(r"`[^`]+`|\]\(", status))
    if t.startswith(("done", "closed", "cancelled")):
        return "closed", ev
    if t.startswith("superseded"):
        return "superseded", ev
    if t.startswith(("waiting", "blocked")):
        return "backlogged", True
    return "open", False


def issue_ledger(root=REPO) -> dict:
    """Accounting over docs/issues. Items carry **Status:** in the body; a done item must name its evidence, a waiting item needs Owner, Trigger and Done check."""
    items = []
    for f in sorted((Path(root) / "docs/issues").glob("*.json")):
        if f.name.startswith("_"):
            continue
        j = json.loads(f.read_text(encoding="utf-8"))
        body = j.get("body", "")
        m = re.search(r"\*\*Status:\*\*\s*([^\n]*)", body)
        st, ev = _classify(m.group(1) if m else "open")
        items.append({"id": j["id"], "state": st, "disposition": ev, "evidence": ev, "owner": "**Owner:**" in body, "trigger": "**Trigger:**" in body, "verification": "**Done check:**" in body})
    return accounting(items)


def loop_breaker(history: list[dict], d: dict | None = None) -> dict:
    """Section 2. history = [{signature, approach}] oldest first. Same signature twice: mutate the approach. Three times: incident and redesign."""
    d = d or load()
    lb = d["loop_breaker"]
    if not history:
        return {"action": "proceed", "count": 0}
    sig = history[-1]["signature"]
    run = 0
    for h in reversed(history):
        if h["signature"] != sig:
            break
        run += 1
    approaches = {h["approach"] for h in history if h["signature"] == sig}
    if run >= lb["incident_after"]:
        return {"action": "incident", "count": run, "signature": sig, "next": "redesign; open an incident item; do not attempt again unchanged"}
    if run >= lb["mutate_after"]:
        return {"action": "mutate", "count": run, "signature": sig, "tried": sorted(approaches), "options": lb["mutations"], "next": "change tool, path, credential, abstraction or agent"}
    return {"action": "retry-allowed", "count": run, "signature": sig}


def validate_provenance(rec: dict, d: dict | None = None) -> list[str]:
    d = d or load()
    bad = [f"provenance lacks {f}" for f in d["provenance_fields"] if rec.get(f) in (None, "", [])]
    if not isinstance(rec.get("surfaces_tested", []), list):
        bad.append("surfaces_tested must be a list")
    return bad


def scorecard(events: list[dict], d: dict | None = None) -> dict:
    """Headline and blocker metrics from recorded events. event kinds: action (autonomous), stop (justified bool), blocker (surfaces_tested, surfaces_available, reported_as_user_decision)."""
    d = d or load()
    a = sum(1 for e in events if e["kind"] == "action")
    stops = [e for e in events if e["kind"] == "stop"]
    bl = [e for e in events if e["kind"] == "blocker"]
    sc = {
        "autonomy_rate": round(a / (a + len(stops)), 4) if (a + len(stops)) else 1.0,
        "stop_validity": round(sum(1 for s in stops if s.get("justified")) / len(stops), 4) if stops else 1.0,
        "blocker_survival_rate": round(sum(1 for b in bl if b.get("reported_as_user_decision")) / len(bl), 4) if bl else 0.0,
        "surface_coverage": round(sum(len(set(b.get("surfaces_tested", []))) / max(b.get("surfaces_available", len(d["surfaces"])), 1) for b in bl) / len(bl), 4) if bl else 1.0,
        "capability_gain": sum(1 for e in events if e["kind"] == "capability"),
    }
    sc["regressions"] = [m["id"] for m in d["scorecard"] if isinstance(m["target"], (int, float)) and m["id"] in sc
                         and ((m["id"] in ("blocker_survival_rate",) and sc[m["id"]] > m["target"]) or (m["id"] in ("stop_validity", "surface_coverage") and sc[m["id"]] < m["target"]))]
    return sc


def probe_all(root=REPO, now=None) -> list[dict]:
    """Run every register probe; append evidence (append-only) to doctrine/probe-log.jsonl. Probes that find nothing still record that they ran."""
    root = Path(root)
    r = registers(root)
    now = now or dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    rows = []
    for kind in ("spofs", "failure_modes", "controls"):
        for e in r[kind]:
            ok = _probe(root, e["probe"])
            rows.append({"at": now, "register": kind, "id": e["id"], "probe": e["probe"], "ok": ok})
    log = root / "doctrine/probe-log.jsonl"
    with log.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    return rows


def bootstrap(root=REPO) -> list[str]:
    """The memory-free reading order. Fails when any step's file is missing: a fresh agent with project memory disabled can start from the repo alone."""
    root, out = Path(root), []
    order = ["CLAUDE.md", "AGENTS.md", "agents/AGENTS.md", "docs/doctrine/GUIDING-DIRECTIVE.md", "doctrine/kernel-8.2.1.md", "docs/PROJECT-MEMORY.md",
             "agents/PROJECT-INSTRUCTIONS.md", "doctrine/durable-facts.json", "docs/BOOTSTRAP-NO-MEMORY.md"]
    for rel in order:
        out.append(("ok   " if (root / rel).is_file() else "MISSING ") + rel)
    bad = check(root)
    out.append("directive check: " + ("ok" if not bad else f"{len(bad)} problems"))
    return out + bad

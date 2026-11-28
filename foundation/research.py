# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RESEARCH-1 (Rowan, 2026-11-21): Ultrastable's own R&D department and white papers, as code. Ultrastable is the foundation for any autonomous system.

"Ultrastable needs its own R&D cycle ... research on how to improve our own product ... and release our own white papers ... If others find issues and
problems, what does that say about what we're trying to do?" An outside study is the seed. Each of its findings is data in research/studies/<id>.json:
the concern, the mechanisms of this system that answer it, the metric of this system that tests the answer, a target and a prediction.

  python3 -m foundation research --check            studies and doctrine are valid; every mechanism path exists; the page module matches the studies
  python3 -m foundation research --run [--apply]    measure every metric from the system's own ledgers, judge each finding, file Q-RES items for the
                                                    ones not met, settle and open experiments, propose rule links (core/connect), write the papers
  python3 -m foundation research --probe STUDY:F    exit 0 when that finding's metric meets its target now (closing probe of its Q-RES item)
  python3 -m foundation research --intake [--apply] read public paper feeds, file at most max_intake_items candidate studies, uncovered perspectives first
  python3 -m foundation research --refresh-prs      re-read the last 500 closed pull requests from GitHub into ops/research/prs.json (CI token)
  python3 -m foundation research --page --apply     regenerate only the papers and site/research-data.js
  python3 -m foundation research --report           every finding, its measurement and verdict

Honesty rules, enforced here rather than promised: every number in a paper comes from `measures()` or is a figure quoted in the study file; a finding
with no measurement is reported as unmeasured, never as met; the limits section is computed from the same data (sample size, window, who opened the
pull requests, the regime); the study's figures and ours are never presented as a causal comparison.
"""
from __future__ import annotations
import datetime as dt, json, os, re, statistics, subprocess, sys, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/research.json"
OPS = {"<=": lambda a, b: a <= b, ">=": lambda a, b: a >= b, "<": lambda a, b: a < b, ">": lambda a, b: a > b}
PRED = re.compile(r"^(?P<metric>[a-z][a-z0-9_]*) (?P<op><=|>=|<|>) (?P<value>-?[0-9.]+) within (?P<h>[0-9]+) h$")
METRICS = {
    "pr_merge_hours_median": "median hours from a pull request opening to its merge",
    "pr_merge_hours_p90": "90th percentile hours from opening to merge",
    "pr_merge_hours_median_system": "median hours to merge for pull requests the system's own workflows or App opened",
    "pr_merge_hours_median_session": "median hours to merge for pull requests code agent sessions opened under the owner's account",
    "pr_closed_unmerged_share": "share of closed pull requests closed without merging",
    "system_authored_share": "share of merged pull requests opened by the system itself",
    "deploy_verified_share": "share of uploaded deploys proven live against their commit",
    "verified_deploys_per_merged_pr": "verified live deploys per merged pull request in the same window",
    "revert_share": "commits on main whose subject starts with Revert, per merged pull request in the window",
    "self_deploys": "verified deploys the system originated and executed itself (latest criticality tick)",
    "human_touches": "human touches counted by the latest criticality tick",
    "essential_bounded_share": "share of declared essential variables that have limits (doctrine/ultrastability.json)",
    "step_function_share": "share of essential variables whose second loop can change a parameter of the first loop",
    "second_loop_steps_30d": "second-order steps the ultrastability loop took in the last 30 days (ops/ultrastability.jsonl)",
    "second_loop_kept_share": "share of second-order steps that brought the variable back inside its limits and were kept",
    "loops_closing_probe_share": "share of registered loops that declare a closing probe and a server-side owner",
    "kg_systems_share": "share of systems in doctrine/knowledge-graph.json whose knowledge graph is built, not pending",
    "owner_interventions_7d": "owner-driven thread sessions that changed the repository in the last 7 days (ops/provenance.jsonl)",
    "spec_quality": "share of open work items with a done check, a prediction, an out-of-scope line and a live proof (foundation/specgate.py)",
    "essential_measured_share": "share of essential variables (platform and tenant) whose latest reading in the last 7 days has a value (ops/ultrastability.jsonl)",
    "efficiency_verdict_share": "share of settled actions (decisions, growth experiments, second-loop steps) that carry an efficiency verdict as well as an effectiveness verdict (foundation/freeadapt.py)",
    "action_classes_consistent_share": "share of judged action classes whose recent actions mostly left the other essential variables inside their limits (foundation/freeadapt.py)",
    "survival_levels_met": "how many of the three survival levels hold now: effective, attractive, consistent (foundation/freeadapt.py)",
    "lessons_enforced_share": "share of recorded lessons bound to a check, variable, detector or test (doctrine/lessons.json)",
    "second_loop_collision_share_7d": "share of the second loop's parameter steps in the last 7 days that changed a step-function another variable's trial already held (MULTISTABLE-1)",
    "step_versatility_share": "share of declared step-functions that can still move in a direction their steps declare (ops: doctrine files the ladders name)",
    "archive_triaged_share": "share of Ashby's index keywords and Other Index categories with a disposition in doctrine/ashby-archive.json (ASHBY-ARCHIVE-1)",
    "archive_principles_built_share": "share of principles taken from Ashby's journal that are code with a passing probe (doctrine/ashby-archive.json)",
    "failure_modes_detected_share": "share of failure modes in doctrine/registers.json that have at least one live detector in doctrine/detectors.json (CYBERNETICS-PROGRAM-1)",
    "ashby_concepts_bound_share": "share of concepts in doctrine/ashby-concepts.json whose every named mechanism resolves to a file and marker in this repository",
    "managers_closed_share": "share of manager roles in doctrine/managers.json that name code, a clock, a closing probe and the code that settles what they file",
    "targets_with_knobs_share": "share of target goals in seed/autonomy/goals.json that have at least one bounded knob the system may turn",
    "research_findings_met_share": "share of every finding in every paper whose own measurement meets its target, excluding this metric (RESEARCH-LOOP-1)",
}
NOW = lambda: dt.datetime.now(dt.timezone.utc)
ISO = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _t(s):
    return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")) if s else None


def load(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def studies(root=REPO, pol=None) -> list[dict]:
    pol = pol or load(root)
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((Path(root) / pol["studies_dir"]).glob("*.json"))]


def _jsonl(path: Path) -> list[dict]:
    out = []
    for line in (path.read_text(encoding="utf-8").splitlines() if path.is_file() else []):
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def _payload(row: dict) -> dict:
    """The data of a ledger row: a CloudEvents 1.0 envelope carries it in `data`, a row written before the ledger met the standard is the data."""
    return row["data"] if row.get("specversion") == "1.0" and isinstance(row.get("data"), dict) else row


def _median(xs):
    return round(statistics.median(xs), 2) if xs else None


def _p90(xs):
    if not xs:
        return None
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(round(0.9 * (len(s) - 1))))], 2)


def measures(root=REPO, pol=None) -> dict:
    """Every metric in METRICS as {value, n, source}; value None when the ledger that would hold it is missing or empty."""
    pol = pol or load(root)
    root = Path(root)
    state = root / pol["state_dir"]
    snap = json.loads((state / "prs.json").read_text(encoding="utf-8")) if (state / "prs.json").is_file() else {"prs": []}
    prs = snap.get("prs", [])
    merged = [p for p in prs if p.get("merged_at")]
    hours = lambda ps: [(_t(p["merged_at"]) - _t(p["created_at"])).total_seconds() / 3600 for p in ps]
    sysm = [p for p in merged if str(p.get("author", "")).startswith("system")]
    sesm = [p for p in merged if p.get("author") == "session"]
    src_pr = f"{snap.get('source', 'ops/research/prs.json')}, fetched {snap.get('fetched_at', '?')}"
    m = {
        "pr_merge_hours_median": {"value": _median(hours(merged)), "n": len(merged), "source": src_pr},
        "pr_merge_hours_p90": {"value": _p90(hours(merged)), "n": len(merged), "source": src_pr},
        "pr_merge_hours_median_system": {"value": _median(hours(sysm)), "n": len(sysm), "source": src_pr},
        "pr_merge_hours_median_session": {"value": _median(hours(sesm)), "n": len(sesm), "source": src_pr},
        "pr_closed_unmerged_share": {"value": round(1 - len(merged) / len(prs), 3) if prs else None, "n": len(prs), "source": src_pr},
        "system_authored_share": {"value": round(len(sysm) / len(merged), 3) if merged else None, "n": len(merged), "source": src_pr},
    }
    start = min((_t(p["created_at"]) for p in prs), default=None)
    end = max((_t(p.get("merged_at") or p["created_at"]) for p in prs), default=None)
    win = lambda r: start is not None and start <= (_t(r.get("at")) or start) <= end + dt.timedelta(hours=1)
    deps = [r for r in _jsonl(root / "ops/deploys.jsonl") if r.get("uploaded")]
    dw = [r for r in deps if win(r)]
    ver = [r for r in dw if r.get("live_matches_commit")]
    m["deploy_verified_share"] = {"value": round(len(ver) / len(dw), 3) if dw else None, "n": len(dw), "source": "ops/deploys.jsonl (same window)"}
    m["verified_deploys_per_merged_pr"] = {"value": round(len(ver) / len(merged), 3) if merged and start else None, "n": len(merged), "source": "ops/deploys.jsonl and the pull request snapshot"}
    reverts = None
    if start:
        r = subprocess.run(["git", "-C", str(root), "log", f"--since={ISO(start)}", f"--until={ISO(end + dt.timedelta(hours=1))}", "--format=%s", "HEAD"], capture_output=True, text=True)
        if r.returncode == 0:
            reverts = sum(1 for s in r.stdout.splitlines() if s.startswith("Revert"))
        else:
            print(f"research: git log failed: {r.stderr.strip()[:200]}", file=sys.stderr)
    m["revert_share"] = {"value": round(reverts / len(merged), 3) if reverts is not None and merged else None, "n": len(merged), "source": "git log of main, subjects starting with Revert"}
    crit = _jsonl(root / "ops/criticality.jsonl")
    last = crit[-1] if crit else {}
    m["self_deploys"] = {"value": last.get("self_deploys"), "n": last.get("verified_deploys"), "source": f"ops/criticality.jsonl at {last.get('at', '?')}"}
    m["human_touches"] = {"value": last.get("human_touches"), "n": last.get("deploys"), "source": f"ops/criticality.jsonl at {last.get('at', '?')}"}
    try:
        from . import ultrastability as U
        a = U.ashby(root)
        m["essential_bounded_share"] = {"value": a["bounded_share"], "n": a["variables"], "source": "doctrine/ultrastability.json"}
        m["step_function_share"] = {"value": a["step_function_share"], "n": a["variables"], "source": "doctrine/ultrastability.json"}
    except (OSError, ValueError, KeyError) as e:
        print(f"research: ultrastability declaration unreadable: {e}", file=sys.stderr)
        m["essential_bounded_share"] = m["step_function_share"] = {"value": None, "n": 0, "source": "doctrine/ultrastability.json (unreadable)"}
    us = _jsonl(root / "ops/ultrastability.jsonl")
    cut = (end or NOW()) - dt.timedelta(days=30)
    steps30 = [r for r in us if r.get("ev") == "step" and (_t(r.get("at")) or cut) >= cut]
    verd = [r for r in us if r.get("ev") == "verdict"]
    m["second_loop_steps_30d"] = {"value": len(steps30) if us else None, "n": len(us), "source": "ops/ultrastability.jsonl"}
    m["second_loop_kept_share"] = {"value": round(sum(1 for r in verd if r.get("verdict") == "kept") / len(verd), 3) if verd else None, "n": len(verd), "source": "ops/ultrastability.jsonl verdicts"}
    reg = root / "instances/ultrastable/loop-registry.json"
    if reg.is_file():
        lr = json.loads(reg.read_text(encoding="utf-8"))
        loops = lr["loops"] if isinstance(lr, dict) else lr
        m["loops_closing_probe_share"] = {"value": round(sum(1 for x in loops if x.get("closing_probe") and x.get("server_owner")) / len(loops), 3) if loops else None, "n": len(loops), "source": "instances/ultrastable/loop-registry.json (declared)"}
    else:
        m["loops_closing_probe_share"] = {"value": None, "n": 0, "source": "instances/ultrastable/loop-registry.json (missing)"}
    kgp = root / "doctrine/knowledge-graph.json"
    kgs = json.loads(kgp.read_text(encoding="utf-8")).get("systems", {}) if kgp.is_file() else {}
    m["kg_systems_share"] = {"value": round(sum(1 for x in kgs.values() if x.get("state") != "pending") / len(kgs), 3) if kgs else None, "n": len(kgs), "source": "doctrine/knowledge-graph.json (declared)"}
    try:  # SECOND-LOOP-2 and SPEC-GATE-1 readings, the same functions the second loop reads
        from . import ultrastability as U2
        m["owner_interventions_7d"] = {"value": U2.owner_interventions(root), "n": None, "source": "ops/provenance.jsonl, last 7 days"}
        m["spec_quality"] = {"value": U2.spec_quality(root), "n": None, "source": "foundation/specgate.py over docs/issues"}
    except (OSError, ValueError, KeyError) as e:
        print(f"research: second-loop readings failed: {e}", file=sys.stderr)
        m["owner_interventions_7d"] = m["spec_quality"] = {"value": None, "n": 0, "source": "unreadable"}
    m["essential_measured_share"] = essential_measured(us, end or NOW())
    try:  # FREELY-ADAPTIVE-1: both kinds of learning and the three survival levels (Pérez López, IESE WP 5, 1974)
        from . import freeadapt as FA
        fr = FA.report(root)
        lv = fr["levels"]
        m["efficiency_verdict_share"] = {"value": fr["efficiency_verdict_share"], "n": fr["settled_actions"], "source": "ops/decisions/outcomes.jsonl, ops/growth/experiments.json and ops/ultrastability.jsonl"}
        m["action_classes_consistent_share"] = {"value": fr["action_classes_consistent_share"], "n": fr["classes_judged"], "source": "foundation/freeadapt.py over the same ledgers"}
        m["survival_levels_met"] = {"value": lv["met"], "n": lv["measured"], "source": "ops/criticality.jsonl and ops/executor-log.jsonl (foundation/freeadapt.py)"}
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"research: freeadapt readings failed: {e}", file=sys.stderr)
        m["efficiency_verdict_share"] = m["action_classes_consistent_share"] = m["survival_levels_met"] = {"value": None, "n": 0, "source": "unreadable"}
    try:
        from . import ultrastability as U3
        ls = U3.lessons_share(root)
        m["lessons_enforced_share"] = {"value": ls, "n": None if ls is None else 1, "source": "doctrine/lessons.json (foundation/lessons.py)"}
    except (OSError, ValueError, KeyError) as e:
        print(f"research: lessons reading failed: {e}", file=sys.stderr)
        m["lessons_enforced_share"] = {"value": None, "n": 0, "source": "unreadable"}
    try:  # MULTISTABLE-1 and Ashby's journal (ASHBY-ARCHIVE-1)
        from . import ultrastability as U4
        col, ver = U4.collisions(root), U4.versatility(root)
        m["second_loop_collision_share_7d"] = {**col, "source": "ops/ultrastability.jsonl steps against doctrine/ultrastability.json ladders"}
        m["step_versatility_share"] = {**ver, "source": "doctrine/ultrastability.json ladders and the files they name"}
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"research: multistable readings failed: {e}", file=sys.stderr)
        m["second_loop_collision_share_7d"] = m["step_versatility_share"] = {"value": None, "n": 0, "source": "unreadable"}
    try:
        from . import ashbyarchive as AA
        ar = AA.report(root)
        m["archive_triaged_share"] = {"value": ar["archive_triaged_share"], "n": ar["n"], "source": "doctrine/ashby-archive.json (foundation/ashbyarchive.py)"}
        m["archive_principles_built_share"] = {"value": ar["principles_built_share"], "n": len(ar["principles"]), "source": "doctrine/ashby-archive.json principles and their probes"}
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"research: archive register unreadable: {e}", file=sys.stderr)
        m["archive_triaged_share"] = m["archive_principles_built_share"] = {"value": None, "n": 0, "source": "doctrine/ashby-archive.json (unreadable)"}
    m.update(_register_shares(root))
    fs = [f for st in studies(root, pol) for f in st.get("findings", []) if f.get("metric") != "research_findings_met_share"]
    met = [f for f in fs if verdict(f, m)["status"] == "met"]
    m["research_findings_met_share"] = {"value": round(len(met) / len(fs), 3) if fs else None, "n": len(fs), "source": "research/studies, each finding measured as above"}
    m["_window"] = {"start": ISO(start) if start else None, "end": ISO(end) if end else None, "days": round((end - start).total_seconds() / 86400, 2) if start else None,
                    "prs": len(prs), "merged": len(merged), "regime": last.get("regime"), "k_self": last.get("k_self"),
                    "as_of": max([x for x in (snap.get("fetched_at"), last.get("at"), deps[-1].get("at") if deps else None) if x] or [None], key=lambda x: _t(x) if x else dt.datetime.min.replace(tzinfo=dt.timezone.utc))}
    return m


def essential_measured(rows: list[dict], end, days=7) -> dict:
    """FREELY-ADAPTIVE-1 (Pérez López, 1974: "an organization may die because it does not know that its essential variables are disturbed"): the
    latest reading of every essential variable seen in the last `days`; a variable whose latest reading has no value is not known."""
    cut, last = end - dt.timedelta(days=days), {}
    for r in rows:
        if r.get("ev") == "reading" and r.get("var") and (_t(r.get("at")) or cut) >= cut:
            last[r["var"]] = r
    known = sum(1 for r in last.values() if r.get("value") is not None and not r.get("unmeasured"))
    return {"value": round(known / len(last), 3) if last else None, "n": len(last), "source": f"ops/ultrastability.jsonl, latest reading per variable in the last {days} days"}


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def _resolves(root: Path, mech: str) -> bool:
    """A mechanism 'path::marker' resolves when the file exists and, if a marker is named, the marker text occurs in it."""
    path, _, marker = str(mech).partition("::")
    f = root / path
    if not f.is_file():
        return False
    return not marker or marker.strip('"') in f.read_text(encoding="utf-8", errors="replace")


def _register_shares(root: Path) -> dict:
    """CYBERNETICS-PROGRAM-1: the four readings the cybernetics studies stand on, each from a register in this repository; an unreadable register is n=0, never a pass."""
    out, miss = {}, lambda src: {"value": None, "n": 0, "source": f"{src} (missing or unreadable)"}
    try:
        reg, det = _json(root / "doctrine/registers.json"), _json(root / "doctrine/detectors.json")
        modes = [x["id"] for x in (reg or {}).get("failure_modes", [])]
        covered = {x.get("failure_mode") for x in (det or {}).get("detectors", [])}
        out["failure_modes_detected_share"] = {"value": round(sum(1 for i in modes if i in covered) / len(modes), 3), "n": len(modes), "source": "doctrine/registers.json against doctrine/detectors.json"} if modes and det else miss("doctrine/registers.json")
    except (OSError, ValueError, KeyError) as e:
        print(f"research: failure-mode register unreadable: {e}", file=sys.stderr)
        out["failure_modes_detected_share"] = miss("doctrine/registers.json")
    try:
        cs = (_json(root / "doctrine/ashby-concepts.json") or {}).get("concepts", [])
        out["ashby_concepts_bound_share"] = {"value": round(sum(1 for c in cs if c.get("mechanisms") and all(_resolves(root, x) for x in c["mechanisms"])) / len(cs), 3), "n": len(cs), "source": "doctrine/ashby-concepts.json, each mechanism read in the repository"} if cs else miss("doctrine/ashby-concepts.json")
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"research: concept map unreadable: {e}", file=sys.stderr)
        out["ashby_concepts_bound_share"] = miss("doctrine/ashby-concepts.json")
    try:
        roles = ((_json(root / "doctrine/managers.json") or {}).get("roles") or {})
        out["managers_closed_share"] = {"value": round(sum(1 for r in roles.values() if r.get("runs") and r.get("clock") and r.get("probe") and r.get("settles")) / len(roles), 3), "n": len(roles), "source": "doctrine/managers.json"} if roles else miss("doctrine/managers.json")
    except (OSError, ValueError, AttributeError) as e:
        print(f"research: managers register unreadable: {e}", file=sys.stderr)
        out["managers_closed_share"] = miss("doctrine/managers.json")
    try:
        g = _json(root / "seed/autonomy/goals.json") or {}
        tg = [x["id"] for x in g.get("goals", []) if x.get("level") == "target"]
        withk = {k.get("goal_id") for k in g.get("knobs", [])}
        out["targets_with_knobs_share"] = {"value": round(sum(1 for i in tg if i in withk) / len(tg), 3), "n": len(tg), "source": "seed/autonomy/goals.json"} if tg else miss("seed/autonomy/goals.json")
    except (OSError, ValueError, KeyError) as e:
        print(f"research: goals unreadable: {e}", file=sys.stderr)
        out["targets_with_knobs_share"] = miss("seed/autonomy/goals.json")
    return out


def verdict(finding: dict, ms: dict) -> dict:
    mv = ms.get(finding["metric"], {}).get("value")
    t = finding["target"]
    if mv is None or ms.get(finding["metric"], {}).get("n") == 0:  # REDTEAM-1: a reading with no data is never met (vacuous pass)
        return {"status": "unmeasured", "value": mv}
    return {"status": "met" if OPS[t["op"]](mv, t["value"]) else "not-met", "value": mv}


def validate(root=REPO) -> list[str]:
    root = Path(root)
    bad, pol = [], load(root)
    for k in ("studies_dir", "papers_dir", "state_dir", "page_module", "perspectives", "intake", "questions"):
        if k not in pol:
            bad.append(f"{POLICY}: missing {k}")
    items = [("question " + q["id"], q) for q in pol.get("questions", [])]
    ids = set()
    for s in studies(root, pol):
        for k in ("id", "title", "authors", "version", "summary", "findings"):
            if not s.get(k):
                bad.append(f"study {s.get('id')}: missing {k}")
        if s.get("id") in ids:
            bad.append(f"study {s['id']}: duplicate id")
        ids.add(s.get("id"))
        for f in s.get("findings", []):
            items.append((f"{s['id']}:{f.get('id')}", f))
            if f.get("perspective") not in pol.get("perspectives", {}):
                bad.append(f"{s['id']}:{f.get('id')}: perspective {f.get('perspective')!r} is not in {POLICY}")
            if not f.get("claim") or not f.get("mechanisms"):
                bad.append(f"{s['id']}:{f.get('id')}: needs a claim and at least one mechanism")
            for mech in f.get("mechanisms", []):
                if not (root / mech.get("path", "")).exists():
                    bad.append(f"{s['id']}:{f.get('id')}: mechanism path {mech.get('path')} does not exist")
    for name, f in items:
        if f.get("metric") not in METRICS:
            bad.append(f"{name}: unknown metric {f.get('metric')!r}")
        if (f.get("target") or {}).get("op") not in OPS:
            bad.append(f"{name}: target op must be one of {sorted(OPS)}")
        mt = PRED.match(f.get("prediction", ""))
        if not mt or mt["metric"] != f.get("metric"):
            bad.append(f"{name}: prediction must read '<metric> <op> <number> within <N> h' on its own metric")
    if not bad:  # WHITEPAPER-1: every paper passes the white-paper gate before it is published
        ms = measures(root, pol)
        for st in studies(root, pol):
            bad += gate(paper(root, st, ms, {}), st)
    page = root / pol.get("page_module", "")
    if page.is_file():
        got = re.findall(r'"study_id": "([^"]+)"', page.read_text(encoding="utf-8"))
        if sorted(set(got)) != sorted(ids):
            bad.append(f"{pol['page_module']}: papers {sorted(set(got))} do not match studies {sorted(ids)}; run research --page --apply")
    else:
        bad.append(f"{pol.get('page_module')}: missing; run research --page --apply")
    return bad


def _rules(root) -> list[dict]:
    """Standing rules from agents/AGENTS.md: each bullet whose bold lead ends with an id in parentheses."""
    text = (Path(root) / "agents/AGENTS.md").read_text(encoding="utf-8")
    out = []
    for line in text.splitlines():
        mt = re.match(r"^- \*\*(.+?)\((?P<id>[A-Z][A-Z0-9-]+-\d+)[,)]", line)
        if mt:
            out.append({"id": mt["id"], "text": re.sub(r"[`*]", "", line)[:1200]})
    return out


def leads(root, study) -> dict:
    """Further rule links proposed by core/connect (lexical route, no credential). A lead is a proposal, never a fact."""
    payload = {"findings": [{"id": f["id"], "text": f"{f['concern']}. {f['claim']}", "mapped": [m["rule"] for m in f["mechanisms"]]} for f in study["findings"]], "rules": _rules(root)}
    try:
        r = subprocess.run(["node", "scripts/research_connect.mjs"], cwd=root, input=json.dumps(payload), capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"research: connect leads unavailable: {e}", file=sys.stderr)
        return {"route": None, "leads": [], "error": str(e)[:200]}
    if r.returncode:
        print(f"research: connect leads failed: {r.stderr.strip()[:300]}", file=sys.stderr)
        return {"route": None, "leads": [], "error": r.stderr.strip()[:200]}
    return json.loads(r.stdout or "{}")


def limits(study, ms) -> list[str]:
    w = ms["_window"]
    uses_prs = any(f["metric"].startswith(("pr_", "system_", "verified_deploys", "revert_", "deploy_")) for f in study["findings"])
    out = list(study.get("limits", []))
    if not uses_prs:
        return out + [f"Source. {study['kind'][:1].upper() + study['kind'][1:]}, version {study['version']}."]
    out += [f"Scale. One organization: {w['prs']} closed pull requests ({w['merged']} merged) over {w['days']} days" + (f", against {study['scale_compare']}" if study.get("scale_compare") else "") + ". "
           "Our numbers describe this system; they are not a causal estimate and are not compared with the study's effect sizes as if they were."]
    s = ms["system_authored_share"]["value"]
    if s is not None:
        out.append(f"Who wrote the changes. {round(100 * (1 - s))}% of merged pull requests in the window were opened by code agent sessions run under the owner's account, "
                   f"not by the system's own loops. The latest criticality tick puts the system in the {w['regime'] or 'unknown'} regime with {ms['self_deploys']['value']} self-originated deploys, "
                   "so most of the work measured here was started from outside.")
    out.append("Review by construction. Ultrastable has no human review step, so a short open-to-merge time is partly a consequence of the design. "
               "The real test of the design is quality: the revert and deploy-verification findings, which can fail.")
    out.append("Revert share counts commits whose subject starts with Revert; a fix that undoes a change without that word is not counted, so the figure is a lower bound.")
    out.append(f"Source. {study['kind'][:1].upper() + study['kind'][1:]}, version {study['version']}; its findings may change in later versions.")
    return out


# WHITEPAPER-1 (Rowan, 2026-11-25): "it would be nice if it was written in a more professional tone, like an actual white paper, not just a paragraph
# ... we learned a lot from QNFO about proper research writing ... humans want to read text, and they want it to seem well thought out and professional."
# WHITEPAPER-2 (Rowan, same day): "White papers don't need quantitative results, but they do need a compelling reason to read them, especially
# [for] somebody who might implement it." So a paper is an executive summary, the problem and why it matters now, the approach, how to put it into
# practice, trade-offs and limits, and a call to action, with numbered references where a claim needs one. Live numbers appear only where a real
# reading exists; nothing is invented and no table is forced. gate() refuses a paper with no clear problem, no concrete approach or no actionable
# path, and write_page() publishes only papers that pass it.
SECTIONS = ("summary", "problem", "approach", "practice", "tradeoffs", "action")  # WHITEPAPER-2: a white paper, not a research paper
ASHBY = {"key": "ashby1952", "text": "Ashby, W. R. (1952; corrected 1954). Design for a Brain: The Origin of Adaptive Behaviour. John Wiley & Sons, New York.",
         "url": "https://archive.org/details/designforbrain00ashb"}
SELF_REF = {"key": "ultrastable", "text": "Ultrastable (2026). Source code, ledgers and loop registry of the Ultrastable system. Read for this paper at the date of generation.",
            "url": "https://github.com/ultrastable/ultrastable"}


def references(study) -> list[dict]:
    own = study.get("institution") == "Ultrastable"
    refs = []
    if not own:
        refs.append({"key": study["id"], "text": f"{', '.join(study['authors'])} ({study['version']}). {study['title']}. {study['institution']}; {study['kind']}.",
                     "url": study.get("source_url")})
    if study["id"] != "ashby-1952":
        refs.append(ASHBY)
    refs += [r for r in study.get("references", []) if r.get("key") not in {x["key"] for x in refs}]
    refs.append(SELF_REF)
    return refs


def _lc(t: str) -> str:
    return t[0].lower() + t[1:] if len(t) > 1 and not t[1].isupper() else t


def cite(refs, key) -> str:
    return f"[{[r['key'] for r in refs].index(key) + 1}]"


def sections(study, fs, met, lim, method, refs) -> dict:
    mp = study.get("misperception") or {}
    own = study.get("institution") == "Ultrastable"
    src = cite(refs, study["id"]) if not own else cite(refs, "ultrastable")
    ash = cite(refs, "ashby1952") if study["id"] != "ashby-1952" else src
    me = cite(refs, "ultrastable")
    summary = []
    if mp:
        summary.append(f"Many people believe that {_lc(mp['belief'])} This paper argues otherwise: {_lc(mp['counter'])}")
    summary.append(study.get("paper_frame") or f"We read {study['title']} for what it means to anyone running an autonomous system.")
    summary.append(f"It is written for people who build or run AI systems and want them to keep working without someone watching. It names {len(fs)} concrete problems, "
                   "the mechanism that answers each one, and how to put that mechanism in place.")
    problem = [f"{study['summary']} {src}"]
    if mp:
        problem.append(f"This matters now because the usual answer, {_lc(mp['short']).rstrip('.')}, sends teams after the wrong fix. A better model or another reviewer "
                       "does not close a loop that nothing checks.")
    problem.append("The problems in detail:")
    problem_list = [f"{f['concern']}. {f['claim']} {src}" for f in fs]
    approach = [f"The approach follows Ashby's ultrastable system {ash}: a first loop acts on the world, and a second loop changes the first loop's settings "
                "whenever a variable that matters leaves its limits, and keeps changing them until it is back inside.",
                f"Ultrastable is that design as working code {me}. For each problem above it uses a specific mechanism:"]
    approach_list = [f"{f['concern']}: " + "; ".join(f"{m['how']} ({m['rule']}, `{m['path']}`)" for m in f["mechanisms"]) for f in fs]
    practice = ["To apply this to your own system, one step per problem:"]
    practice_list = [f"{f['concern']}. Put in place: {f['mechanisms'][0]['how']}. Check it with one number, {f['metric_label']}, and set a limit for it "
                     f"({f['target']['op']} {f['target']['value']} is the limit we use)." for f in fs]
    measured = [f for f in fs if f["measured"] is not None]
    if measured:
        note = (f"In our own system, {met} of {len(fs)} of these checks pass today. "
                        + " ".join(f"{f['metric_label'][0].upper() + f['metric_label'][1:]} reads {f['measured']} (n = {f['n']}; source: {f['source']})." for f in measured[:3])
                        + " Where a check fails, a work item carries the fix, and it closes only when the same check passes.")
    else:
        note = None
    action = ["Read the code that does this; it is source-available: https://github.com/ultrastable/ultrastable",
              "Start a system of your own on the same foundation: https://ultrastable.io/start",
              "Follow new papers by feed: https://ultrastable.io/research.atom"]
    return {"summary": summary, "problem": problem, "problem_list": problem_list, "approach": approach, "approach_list": approach_list,
            "practice": practice, "practice_list": practice_list, "practice_note": [note] if note else [], "tradeoffs": lim, "action": action}


NUM = re.compile(r"(?<![\w.`/-])\d+(?:\.\d+)?%?")


def sourced_numbers(p, study=None) -> set:
    """NO-MADE-UP-NUMBERS-1 (Rowan, 2026-11-25): "Never, ever ... make up numbers that can't be double-checked ... supported, verified, sourced, cited."
    The numbers a paper may print: the measurements (each with its source file), the targets, the window, and figures quoted in the study file or its references."""
    ok = set()
    def add(v):
        if v is None or isinstance(v, bool):
            return
        for m in NUM.findall(json.dumps(v) if not isinstance(v, (int, float)) else str(v)):
            ok.add(m.rstrip("%"))
    for f in p.get("findings", []):
        for k in ("measured", "n", "target", "id", "metric_label", "source", "claim", "concern", "where", "mechanisms"):
            add(f.get(k))
    add(p.get("derived")); add(p.get("window")); add(p.get("study")); add(p.get("references")); add(p.get("title")); add(p.get("met")); add(p.get("total"))
    if study:
        add(study)
    return ok


def unsourced(p, study=None) -> list[str]:
    ok = sourced_numbers(p, study)
    text = " ".join(" ".join(v) for v in (p.get("sections") or {}).values()) + " " + p.get("abstract", "")
    text = re.sub(r"\[\d+\]", "", text)  # citation markers are not claims
    text = re.sub(r"https?://\S+|`[^`]*`|[A-Z][A-Z0-9-]*-\d+", "", text)  # links, code paths and rule ids are not claims
    out = []
    for m in NUM.findall(text):
        v = m.rstrip("%")
        if v in ok or str(float(v)).rstrip("0").rstrip(".") in {str(float(x)).rstrip("0").rstrip(".") for x in ok if re.fullmatch(r"\d+(\.\d+)?", x)}:
            continue
        if m.endswith("%") and any(abs(float(v) - 100 * float(x)) < 0.6 for x in ok if re.fullmatch(r"\d+(\.\d+)?", x)):
            continue
        out.append(m)
    return sorted(set(out))


def gate(p, study=None) -> list[str]:
    """What a white paper lacks before it may be published (WHITEPAPER-2): a clear problem, a concrete approach, an actionable path, and no number
    that does not trace to a measurement or a cited source (NO-MADE-UP-NUMBERS-1)."""
    sec = p.get("sections") or {}
    bad = [f"{p['slug']}: missing section {k}" for k in SECTIONS if not sec.get(k)]
    if not sec.get("problem_list"):
        bad.append(f"{p['slug']}: no concrete problem stated")
    if not sec.get("practice_list"):
        bad.append(f"{p['slug']}: no step a reader can take")
    if not any("https://" in a for a in sec.get("action") or []):
        bad.append(f"{p['slug']}: call to action has no link")
    if not p.get("references") or not re.search(r"\[\d+\]", " ".join(sec.get("problem", []) + sec.get("approach", []))):
        bad.append(f"{p['slug']}: problem or approach cites nothing")
    if len(p.get("abstract", "")) < 200:
        bad.append(f"{p['slug']}: summary too short")
    nums = unsourced(p, study)
    if nums:
        bad.append(f"{p['slug']}: numbers with no source: {', '.join(nums)}")
    return bad


def paper(root, study, ms, lds) -> dict:
    fs = []
    for f in study["findings"]:
        v = verdict(f, ms)
        fs.append({**{k: f[k] for k in ("id", "concern", "claim", "where", "perspective", "mechanisms", "metric", "target", "prediction")},
                   "metric_label": METRICS[f["metric"]], "measured": v["value"], "status": v["status"], "n": ms[f["metric"]]["n"], "source": ms[f["metric"]]["source"],
                   "item": None if v["status"] == "met" else f"Q-RES-{study['id']}-{f['id']}"})
    met = sum(1 for f in fs if f["status"] == "met")
    w = ms["_window"]
    abstract = (f"{', '.join(study['authors'])} ({study['institution']}): {study['summary']} "
                f"{study.get('paper_frame', 'We map each finding to the mechanisms Ultrastable uses and test each mapping against this system’s own records.')} "
                f"{met} of {len(fs)} are met today; each one that is not is an open work item with a closing probe, "
                "and this paper is regenerated from the measurements after every merge.")
    lim = limits(study, ms)
    method = ("Metrics come from the system's own files: ops/research/prs.json (closed pull requests read from GitHub), ops/deploys.jsonl, ops/criticality.jsonl, ops/ultrastability.jsonl, doctrine/ultrastability.json, the loop registry and git history. "
              "Reproduce with `python3 -m foundation research --report`; every finding not met has a Q-RES item whose closing probe is `python3 -m foundation research --probe STUDY:F`.")
    refs = references(study)
    return {"study_id": study["id"], "slug": study["id"], "order": study.get("order", 9), "title": study.get("paper_title") or f"What {study['title']} means for an autonomous system",
            "sections": sections(study, fs, met, lim, method, refs), "references": refs,
            "derived": ([round(100 * (1 - ms["system_authored_share"]["value"]))] if ms["system_authored_share"]["value"] is not None else []) + [ms["self_deploys"]["value"]],
            "study": {k: study[k] for k in ("title", "authors", "institution", "kind", "version", "data", "summary")},
            "abstract": abstract, "window": w, "findings": fs, "met": met, "total": len(fs), "limits": lim,
            "leads": lds.get("leads", []), "leads_route": lds.get("route"),
            "method": method}


def markdown(p) -> str:
    sec = p["sections"]
    names = {"summary": "Executive summary", "problem": "1. The problem", "approach": "2. The approach", "practice": "3. Putting it into practice",
             "tradeoffs": "4. Trade-offs and limits", "action": "5. Next steps"}
    L = [f"<!-- GENERATED by foundation/research.py (RESEARCH-1, WHITEPAPER-2). Do not edit; regenerated after every merge. -->", f"# {p['title']}", "",
         "*An Ultrastable white paper. Ultrastable is the foundation for any autonomous system.*", ""]
    for k in SECTIONS:
        L += [f"## {names[k]}", ""]
        if k in ("tradeoffs", "action"):
            L += [f"- {x}" for x in sec[k]] + [""]
            continue
        for para in sec[k]:
            L += [para, ""]
        if sec.get(k + "_list"):
            L += [f"{n}. {x}" for n, x in enumerate(sec[k + "_list"], 1)] + [""]
        for para in sec.get(k + "_note") or []:
            L += [para, ""]
    L += ["## References", ""] + [f"{n}. {r['text']}" + (f" {r['url']}" if r.get("url") else "") for n, r in enumerate(p["references"], 1)] + [""]
    return "\n".join(L)


def write_page(root, pol, papers, ms, intake_state) -> None:
    root = Path(root)
    (root / pol["papers_dir"]).mkdir(parents=True, exist_ok=True)
    by = {st["id"]: st for st in studies(root, pol)}
    held = [p for p in papers if gate(p, by.get(p["study_id"]))]
    for p in held:
        print("research: paper held back by the white-paper gate: " + "; ".join(gate(p, by.get(p["study_id"]))), file=sys.stderr)
    papers = [p for p in papers if not gate(p, by.get(p["study_id"]))]
    for p in papers:
        (root / pol["papers_dir"] / f"{p['slug']}.md").write_text(markdown(p), encoding="utf-8")
    covered = sorted({f["perspective"] for p in papers for f in p["findings"]})
    data = {"as_of": ms["_window"].get("as_of") or ISO(NOW()), "papers": papers, "perspectives": {k: k in covered for k in pol["perspectives"]},
            "questions": [{**q, **verdict(q, ms), "metric_label": METRICS[q["metric"]]} for q in pol["questions"]],
            "intake": [{k: c[k] for k in ("id", "title", "perspective", "url", "score")} for c in intake_state.get("candidates", [])[:10]]}
    head = "// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// Copyright (c) Ultrastable\n// GENERATED by foundation/research.py (RESEARCH-1) from research/studies/*.json and the system's ledgers. Do not edit; regenerated after every merge.\n"
    (root / pol["page_module"]).write_text(head + "export default " + json.dumps(data, indent=1) + ";\n", encoding="utf-8")


def _issue(root, iid, title, body, labels) -> bool:
    p = Path(root) / "docs/issues" / f"{iid}.json"
    if p.exists():
        return False
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": body, "labels": labels, "milestone": "Next", "workstream": "Growth"}, indent=2) + "\n", encoding="utf-8")
    return True


def file_items(root, study, ms, apply) -> list[str]:
    """A finding (or, with study id "question", an internal R&D question) not met today becomes one Q-RES item; its closing probe is the measurement."""
    out = []
    for f in study["findings"]:
        v = verdict(f, ms)
        if v["status"] == "met":
            continue
        iid = f"Q-RES-{study['id']}-{f['id']}"
        body = (f"**Owner:** product-manager\n**Trigger:** research pass: {study['id']} finding {f['id']} is {v['status']} (measured {v['value']})\n"
                f"**Done check:** cmd:python3 -m foundation research --probe {study['id']}:{f['id']}\n**Prediction:** {f['prediction']}\n"
                f"**Out of scope:** editing the study, its target or the paper to match the code; the measurement is changed only by changing the mechanism\n"
                f"**Closing probe:** `python3 -m foundation research --probe {study['id']}:{f['id']}`\n**Status:** open\n\n"
                f"Concern: {f['concern'].rstrip('.?')}. The study: {f['claim']}\n\nMechanisms that should answer it: " + ("; ".join(f"{m['rule']} ({m['path']})" for m in f["mechanisms"]) or "none yet; build one") +
                f".\n\nMetric: {METRICS[f['metric']]}, target {f['target']['op']} {f['target']['value']}. Improve the mechanism (or add one) until the probe passes; "
                "the white paper at /research updates itself from the same measurement.")
        if apply and _issue(root, iid, f"{f['concern']} (measured {v['value']}, target {f['target']['op']} {f['target']['value']})", body, ["role:product-manager", "research", "plus"]):
            out.append(iid)
        elif not apply and not (Path(root) / "docs/issues" / f"{iid}.json").exists():
            out.append(iid)
    return out


def experiments(root, pol, keyed, ms, apply, now=None) -> dict:
    """One open experiment per finding or question: settle it when its window has passed, then open the next round."""
    now = now or NOW()
    st = Path(root) / pol["state_dir"]
    exps, outs = _jsonl(st / "experiments.jsonl"), [_payload(r) for r in _jsonl(st / "outcomes.jsonl")]
    settled = {(o["key"], o["opened_at"]) for o in outs}
    latest = {}
    for e in exps:
        latest[e["key"]] = e
    new_e, new_o = [], []
    for key, f in keyed:
        mt = PRED.match(f["prediction"])
        cur = ms.get(f["metric"], {}).get("value")
        e = latest.get(key)
        if e and (key, e["opened_at"]) not in settled:
            if now >= _t(e["opened_at"]) + dt.timedelta(hours=e["window_h"]):
                new_o.append({"key": key, "opened_at": e["opened_at"], "settled_at": ISO(now), "metric": e["metric"], "observed": cur,
                              "met": None if cur is None else OPS[e["op"]](cur, e["value"]), "baseline": e.get("baseline")})
            else:
                continue
        new_e.append({"key": key, "opened_at": ISO(now), "metric": mt["metric"], "op": mt["op"], "value": float(mt["value"]), "window_h": int(mt["h"]), "baseline": cur})
    if apply:
        from . import openstd  # OPEN-STANDARDS-1: every event ledger line is a CloudEvents 1.0 event
        st.mkdir(parents=True, exist_ok=True)
        with (st / "outcomes.jsonl").open("a", encoding="utf-8") as fh:
            fh.writelines(json.dumps(openstd.cloudevent("io.ultrastable.research.outcome_settled", "/loop/research", o, subject=o["key"], now=now)) + "\n" for o in new_o)
        with (st / "experiments.jsonl").open("a", encoding="utf-8") as fh:
            fh.writelines(json.dumps(e) + "\n" for e in new_e)
    return {"opened": len(new_e), "settled": len(new_o), "met": sum(1 for o in new_o if o["met"])}


def _fetch(url, timeout=20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-research/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def intake(root=REPO, apply=False, fetch=_fetch) -> dict:
    """Read each perspective's feed, score entries by the perspective's keywords, file the best candidates; uncovered perspectives first."""
    pol = load(root)
    st = Path(root) / pol["state_dir"]
    path = st / "intake.json"
    prev = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"candidates": [], "errors": []}
    seen = {c["id"] for c in prev["candidates"]} | {s.get("source_id") for s in studies(root, pol)}
    covered = {f["perspective"] for s in studies(root, pol) for f in s["findings"]}
    order = sorted(pol["perspectives"], key=lambda k: (k in covered, k))
    ns = {"a": "http://www.w3.org/2005/Atom"}
    cands, errors = [], []
    for persp in order:
        q = pol["intake"]["queries"].get(persp)
        if not q:
            continue
        try:
            feed = ET.fromstring(fetch(pol["intake"]["feed"].format(query=q)))
        except Exception as e:  # a feed outage is recorded and the other perspectives still run
            errors.append({"perspective": persp, "error": f"{type(e).__name__}: {e}"[:200]})
            continue
        for ent in feed.findall("a:entry", ns):
            eid = (ent.findtext("a:id", "", ns) or "").rsplit("/", 1)[-1]
            title = " ".join((ent.findtext("a:title", "", ns) or "").split())
            text = (title + " " + (ent.findtext("a:summary", "", ns) or "")).lower()
            score = sum(1 for kw in pol["perspectives"][persp] if kw in text) + (1 if persp not in covered else 0)
            if eid and eid not in seen and score >= pol["intake"]["min_score"]:
                cands.append({"id": eid, "title": title, "perspective": persp, "url": f"https://arxiv.org/abs/{eid}", "score": score, "found_at": ISO(NOW())})
                seen.add(eid)
    cands.sort(key=lambda c: (-c["score"], c["perspective"] in covered))
    filed = []
    for c in cands[: pol["intake"]["max_intake_items"]]:
        iid = "Q-RES-INTAKE-" + re.sub(r"[^A-Za-z0-9]+", "-", c["id"])
        body = (f"**Owner:** product-manager\n**Trigger:** research intake, perspective {c['perspective']}, score {c['score']}\n"
                f"**Done check:** cmd:python3 -m foundation research --probe intake:{c['id']}\n**Prediction:** research_studies >= {len(studies(root, pol)) + 1} within 336 h\n**Status:** open\n\n"
                f"Candidate study: {c['title']} ({c['url']}). Read it; if it has findings about AI systems that this system can test, add research/studies/<id>.json "
                f"with \"source_id\": \"{c['id']}\", one entry per finding (concern, claim, mechanisms with paths, metric from foundation/research.py METRICS, target, prediction). "
                f"If it has none, add its id to ops/research/intake.json \"declined\" with the reason. Either closes this item.")
        if apply and _issue(root, iid, f"ingest candidate study: {c['title'][:90]}", body, ["role:product-manager", "research"]):
            filed.append(iid)
    state = {"candidates": (cands + prev["candidates"])[:60], "declined": prev.get("declined", {}), "errors": errors, "at": ISO(NOW())}
    if apply:
        st.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, indent=1) + "\n", encoding="utf-8")
    return {"candidates": len(cands), "filed": filed, "errors": errors}


def canon(root=REPO, apply=False) -> dict:
    """CANON-1: file the next primary source of the cybernetics program that no study ingests yet (source_id canon:<id>)."""
    pol = load(root)
    cn = pol.get("canon") or {}
    have = {s.get("source_id") for s in studies(root, pol)}
    todo = [c for c in cn.get("sources", []) if f"canon:{c['id']}" not in have]
    filed = []
    for c in todo[: cn.get("per_pass", 1)]:
        iid = "Q-RES-CANON-" + c["id"]
        where = c.get("url") or "the original edition (cite publisher, year and pages)"
        body = (f"**Owner:** product-manager\n**Trigger:** research canon, next source not yet ingested\n"
                f"**Done check:** cmd:python3 -m foundation research --probe intake:canon:{c['id']}\n"
                f"**Prediction:** research_findings_met_share >= 0 within 336 h\n**Out of scope:** paraphrase from secondary sources; numbers not in the original\n**Status:** open\n\n"
                f"Read {c['title']} by {c['authors']} ({c['year']}) from {where}. Add research/studies/{c['id']}.json with \"source_id\": \"canon:{c['id']}\", "
                f"a misperception it answers for AI systems, and findings bound to metrics in foundation/research.py METRICS, each with a mechanism path in this repository. "
                f"State the ideas in our own words with page or chapter. Then run research --run --apply; the thought loop posts it.")
        if apply and _issue(root, iid, f"research canon: {c['title'][:80]} ({c['authors']}, {c['year']})", body, ["role:product-manager", "research"]):
            filed.append(iid)
    return {"remaining": len(todo), "filed": filed}


def _first_commit(root, rel):
    r = subprocess.run(["git", "-C", str(root), "log", "--diff-filter=A", "--format=%cI", "--", rel], capture_output=True, text=True)
    ts = r.stdout.split()
    return _t(ts[-1]) if r.returncode == 0 and ts else None


def canon_probe(root=REPO, apply=False, fetch=_fetch, now=None) -> dict:
    """CANON-2: three server-side readings so the program's health never rests on a session watching. Each late or missing step files its own Q-AUDIT-canon item.
    (1) a filed Q-RES-CANON item with no study after sla.study_h; (2) a study whose paper is not on the live /research page after sla.live_h;
    (3) a paper not in social/calendar.json after sla.social_h. A page that cannot be read is unmeasured and fails the run; it never passes."""
    pol = load(root)
    sla = (pol.get("canon") or {}).get("sla") or {"study_h": 168, "live_h": 48, "social_h": 240}
    now = now or NOW()
    root = Path(root)
    late, unmeasured = [], []
    have = {s.get("source_id") for s in studies(root, pol)}
    for c in (pol.get("canon") or {}).get("sources", []):
        rel = f"docs/issues/Q-RES-CANON-{c['id']}.json"
        if f"canon:{c['id']}" in have or not (root / rel).is_file():
            continue
        t0 = _first_commit(root, rel)
        if t0 and (now - t0).total_seconds() / 3600 > sla["study_h"]:
            late.append(("study", c["id"], f"{rel} has no study after {sla['study_h']} h"))
    cal = root / "social/calendar.json"
    posted = {p.get("paper") for p in (json.loads(cal.read_text(encoding="utf-8")).get("posts", []) if cal.is_file() else [])}
    try:
        page = fetch("https://ultrastable.io/research")
    except Exception as e:
        page = None
        unmeasured.append(f"/research unreadable: {type(e).__name__}: {e}"[:200])
    for st in studies(root, pol):
        t0 = _first_commit(root, f"research/studies/{st['id']}.json")
        if not t0:
            unmeasured.append(f"{st['id']}: no commit date")
            continue
        age = (now - t0).total_seconds() / 3600
        if page is not None and age > sla["live_h"] and f"/research/{st['id']}" not in page:
            late.append(("live", st["id"], f"paper {st['id']} not on /research after {sla['live_h']} h"))
        if age > sla["social_h"] and st["id"] not in posted:
            late.append(("social", st["id"], f"paper {st['id']} not in social/calendar.json after {sla['social_h']} h"))
    filed = []
    for kind, sid, why in late:
        iid = f"Q-AUDIT-canon-{kind}-{sid}"
        body = (f"**Owner:** product-manager\n**Trigger:** research --probe-canon, {why}\n**Done check:** cmd:python3 -m foundation research --probe-canon\n"
                f"**Prediction:** canon_late_steps <= 0 within 24 h\n**Out of scope:** hand-writing the paper or the post outside the loops\n**Status:** open\n\n"
                f"{why}. Find which loop stalled (research pass, merge lane, deploy, social run), fix that loop's cause, and re-run the probe.")
        if apply and _issue(root, iid, why, body, ["role:product-manager", "research"]):
            filed.append(iid)
    return {"late": [w for _, _, w in late], "unmeasured": unmeasured, "filed": filed}


def _gh(url) -> str:
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "ultrastable-research/1", **({"Authorization": f"Bearer {tok}"} if tok else {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def refresh_prs(root=REPO, repo="ultrastable/ultrastable", fetch=_gh, pages=5) -> int:
    """The last pages*100 closed pull requests, from the REST API (CI's own token when present). Author class from the opener's account."""
    raw = []
    for page in range(1, pages + 1):
        got = json.loads(fetch(f"https://api.github.com/repos/{repo}/pulls?state=closed&per_page=100&sort=created&direction=desc&page={page}"))
        raw += got
        if len(got) < 100:
            break
    def cls(u):
        login = u.get("login", "")
        if u.get("type") != "Bot" and not login.endswith("[bot]"):
            return "session"
        return "system-actions" if login.startswith("github-actions") else "system-app"
    prs = [{"repo": repo, "number": p["number"], "created_at": p["created_at"], "merged_at": p.get("merged_at"), "author": cls(p.get("user") or {})} for p in raw]
    st = Path(root) / load(root)["state_dir"]
    st.mkdir(parents=True, exist_ok=True)
    (st / "prs.json").write_text(json.dumps({"schema": "research-prs/1", "source": f"GitHub REST pulls?state=closed, last {len(prs)} closed pull requests", "fetched_at": ISO(NOW()),
                                              "note": "author: session = a code agent session under the owner's account (outside input); system-actions / system-app = opened by the system's own workflows or GitHub App",
                                              "prs": prs}, indent=0) + "\n", encoding="utf-8")
    return len(prs)


def probe(root, key) -> tuple[bool, str]:
    pol = load(root)
    if key.startswith("intake:"):
        cid = key.split(":", 1)[1]
        st = Path(root) / pol["state_dir"] / "intake.json"
        declined = json.loads(st.read_text(encoding="utf-8")).get("declined", {}) if st.is_file() else {}
        ok = cid in declined or any(s.get("source_id") == cid for s in studies(root, pol))
        return ok, f"intake {cid}: {'ingested or declined' if ok else 'not yet ingested'}"
    sid, _, fid = key.partition(":")
    ms = measures(root, pol)
    for s in studies(root, pol):
        for f in s["findings"]:
            if s["id"] == sid and f["id"] == fid:
                v = verdict(f, ms)
                return v["status"] == "met", f"{key}: {f['metric']} = {v['value']} target {f['target']['op']} {f['target']['value']} ({v['status']})"
    for q in pol["questions"]:
        if sid == "question" and q["id"] == fid:
            v = verdict(q, ms)
            return v["status"] == "met", f"{key}: {q['metric']} = {v['value']} ({v['status']})"
    return False, f"{key}: no such finding"


def run(root=REPO, apply=False, with_leads=True) -> dict:
    pol = load(root)
    ms = measures(root, pol)
    sts = studies(root, pol)
    papers, filed = [], []
    sts.sort(key=lambda x: (x.get("order", 9), x["id"]))
    for s in sts:
        papers.append(paper(root, s, ms, leads(root, s) if with_leads else {"leads": []}))
        filed += file_items(root, s, ms, apply)
    filed += file_items(root, {"id": "question", "findings": [{**q, "concern": q["question"], "claim": "internal R&D question", "mechanisms": []} for q in pol["questions"]]}, ms, apply)
    keyed = [(f"{s['id']}:{f['id']}", f) for s in sts for f in s["findings"]] + [(f"question:{q['id']}", q) for q in pol["questions"]]
    ex = experiments(root, pol, keyed, ms, apply)
    ist = Path(root) / pol["state_dir"] / "intake.json"
    if apply:
        write_page(root, pol, papers, ms, json.loads(ist.read_text(encoding="utf-8")) if ist.is_file() else {})
        with (Path(root) / pol["state_dir"] / "log.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": ISO(NOW()), "studies": len(sts), "findings": sum(p["total"] for p in papers), "met": sum(p["met"] for p in papers), "filed": filed, "experiments": ex}) + "\n")
    return {"studies": len(sts), "met": sum(p["met"] for p in papers), "findings": sum(p["total"] for p in papers), "filed": filed, "experiments": ex, "papers": [p["slug"] for p in papers]}


def main(argv=None) -> int:
    av = list(sys.argv[1:] if argv is None else argv)
    apply = "--apply" in av
    if "--check" in av:
        bad = validate()
        print("\n".join(bad) if bad else f"research: {len(studies())} studies valid, page module current")
        return 1 if bad else 0
    if "--probe" in av:
        ok, why = probe(REPO, av[av.index("--probe") + 1])
        print(why)
        return 0 if ok else 1
    if "--probe-canon" in av:
        out = canon_probe(REPO, apply)
        print(json.dumps(out, indent=1))
        return 1 if out["late"] or out["unmeasured"] else 0
    if "--intake" in av:
        print(json.dumps({**intake(REPO, apply), "canon": canon(REPO, apply)}, indent=1))
        return 0
    if "--refresh-prs-if-stale" in av:  # REDTEAM-1 (stale): the papers say they regenerate after every merge, so their source may not be days old
        snap = REPO / load(REPO)["state_dir"] / "prs.json"
        at = _t(json.loads(snap.read_text(encoding="utf-8")).get("fetched_at")) if snap.is_file() else None
        if at and (dt.datetime.now(dt.timezone.utc) - at).total_seconds() < 86400:
            print("research: pull-request snapshot is under a day old"); return 0
        print(f"research: {refresh_prs(REPO)} pull requests recorded"); return 0
    if "--refresh-prs" in av:
        print(f"research: {refresh_prs(REPO)} pull requests recorded")
        return 0
    if "--page" in av:
        pol = load()
        ms = measures(REPO, pol)
        papers = [paper(REPO, s, ms, leads(REPO, s)) for s in sorted(studies(REPO, pol), key=lambda x: (x.get("order", 9), x["id"]))]
        ist = REPO / pol["state_dir"] / "intake.json"
        if apply:
            write_page(REPO, pol, papers, ms, json.loads(ist.read_text(encoding="utf-8")) if ist.is_file() else {})
        print(f"research: {len(papers)} papers {'written' if apply else 'rendered (dry run)'}")
        return 0
    if "--report" in av:
        ms = measures()
        for s in studies():
            for f in s["findings"]:
                v = verdict(f, ms)
                print(f"{s['id']}:{f['id']:<3} {v['status']:<10} {f['metric']} = {v['value']} (target {f['target']['op']} {f['target']['value']}, n {ms[f['metric']]['n']})")
        print("window:", json.dumps(ms["_window"]))
        return 0
    if "--run" in av:
        print(json.dumps(run(REPO, apply), indent=1))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())

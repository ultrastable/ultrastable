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
    m["_window"] = {"start": ISO(start) if start else None, "end": ISO(end) if end else None, "days": round((end - start).total_seconds() / 86400, 2) if start else None,
                    "prs": len(prs), "merged": len(merged), "regime": last.get("regime"), "k_self": last.get("k_self"),
                    "as_of": max([x for x in (snap.get("fetched_at"), last.get("at"), deps[-1].get("at") if deps else None) if x] or [None], key=lambda x: _t(x) if x else dt.datetime.min.replace(tzinfo=dt.timezone.utc))}
    return m


def verdict(finding: dict, ms: dict) -> dict:
    mv = ms.get(finding["metric"], {}).get("value")
    t = finding["target"]
    if mv is None:
        return {"status": "unmeasured", "value": None}
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
        return out + [f"Source. {study['kind'].capitalize()}, version {study['version']}."]
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
    out.append(f"Source. {study['kind'].capitalize()}, version {study['version']}; its findings may change in later versions.")
    return out


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
    return {"study_id": study["id"], "slug": study["id"], "order": study.get("order", 9), "title": study.get("paper_title") or f"What {study['title']} means for an autonomous system",
            "study": {k: study[k] for k in ("title", "authors", "institution", "kind", "version", "data", "summary")},
            "abstract": abstract, "window": w, "findings": fs, "met": met, "total": len(fs), "limits": limits(study, ms),
            "leads": lds.get("leads", []), "leads_route": lds.get("route"),
            "method": "Metrics come from the system's own files: ops/research/prs.json (closed pull requests read from GitHub), ops/deploys.jsonl, ops/criticality.jsonl, ops/ultrastability.jsonl, doctrine/ultrastability.json, the loop registry and git history. "
                      "Reproduce with `python3 -m foundation research --report`; every finding not met has a Q-RES item whose closing probe is `python3 -m foundation research --probe STUDY:F`."}


def markdown(p) -> str:
    L = [f"<!-- GENERATED by foundation/research.py (RESEARCH-1). Do not edit; regenerated after every merge. -->", f"# {p['title']}", "",
         "> Ultrastable is the foundation for any autonomous system.", "", "## Abstract", "", p["abstract"], "", "## The study", "",
         f"{p['study']['title']}. {', '.join(p['study']['authors'])}, {p['study']['institution']}; {p['study']['kind']}, version {p['study']['version']}. Data: {p['study']['data'].rstrip('.')}.", "",
         "## Findings, mechanisms and measurements", ""]
    for f in p["findings"]:
        val = "not measured" if f["measured"] is None else f"{f['measured']} (n = {f['n']})"
        L += [f"### {f['id']}. {f['concern']} ({f['perspective']})", "", f"**The study:** {f['claim']} ({f['where']})", "",
              "**How Ultrastable answers it:**", ""] + [f"- {m['rule']} (`{m['path']}`): {m['how']}" for m in f["mechanisms"]] + ["",
              f"**Measured here:** {f['metric_label']}: {val}. Target {f['target']['op']} {f['target']['value']}. Verdict: **{f['status']}**." + (f" Open item: `{f['item']}`." if f["item"] else ""),
              f"Source: {f['source']}.", ""]
    L += ["## Limits", ""] + [f"- {x}" for x in p["limits"]] + [""]
    if p["leads"]:
        L += ["## Proposed further links (leads, not findings)", "", f"Found by core/connect on the {p['leads_route']} route; each is a proposal until a study file adopts it.", ""]
        L += [f"- {x['finding']} may also relate to {x['rule']} (similarity {x['score']})" for x in p["leads"]] + [""]
    L += ["## Method", "", p["method"], ""]
    return "\n".join(L)


def write_page(root, pol, papers, ms, intake_state) -> None:
    root = Path(root)
    (root / pol["papers_dir"]).mkdir(parents=True, exist_ok=True)
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
                f"**Done check:** cmd:python3 -m foundation research --probe {study['id']}:{f['id']}\n**Prediction:** {f['prediction']}\n**Status:** open\n\n"
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
    exps, outs = _jsonl(st / "experiments.jsonl"), _jsonl(st / "outcomes.jsonl")
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
        st.mkdir(parents=True, exist_ok=True)
        with (st / "outcomes.jsonl").open("a", encoding="utf-8") as fh:
            fh.writelines(json.dumps(o) + "\n" for o in new_o)
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
    if "--intake" in av:
        print(json.dumps(intake(REPO, apply), indent=1))
        return 0
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

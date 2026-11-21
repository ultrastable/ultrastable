"""COMPONENTS-1: the system as a computed graph; gap analysis, user stories and investor objections that cannot drift from the code.
Ultrastable is the foundation for any autonomous system.

Nothing is asserted. doctrine/components.json lists components, edges, users, stories and objections, each with probes. This module evaluates them:
component live / built / partial / missing; edge wired / unwired; story pass / fail; objection supported / unsupported / unverified / invalid
(a competitor shown natively offering a component in doctrine/market-evidence.json invalidates any objection answer that says nobody does).
Every gap becomes an OL-GAP-* item whose closing probe is this module, so the gap analysis closes itself.

  python3 -m foundation components --check          problems with the data itself (unknown ids, missing probes)
  python3 -m foundation components --report         the computed picture as JSON
  python3 -m foundation components --file-gaps       one OL-GAP item per gap (idempotent)
  python3 -m foundation components --evidence        write instances/ultrastable/funding/evidence.json (the funding packet's evidence, generated)
  python3 -m foundation components --probe KIND:ID   exit 0 iff that component / edge / story / objection is healthy now
"""
from __future__ import annotations
import json, re
from pathlib import Path

from . import selfhost

REPO = Path(__file__).resolve().parents[1]
PATH, MARKET, EVIDENCE = "doctrine/components.json", "doctrine/market-evidence.json", "instances/ultrastable/funding/evidence.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def market(root=REPO):
    p = Path(root) / MARKET
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None


def _ok(root, spec) -> bool:
    try:
        return selfhost.probe(root, spec)
    except ValueError:
        return False


def component_status(root, c) -> str:
    impl = [_ok(root, p) for p in c["impl"]]
    proof = [_ok(root, p) for p in c["proof"]]
    if all(impl) and all(proof):
        return "live"
    if all(impl):
        return "built"
    return "partial" if any(impl) else "missing"


def evaluate(root=REPO) -> dict:
    root, d = Path(root), load(root)
    comps = {k: component_status(root, v) for k, v in d["components"].items()}
    edges = [{"from": e["from"], "to": e["to"], "wired": _ok(root, e["probe"]) and comps[e["from"]] != "missing" and comps[e["to"]] != "missing"} for e in d["edges"]]
    stories = [{"user": u, "id": s["id"], "pass": _ok(root, s["acceptance"]) and all(comps[c] == "live" for c in s["components"])}
               for u, uv in d["users"].items() for s in uv["stories"]]
    mk = market(root)
    objections = []
    for o in d["objections"]:
        live = all(comps[c] == "live" for c in o["cites"])
        invalid, unknown = [], []
        for comp in o["nobody_offers"]:
            if mk is None:
                unknown.append(comp)
                continue
            for prod, pv in mk["products"].items():
                cell = pv["components"].get(comp, {"native": "unknown"})
                if cell["native"] == "yes":
                    invalid.append(f"{prod}:{comp}")
                elif cell["native"] == "unknown":
                    unknown.append(f"{prod}:{comp}")
        verdict = "invalid" if invalid else "unverified" if unknown else "supported" if live else "unsupported"
        objections.append({"id": o["id"], "verdict": verdict, "components_live": live, "competitors_offering": invalid, "unverified_cells": len(unknown)})
    return {"components": comps, "edges": edges, "stories": stories, "objections": objections,
            "integration": {"edges_wired": sum(e["wired"] for e in edges), "edges": len(edges), "components_live": sum(v == "live" for v in comps.values()), "components": len(comps)}}


def check(root=REPO) -> list:
    root, bad = Path(root), []
    d = load(root)
    ids = set(d["components"])
    for k, c in d["components"].items():
        for f in ("what", "impl", "proof"):
            if not c.get(f):
                bad.append(f"component {k}: lacks {f}")
    for e in d["edges"]:
        for end in (e["from"], e["to"]):
            if end not in ids:
                bad.append(f"edge {e['from']}->{e['to']}: unknown component {end}")
    for u, uv in d["users"].items():
        for s in uv["stories"]:
            for c in s["components"]:
                if c not in ids:
                    bad.append(f"story {s['id']}: unknown component {c}")
    for o in d["objections"]:
        for c in o["cites"] + o["nobody_offers"]:
            if c not in ids:
                bad.append(f"objection {o['id']}: unknown component {c}")
    connected = {e["from"] for e in d["edges"]} | {e["to"] for e in d["edges"]}
    for k in sorted(ids - connected - {"gap-analysis"}):
        bad.append(f"component {k}: connected to nothing (an island is not part of a system)")
    ev = root / EVIDENCE
    if ev.is_file() and json.loads(ev.read_text(encoding="utf-8")) != evidence(root):
        bad.append(f"{EVIDENCE} is stale against the code (run components --evidence)")
    return bad


def _gap_item(root, iid, title, text, probe) -> bool:
    p = Path(root) / "docs/issues" / f"{iid}.json"
    if p.exists():
        return False
    body = f"**Owner:** portfolio-manager\n**Trigger:** every loop pass\n**Done check:** cmd:python3 -m foundation components --probe {probe}\n**Status:** open\n\n{text}"
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": body, "labels": ["role:portfolio-manager", "open-loop", "gap"], "milestone": "Now", "workstream": "Open loops"}, indent=2) + "\n", encoding="utf-8")
    return True


def file_gaps(root=REPO) -> list:
    ev, filed = evaluate(root), []
    d = load(root)
    for k, st in ev["components"].items():
        if st != "live":
            what = "no passing impl probe" if st == "missing" else "implementation exists but no proof (test or live evidence) passes" if st == "built" else "part of the implementation is missing"
            if _gap_item(root, f"OL-GAP-{k}", f"component {k} is {st}", f"{d['components'][k]['what']}. Status {st}: {what}. Build the missing piece, with a test.", f"component:{k}"):
                filed.append(f"OL-GAP-{k}")
    for e in ev["edges"]:
        if not e["wired"] and _gap_item(root, f"OL-GAP-edge-{e['from']}-{e['to']}", f"{e['from']} is not wired to {e['to']}", "Components that are not connected are not a system. Add the wiring in code and a test that exercises it.", f"edge:{e['from']}>{e['to']}"):
            filed.append(f"OL-GAP-edge-{e['from']}-{e['to']}")
    for s in ev["stories"]:
        if not s["pass"] and _gap_item(root, f"OL-GAP-story-{s['id']}", f"user story {s['id']} does not pass", f"User {s['user']}: the acceptance probe or a component it needs is not live.", f"story:{s['id']}"):
            filed.append(f"OL-GAP-story-{s['id']}")
    for o in ev["objections"]:
        if o["verdict"] == "unverified" and _gap_item(root, f"OL-GAP-verify-{o['id']}", f"objection {o['id']} rests on {o['unverified_cells']} unverified market cells", "Read the primary vendor page for each unknown cell in doctrine/market-evidence.json and set native to yes, partial or no with a source. An unknown cell never counts as support.", f"objection-verified:{o['id']}"):
            filed.append(f"OL-GAP-verify-{o['id']}")
        if o["verdict"] in ("invalid", "unsupported") and _gap_item(root, f"OL-GAP-objection-{o['id']}", f"objection {o['id']} is {o['verdict']}", f"Competitors offering natively: {o['competitors_offering'] or 'none'}. Either the answer must change to what is still unique, or the missing component must be built.", f"objection:{o['id']}"):
            filed.append(f"OL-GAP-objection-{o['id']}")
    return filed


def probe(root, spec: str) -> bool:
    kind, _, ident = spec.partition(":")
    ev = evaluate(root)
    if kind == "component":
        return ev["components"].get(ident) == "live"
    if kind == "edge":
        a, _, b = ident.partition(">")
        return any(e["wired"] for e in ev["edges"] if e["from"] == a and e["to"] == b)
    if kind == "story":
        return any(s["pass"] for s in ev["stories"] if s["id"] == ident)
    if kind == "objection":
        return any(o["verdict"] in ("supported", "unverified") for o in ev["objections"] if o["id"] == ident)
    if kind == "objection-verified":
        return any(o["verdict"] == "supported" for o in ev["objections"] if o["id"] == ident)
    raise ValueError(f"unknown probe kind {kind!r}")


def evidence(root=REPO) -> dict:
    """The investor / funder evidence, generated: computed statuses, who offers what (with sources), and each objection with its verdict."""
    root, d, ev, mk = Path(root), load(root), evaluate(root), market(root)
    matrix = {}
    if mk:
        for comp in d["components"]:
            matrix[comp] = {"ultrastable": ev["components"][comp], **{p: pv["components"].get(comp, {}).get("native", "unknown") for p, pv in mk["products"].items()}}
    return {"generated_by": "python3 -m foundation components --evidence", "market_accessed": (mk or {}).get("accessed"), "integration": ev["integration"],
            "components": {k: {"what": v["what"], "status": ev["components"][k]} for k, v in d["components"].items()}, "matrix": matrix,
            "users": {u: {"who": uv["who"], "stories": [{"id": s["id"], "story": s["story"], "passes": next(x["pass"] for x in ev["stories"] if x["id"] == s["id"])} for s in uv["stories"]]} for u, uv in d["users"].items()},
            "objections": [{"id": o["id"], "objection": o["objection"], "answer": o["answer"], **next(x for x in ev["objections"] if x["id"] == o["id"])} for o in d["objections"]],
            "closest_overlaps": (mk or {}).get("closest_overlaps", []),
            "caveats": ["Static probes (file, grep) show a connection exists in code; only a component with a passing proof probe (test or live evidence) is called live.", "Competitor cells come from doctrine/market-evidence.json with sources and an access date; unknown means not verified, and an unverified cell never counts as support."] + (mk or {}).get("caveats", [])}


def write_evidence(root=REPO) -> dict:
    ev = evidence(root)
    p = Path(root) / EVIDENCE
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ev, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return ev["integration"]


def main(argv) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation components")
    ap.add_argument("--check", action="store_true"); ap.add_argument("--report", action="store_true"); ap.add_argument("--file-gaps", action="store_true")
    ap.add_argument("--evidence", action="store_true"); ap.add_argument("--probe")
    a = ap.parse_args(argv)
    if a.probe:
        ok = probe(REPO, a.probe)
        print("healthy" if ok else f"{a.probe} is not healthy"); return 0 if ok else 1
    if a.report:
        print(json.dumps(evaluate(REPO), indent=1)); return 0
    if a.file_gaps:
        print(json.dumps(file_gaps(REPO), indent=1)); return 0
    if a.evidence:
        print(json.dumps(write_evidence(REPO))); return 0
    bad = check(REPO)
    print("components ok" if not bad else "\n".join(bad))
    return 1 if bad else 0

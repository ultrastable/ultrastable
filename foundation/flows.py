"""FLOW-DIRECTIVE-1 (Rowan, 2026-11-12): every loop declares typed inflows, outflows and its feedback path.

  python3 -m foundation flows --check    every loop in instances/ultrastable/loop-registry.json is declared in doctrine/flows.json or listed
                                          as pending (shrink-only); every inflow has a producer, every outflow a consumer (or, for an outflow
                                          to the world, a named returning signal that some loop consumes); every declared flow lies on a cycle
  python3 -m foundation flows --map      the signal graph as JSON (flows, edges, closed, pending)
  python3 -m foundation flows --workflows  every workflow with its loop, the signals in and out, and the bindings (secrets) it uses
  python3 -m foundation flows --sync     write each workflow-bearing flow's `bindings` from the secrets its workflows reference

Workflow rule (FLOW-DIRECTIVE-1, owner 2026-11-12): every workflow belongs to a loop that declares its flows (none may be pending), and the flow's `bindings`
equal the secrets the workflow files reference, so an input or output cannot travel on a binding nobody declared.

Fleet twin: QNFO/qnfo-workers _shared/flow-registry.js (same rules, Cloudflare runtime).
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOCTRINE = "doctrine/flows.json"
REGISTRY = "instances/ultrastable/loop-registry.json"


def load(root=REPO) -> tuple[dict, list]:
    d = json.loads((Path(root) / DOCTRINE).read_text(encoding="utf-8"))
    loops = json.loads((Path(root) / REGISTRY).read_text(encoding="utf-8"))["loops"]
    return d, loops


def graph(d: dict) -> dict:
    """Producer and consumer index, edges between flows, and the set of flows on a cycle."""
    flows = d["flows"]
    prod, cons = {}, {}
    for fid, f in flows.items():
        for o in f.get("outflows", []):
            prod.setdefault(o["signal"], set()).add(fid)
            if o.get("returns"):
                prod.setdefault(o["returns"], set()).add(fid)  # the world hands the result back to the flow that sent it
        for i in f.get("inflows", []):
            cons.setdefault(i["signal"], set()).add(fid)
    edges = {fid: set() for fid in flows}
    for sig, ps in prod.items():
        for p in ps:
            edges[p] |= cons.get(sig, set())
    closed = set()
    for start in flows:
        seen, stack = set(), list(edges[start])
        while stack:
            n = stack.pop()
            if n == start:
                closed.add(start)
                break
            if n not in seen:
                seen.add(n)
                stack.extend(edges.get(n, ()))
    return {"producers": prod, "consumers": cons, "edges": edges, "closed": closed}


def check(root=REPO, d: dict | None = None, loops: list | None = None) -> list[str]:
    if d is None or loops is None:
        d0, l0 = load(root)
        d, loops = d or d0, loops or l0
    bad = []
    ids = {l["id"] for l in loops}
    flows, pending = d["flows"], d.get("pending", [])
    for fid in flows:
        if fid not in ids:
            bad.append(f"flow {fid} names no loop in {REGISTRY}")
    for p in pending:
        if p in flows:
            bad.append(f"{p} is declared, remove it from pending (shrink the list)")
        elif p not in ids:
            bad.append(f"pending {p} names no loop")
    for i in sorted(ids - set(flows) - set(pending)):
        bad.append(f"loop {i} declares no flow (inflows, outflows, feedback) and is not pending")
    g = graph(d)
    implicit = d.get("implicit_producers", {})
    for fid, f in flows.items():
        for k in ("inflows", "outflows", "feedback"):
            if not f.get(k):
                bad.append(f"flow {fid} has no {k}")
        for x in f.get("inflows", []) + f.get("outflows", []):
            if not x.get("signal") or not x.get("via"):
                bad.append(f"flow {fid}: every inflow and outflow names a signal and the binding it travels on (via)")
        for i in f.get("inflows", []):
            s = i.get("signal")
            if s and s not in g["producers"] and s not in implicit:
                bad.append(f"flow {fid}: inflow {s} has no producer")
        for o in f.get("outflows", []):
            s = o.get("signal")
            if o.get("to"):
                if o["to"] not in d.get("external_sources", {}):
                    bad.append(f"flow {fid}: outflow {s} goes to unknown {o['to']}")
                if not o.get("returns"):
                    bad.append(f"flow {fid}: outflow {s} to the world names no returning signal")
                elif o["returns"] not in g["consumers"]:
                    bad.append(f"flow {fid}: returning signal {o['returns']} has no consumer")
            elif s and s not in g["consumers"]:
                bad.append(f"flow {fid}: outflow {s} has no consumer")
        if fid not in g["closed"]:
            bad.append(f"flow {fid} lies on no feedback cycle")
    return bad + workflow_check(d, loops, root)


SECRET = re.compile(r"secrets\.([A-Z][A-Z0-9_]*)")
FREE = {"GITHUB_TOKEN"}  # minted by GitHub for each run, not a binding anyone declares


def workflow_loops(root, loops) -> dict:
    wf = {p.name: [] for p in sorted((Path(root) / ".github/workflows").glob("*.yml"))}
    for l in loops:
        for w in l.get("workflows", []):
            wf.setdefault(w, []).append(l["id"])
    return wf


def derived_bindings(root, loops) -> dict:
    out = {}
    for w, ids in workflow_loops(root, loops).items():
        f = Path(root) / ".github/workflows" / w
        used = set(SECRET.findall(f.read_text(encoding="utf-8"))) - FREE if f.is_file() else set()
        for i in ids:
            out.setdefault(i, set()).update(used)
    return {k: sorted(v) for k, v in out.items()}


def workflow_check(d: dict, loops: list, root=REPO) -> list[str]:
    bad, flows = [], d["flows"]
    for w, ids in workflow_loops(root, loops).items():
        if not ids:
            bad.append(f"workflow {w} belongs to no loop")
        elif not any(i in flows for i in ids):
            bad.append(f"workflow {w}: its loops {ids} declare no flow (inflows, outflows, feedback)")
    for i, used in derived_bindings(root, loops).items():
        if i in flows and flows[i].get("bindings") != used:
            bad.append(f"flow {i}: bindings {flows[i].get('bindings')} differ from the secrets its workflows use {used}; run flows --sync")
    return bad


def sync(root=REPO) -> int:
    d, loops = load(root)
    for i, used in derived_bindings(root, loops).items():
        if i in d["flows"]:
            d["flows"][i]["bindings"] = used
    (Path(root) / DOCTRINE).write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")
    return 0


def workflow_table(root=REPO) -> list[dict]:
    d, loops = load(root)
    rows = []
    for w, ids in workflow_loops(root, loops).items():
        for i in ids:
            f = d["flows"].get(i, {})
            rows.append({"workflow": w, "loop": i, "in": [x["signal"] for x in f.get("inflows", [])], "out": [x["signal"] for x in f.get("outflows", [])],
                         "bindings": f.get("bindings", []), "declared": i in d["flows"]})
    return rows


def flow_map(root=REPO) -> dict:
    d, loops = load(root)
    g = graph(d)
    return {"directive": d["id"], "flows": len(d["flows"]), "pending": len(d.get("pending", [])), "loops": len(loops),
            "closed": sorted(g["closed"]), "edges": {k: sorted(v) for k, v in g["edges"].items()}}


def main(argv) -> int:
    a = list(argv)
    if "--workflows" in a:
        print(json.dumps(workflow_table(), indent=1))
        return 0
    if "--sync" in a:
        return sync()
    if "--map" in a:
        print(json.dumps(flow_map(), indent=1))
        return 0
    bad = check()
    if bad:
        print("\n".join(bad))
        return 1
    m = flow_map()
    print(f"flows ok: {m['flows']} declared, {len(m['closed'])} on a feedback cycle, {m['pending']} pending of {m['loops']} loops")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

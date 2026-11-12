"""FLOW-DIRECTIVE-1 (Rowan, 2026-11-12): every loop declares typed inflows, outflows and its feedback path.

  python3 -m foundation flows --check    every loop in instances/ultrastable/loop-registry.json is declared in doctrine/flows.json or listed
                                          as pending (shrink-only); every inflow has a producer, every outflow a consumer (or, for an outflow
                                          to the world, a named returning signal that some loop consumes); every declared flow lies on a cycle
  python3 -m foundation flows --map      the signal graph as JSON (flows, edges, closed, pending)

Fleet twin: QNFO/qnfo-workers _shared/flow-registry.js (same rules, Cloudflare runtime).
"""
from __future__ import annotations
import json, sys
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
    return bad


def flow_map(root=REPO) -> dict:
    d, loops = load(root)
    g = graph(d)
    return {"directive": d["id"], "flows": len(d["flows"]), "pending": len(d.get("pending", [])), "loops": len(loops),
            "closed": sorted(g["closed"]), "edges": {k: sorted(v) for k, v in g["edges"].items()}}


def main(argv) -> int:
    a = list(argv)
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

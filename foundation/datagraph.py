# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DATAGRAPH-1 (Rowan, 2026-11-25): every Ultrastable system keeps a knowledge graph of all its data. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation datagraph --check   the core module exists and is vendored byte-identical into the seed; the seed tick step, its migration (equal
                                            to the Worker's DDL) and its read routes are wired; every system in instances/ultrastable/progress.json and every
                                            tenant in doctrine/tenant-repos.json has a row in doctrine/knowledge-graph.json; a 'pending' row names a queue item
                                            in docs/issues/ and the tenant has the module in its vendor map; the rule is in every agent file
  python3 -m foundation datagraph --list    one line per system with its state
  python3 -m foundation datagraph --live    DATAGRAPH-LIVE-1: read every system's graph probe (row `probe`, else `public_api`) after a deploy and daily:
                                            a /health probe must answer ok with nodes > 0, a /api/graph probe built with nodes > 0; exit 1 otherwise.
                                            Run by deploy-ultrastable.yml after each deploy and by tenant-repos.yml daily, so "deployed but not
                                            confirmed live" is never left to a person to check

Data: doctrine/knowledge-graph.json. Consumers of what it guards: seed/worker/src/index.js (tick step knowledge-graph and /api/graph*), site/worker.js
(public /api/graph), the tenants' own Workers (vendor/ultrastable/datagraph.js). Tests: tests/foundation/test_datagraph.py.
A new system added to progress.json or tenant-repos.json fails this check until it has a graph or an item that builds one."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/knowledge-graph.json"
RULE = "DATAGRAPH-1"
RESEARCH = "docs/research/knowledge-graph.md"  # the research and design record; check() fails when it is gone
VENDOR_HEAD = "// VENDORED from ultrastable/workers core/datagraph/index.js"


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    pol = _j(root, POLICY)
    core, vend = root / pol["core_module"], root / pol["seed_vendor"]
    if not core.exists():
        return [f"{pol['core_module']} is missing"]
    if not vend.exists():
        bad.append(f"{pol['seed_vendor']} is missing")
    else:
        head, _, body = vend.read_text(encoding="utf-8").partition("\n")
        if not head.startswith(VENDOR_HEAD) or body != core.read_text(encoding="utf-8"):
            bad.append(f"{pol['seed_vendor']} differs from {pol['core_module']} (copy it with its one-line VENDORED header)")
    step = (root / pol["seed_step"]).read_text(encoding="utf-8") if (root / pol["seed_step"]).exists() else ""
    if not step:
        bad.append(f"{pol['seed_step']} is missing")
    mig = root / pol["migration"]
    if not mig.exists():
        bad.append(f"{pol['migration']} is missing")
    elif step:
        m = re.search(r"DATAGRAPH_DDL = \[(.*?)\];", step, re.S)
        ddl = re.findall(r"`([^`]+)`", m.group(1)) if m else []
        sql = mig.read_text(encoding="utf-8")
        if not ddl or any(d not in sql for d in ddl):
            bad.append(f"{pol['migration']} does not hold every statement of DATAGRAPH_DDL")
        if mig.name not in json.loads((mig.parent / "index.json").read_text(encoding="utf-8")):
            bad.append(f"{mig.name} is not listed in migrations/index.json")
    idx = (root / "seed/worker/src/index.js").read_text(encoding="utf-8")
    if "b('knowledge-graph', () => datagraphStep(" not in idx:
        bad.append("seed/worker/src/index.js does not run the knowledge-graph step")
    for ep in pol["endpoints"]:
        if f"'{ep}'" not in idx:
            bad.append(f"seed/worker/src/index.js does not serve {ep}")
    systems = pol.get("systems", {})
    want = {s["id"] for s in _j(root, "instances/ultrastable/progress.json").get("systems", [])} | {k for k, v in _j(root, "doctrine/tenant-repos.json").get("tenants", {}).items() if v.get("state") not in ("planned", "retired")}
    tenants = _j(root, "doctrine/tenant-repos.json").get("tenants", {})
    for sid in sorted(want - set(systems)):
        bad.append(f"system {sid} has no row in {POLICY}: give it the seed step or a pending row with a queue item")
    for sid, row in systems.items():
        st = row.get("state")
        if st not in ("seed-step", "pending", "built"):
            bad.append(f"{sid}: state {st!r} is not seed-step, pending or built")
        if st == "pending":
            item = row.get("item") or ""
            if not (root / "docs/issues" / f"{item}.json").exists():
                bad.append(f"{sid}: pending with no queue item docs/issues/{item}.json")
        if st in ("pending", "built") and sid in tenants and tenants[sid].get("state") != "own-repo":
            if (tenants[sid].get("vendor") or {}).get(pol["core_module"]) != pol["tenant_vendor_path"]:
                bad.append(f"{sid}: doctrine/tenant-repos.json does not vendor {pol['core_module']} to {pol['tenant_vendor_path']}")
        if st == "built" and row.get("engine"):
            # a tenant that maps its own records with the shared engine (seed/worker/src/knowledge.js) has it vendored where its row says
            if not (root / row["engine"]).exists():
                bad.append(f"{sid}: engine {row['engine']} is missing")
            if (tenants.get(sid, {}).get("vendor") or {}).get(row["engine"]) != row.get("vendor"):
                bad.append(f"{sid}: doctrine/tenant-repos.json does not vendor {row['engine']} to {row.get('vendor')}")
    if not (root / RESEARCH).exists():
        bad.append(f"{RESEARCH} is missing")
    for f in pol["rule_files"]:
        p = root / f
        if not p.exists() or RULE not in p.read_text(encoding="utf-8"):
            bad.append(f"{f} does not carry {RULE}")
    return bad


def _get(url, timeout=25):
    import urllib.request, urllib.error
    try:
        req = urllib.request.Request(url, headers={"user-agent": "ultrastable-datagraph-probe/1", "accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(400000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(400000).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001  an unreachable probe is the reading: not live
        return 0, str(e)[:200]


def reading(status: int, body: str) -> tuple[bool, str]:
    """(live, why) from one probe answer. /health: {ok, nodes}; /api/graph: {built, last: {nodes}}. A 503 health with nodes is a stale graph."""
    try:
        j = json.loads(body)
    except ValueError:
        return False, f"HTTP {status}, not JSON"
    if not isinstance(j, dict):
        return False, f"HTTP {status}, unexpected JSON"
    if "built" in j or "last" in j:
        nodes = ((j.get("last") or {}).get("nodes")) or 0
        return (status == 200 and bool(j.get("built")) and nodes > 0), f"HTTP {status}, built={j.get('built')}, nodes={nodes}"
    if isinstance(j.get("nodes"), list):  # a tenant's own /api/graph: {system, built_from, counts, nodes[], edges[]}; it is live when it answers 200 with nodes
        return (status == 200 and len(j["nodes"]) > 0), f"HTTP {status}, nodes={len(j['nodes'])}"
    nodes = j.get("nodes") or 0
    return (status == 200 and bool(j.get("ok")) and nodes > 0), f"HTTP {status}, ok={j.get('ok')}, nodes={nodes}, last run {j.get('last_run_hours_ago')} h ago"


def live(root=REPO, get=_get) -> list[dict]:
    out = []
    for sid, row in _j(root, POLICY)["systems"].items():
        url = row.get("probe") or row.get("public_api")
        if not url:
            out.append({"id": sid, "ok": False, "why": "no probe or public_api in " + POLICY})
            continue
        ok, why = reading(*get(url))
        out.append({"id": sid, "url": url, "ok": ok, "why": why})
    return out


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--live" in argv:
        rows = live()
        for r in rows:
            print(f"datagraph live: {r['id']:20} {'live' if r['ok'] else 'NOT LIVE'}  {r['why']}  {r.get('url', '')}")
        return 0 if all(r["ok"] for r in rows) else 1
    if "--list" in argv:
        for sid, row in _j(REPO, POLICY)["systems"].items():
            print(f"{sid:22} {row['state']:10} {row.get('item') or row.get('worker') or ''}")
        return 0
    bad = check()
    for b in bad:
        print("datagraph:", b)
    if not bad:
        print(f"datagraph: ok ({len(_j(REPO, POLICY)['systems'])} systems, core module vendored, seed step wired)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

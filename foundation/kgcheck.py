# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""KGRAPH-1 (Rowan, 2026-11-25): every Ultrastable system keeps a knowledge graph of all its data, built and maintained by itself.
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation kgraph --check   the platform tick runs the knowledge step and serves /api/graph; every system in
                                         instances/ultrastable/progress.json or doctrine/tenant-repos.json (bar the platform) is either live
                                         (vendors the shared engine and serves its route) or pending with an open queue item; the pending list
                                         only shrinks; the rule is in every agent file
  python3 -m foundation kgraph --list    one line per system

Data: doctrine/knowledge-graph.json. Engine: seed/worker/src/knowledge.js (tests seed/worker/test/knowledge.test.js). Tests: tests/foundation/test_kgcheck.py."""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/knowledge-graph.json"
RULE = "KGRAPH-1"
RULE_FILES = ["agents/AGENTS.md", "seed/agents/AGENTS.md", "agents/PROJECT-INSTRUCTIONS.md"]
ENGINE_SRC = "seed/worker/src/knowledge.js"


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def _live_at_base(root) -> set[str] | None:
    """Systems live on origin/main: none of them may go back to pending. None when main is unreadable (a fresh checkout)."""
    try:
        out = subprocess.run(["git", "show", f"origin/main:{POLICY}"], cwd=root, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as e:
        print(f"kgraph: base unreadable ({e}); shrink-only not checked", file=sys.stderr)
        return None
    if out.returncode != 0:
        return None
    return {k for k, v in json.loads(out.stdout).get("systems", {}).items() if v.get("state") == "live"}


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    pol = _j(root, POLICY)
    if not (root / pol["engine"]).exists():
        bad.append(f"engine {pol['engine']} is missing")
    p = pol["platform"]
    if p["step"] not in (root / p["step_file"]).read_text(encoding="utf-8"):
        bad.append(f"{p['step_file']}: the tick does not run the knowledge step {p['step']}")
    if p["route"] not in (root / p["routes_file"]).read_text(encoding="utf-8"):
        bad.append(f"{p['routes_file']}: the platform does not serve {p['route']}")
    progress = {s["id"] for s in _j(root, "instances/ultrastable/progress.json").get("systems", [])} - {"ultrastable"}
    repos = _j(root, "doctrine/tenant-repos.json").get("tenants", {})
    systems = pol.get("systems", {})
    for sid in sorted(progress | set(repos)):
        s = systems.get(sid)
        if not s:
            bad.append(f"{sid}: runs on Ultrastable but has no row in {POLICY} (live with the shared engine, or pending with a queue item)")
            continue
        if s.get("state") == "live":
            vend = repos.get(sid, {}).get("vendor", {})
            if vend.get(ENGINE_SRC) != s.get("vendor"):
                bad.append(f"{sid}: live but doctrine/tenant-repos.json does not vendor {ENGINE_SRC} to {s.get('vendor')}")
            if not s.get("route"):
                bad.append(f"{sid}: live but names no graph route")
        elif s.get("state") == "pending":
            item = s.get("item") or ""
            if not (root / "docs/issues" / f"{item}.json").exists():
                bad.append(f"{sid}: pending with no queue item docs/issues/{item}.json")
        else:
            bad.append(f"{sid}: state must be live or pending")
    for sid in systems:
        if sid not in progress | set(repos):
            bad.append(f"{sid}: row for a system Ultrastable does not run")
    for k in sorted(_live_at_base(root) or ()):
        if systems.get(k, {}).get("state") != "live":
            bad.append(f"{k}: was live on main and is not live now (a system never loses its graph)")
    for rel in RULE_FILES:
        f = root / rel
        if not f.exists() or RULE not in f.read_text(encoding="utf-8"):
            bad.append(f"{rel}: rule {RULE} missing")
    return bad


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--list" in argv:
        for sid, s in _j(REPO, POLICY)["systems"].items():
            print(f"{sid}: {s['state']}" + (f" ({s.get('item')})" if s.get("item") else f" {s.get('route', '')}"))
        return 0
    bad = check()
    for b in bad:
        print("kgraph:", b)
    print(f"kgraph: {'FAIL' if bad else 'ok'} ({len(bad)} problem(s))")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

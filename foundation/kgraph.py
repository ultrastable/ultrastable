# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""KGRAPH-1 (Rowan, 2026-11-25): "All UltraStable deployments and systems shall have a knowledge graph (graph network) to automatically build and maintain
a graph of connections for all data." Ultrastable is the foundation for any autonomous system.

  python3 -m foundation kgraph --check   every system in instances/ultrastable/progress.json and every tenant in doctrine/tenant-repos.json has a row in
                                         doctrine/knowledge-graph.json (url null means undeclared: the tick step files KG-<id> until it is built); the shared
                                         analytics and the tick step exist, the seed's vendored copy equals core, and the rule is in every agent file
  python3 -m foundation kgraph --list    one line per system: its graph url or "undeclared"

Consumers of what it guards: seed/worker/src/kgraph.js (tick step, /api/kgraph), tenant workers that serve /graph.json. Tests: tests/foundation/test_kgraph.py."""
from __future__ import annotations
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/knowledge-graph.json"
RULE = "KGRAPH-1"
RULE_FILES = ["agents/AGENTS.md", "seed/agents/AGENTS.md", "agents/PROJECT-INSTRUCTIONS.md"]
CODE = ["workers/core/kgraph/insight.js", "workers/core/kgraph/insight.test.js", "seed/worker/src/kgraph.js", "seed/worker/test/kgraph.test.js", "seed/worker/migrations/0031_kgraph.sql"]


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    pol = _j(root, POLICY)
    rows = {s["id"]: s for s in pol.get("systems", [])}
    want = {s["id"] for s in _j(root, "instances/ultrastable/progress.json").get("systems", [])} | set(_j(root, "doctrine/tenant-repos.json").get("tenants", {}))
    for sid in sorted(want - set(rows)):
        bad.append(f"{sid}: runs on Ultrastable but has no row in {POLICY}, so nothing checks its knowledge graph")
    for sid, s in rows.items():
        u = s.get("url")
        if u is not None and not str(u).startswith("https://"):
            bad.append(f"{sid}: graph url must be https ({u})")
    for rel in CODE:
        if not (root / rel).exists():
            bad.append(f"{rel}: missing")
    core, vend = root / "workers/core/kgraph/insight.js", root / "seed/worker/src/vendor/core/kgraph.js"
    if core.exists() and vend.exists() and vend.read_text(encoding="utf-8").split("\n", 1)[1] != core.read_text(encoding="utf-8"):
        bad.append("seed/worker/src/vendor/core/kgraph.js differs from workers/core/kgraph/insight.js")
    for rel in ["deploy/deploy-workers.mjs", "seed/worker/src/handoff.js"]:
        if not (root / rel).exists() or POLICY not in (root / rel).read_text(encoding="utf-8"):
            bad.append(f"{rel}: does not pass {POLICY} to the tick as config.kgraph")
    ix = root / "seed/worker/src/index.js"
    if not ix.exists() or "kgraphStep" not in ix.read_text(encoding="utf-8"):
        bad.append("seed/worker/src/index.js: the tick does not run the kgraph step")
    for rel in RULE_FILES:
        p = root / rel
        if not p.exists() or RULE not in p.read_text(encoding="utf-8"):
            bad.append(f"{rel}: rule {RULE} missing")
    return bad


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--list" in argv:
        for s in _j(REPO, POLICY)["systems"]:
            print(f"{s['id']}: {s.get('url') or 'undeclared'}")
        return 0
    bad = check()
    for b in bad:
        print("kgraph:", b)
    print(f"kgraph: {'FAIL' if bad else 'ok'} ({len(bad)} problem(s))")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TENANT-PROMO-1 (Rowan, 2026-11-22): promotion is part of every app's and tenant's role. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation tenantpromo --check   every system in instances/ultrastable/progress.json (bar the platform) has a promotion row, a social
                                              queue the core publisher drains, a live showcase on ultrastable.io, and, when its code lives in this
                                              repository, a /social-queue.json route built on the shared promoqueue module and links back to
                                              Ultrastable and its siblings
  python3 -m foundation tenantpromo --list    one line per tenant with what it has

Data: doctrine/tenant-promotion.json. Consumers of what it guards: seed/worker/src/social.js (drains social/gate.json tenant_queues),
site/worker.js (renders doctrine/stakeholders.json showcases), instances/*/worker (tenant pages). Tests: tests/foundation/test_tenantpromo.py.
A new tenant added to progress.json fails this check until it promotes itself, so promotion is never left to a person."""
from __future__ import annotations
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/tenant-promotion.json"
RULE = "TENANT-PROMO-1"
RULE_FILES = ["agents/AGENTS.md", "seed/agents/AGENTS.md", "agents/PROJECT-INSTRUCTIONS.md", "agents/roles/marketing-manager.md"]


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    pol = _j(root, POLICY)
    systems = [s for s in _j(root, "instances/ultrastable/progress.json").get("systems", []) if s["id"] != pol["platform"]]
    gate = _j(root, "social/gate.json")
    if gate.get("kill") is not False and gate.get("kill") is not True:
        bad.append("social/gate.json has no kill switch")
    queues = set(gate.get("tenant_queues") or [])
    shows = {c["id"]: c for c in _j(root, "doctrine/stakeholders.json").get("showcases", [])}
    tenants = pol.get("tenants", {})
    for s in systems:
        sid, t = s["id"], tenants.get(s["id"])
        if not t:
            bad.append(f"{sid}: runs on Ultrastable but has no promotion row in {POLICY}")
            continue
        if t.get("queue") not in queues:
            bad.append(f"{sid}: social queue {t.get('queue')} is not in social/gate.json tenant_queues, so nothing posts it")
        c = shows.get(t.get("showcase"))
        if not c or c.get("status") != "live" or not c.get("home"):
            bad.append(f"{sid}: no live showcase with a home in doctrine/stakeholders.json, so ultrastable.io does not promote it")
        repo = pol.get("in_repo", {}).get(s.get("repo", ""))
        if repo:
            wd = t.get("worker_dir")
            if not wd or not (root / wd).is_dir():
                bad.append(f"{sid}: code lives in {s['repo']} but worker_dir is missing")
                continue
            src = "\n".join(p.read_text(encoding="utf-8") for p in sorted((root / wd).glob("*.js")))
            for needle, why in [(repo["route"], "serves no social queue route"), (Path(repo["shared_module"]).name, "does not build its queue with the shared module"),
                                (repo["backlink"], "does not link back to Ultrastable"), ("stakeholders.json", "does not link its sibling systems")]:
                if needle not in src:
                    bad.append(f"{sid}: {why} ({needle})")
    for sid in tenants:
        if sid not in {s["id"] for s in systems}:
            bad.append(f"{sid}: promotion row for a system that is not in instances/ultrastable/progress.json")
    for rel in RULE_FILES:
        p = root / rel
        if not p.exists() or RULE not in p.read_text(encoding="utf-8"):
            bad.append(f"{rel}: rule {RULE} missing")
    return bad


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--list" in argv:
        pol = _j(REPO, POLICY)
        for sid, t in pol["tenants"].items():
            print(f"{sid}: queue {t['queue']} showcase {t['showcase']}" + (f" code {t['worker_dir']}" if t.get("worker_dir") else ""))
        return 0
    bad = check()
    for b in bad:
        print("tenantpromo:", b)
    print(f"tenantpromo: {'FAIL' if bad else 'ok'} ({len(bad)} problem(s))")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

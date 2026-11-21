# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""NO-OPEN-ITEMS-1 (Rowan, 2026-11-19): the system never leaves an item open or reports 'needs you'. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation openloops --check   fails on a banned phrase in a scanned file, a needs-you item with no default or connect link, or a gate with no surface, default or probe
Data: doctrine/open-loops.json. Consumers: doctrine/rules.json (rule no-open-items), .github/workflows/checks.yml, tests/foundation/test_openloops.py."""
from __future__ import annotations
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    d = json.loads((root / "doctrine/open-loops.json").read_text(encoding="utf-8"))
    for g in d["scan_globs"]:
        for p in root.glob(g):
            t = p.read_text(encoding="utf-8", errors="replace").lower()
            bad += [f"{p.relative_to(root)}: banned phrase '{b}'" for b in d["banned_phrases"] if b.lower() in t and "banned_phrases" not in t]
    ny = root / "foundation/data/needs-you.json"
    for i in json.loads(ny.read_text(encoding="utf-8")).get("items", []):
        for k in ("default", "connect"):
            if not i.get(k):
                bad.append(f"needs-you {i.get('id')}: missing {k}")
    for g in d["gates"]:
        for k in ("surfaces", "default", "probe", "reason"):
            if not g.get(k):
                bad.append(f"gate {g.get('id')}: missing {k}")
    from . import pathfinder  # PATHFINDER-1: an owner ask needs an exhaustion proof
    bad += [f"pathfinder: {b}" for b in pathfinder.check(root)] if (root / pathfinder.CFG).is_file() else []
    from . import modelwatch, unattended  # UNATTENDED-365, MODEL-WATCH-1: an external input that lapses is an open loop
    bad += [f"unattended: {b}" for b in unattended.check(root)] if (root / unattended.DATA).is_file() else []
    bad += [f"modelwatch: {b}" for b in modelwatch.check(root)] if (root / modelwatch.DATA).is_file() else []
    return bad


def main(argv=None) -> int:
    bad = check()
    print("\n".join(bad) or "openloops ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

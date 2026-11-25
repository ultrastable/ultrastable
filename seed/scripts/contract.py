#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-1 (Rowan, 2026-11-25): the template says what an Ultrastable system is, how it runs, how it bootstraps, and how it becomes autonomous
and reaches criticality, and the code proves it. Ultrastable is the foundation for any autonomous system.

  python3 scripts/contract.py --check [--root DIR]   every invariant's probe holds on this repository's own files; the bootstrap and ignition
                                                     ladders in doctrine/system-contract.json equal the code that runs them; doctrine/SYSTEM.md
                                                     is current; CLAUDE.md loads it
  python3 scripts/contract.py --write [--root DIR]   render doctrine/SYSTEM.md from the contract and the code (liveness metrics read from
                                                     worker/src/tick.js), so the page every agent loads is never typed by hand

Run by .github/workflows/bootstrap.yml in every system and by the platform's checks on the template (seed/). Test: tests/test_contract.py.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

CONTRACT = "doctrine/system-contract.json"
PAGE = "doctrine/SYSTEM.md"


def _code_bootstrap_stages(root: Path) -> list[str]:
    m = re.search(r'for name in \(([^)]*)\):\s*\n\s*st = boot\.guard', (root / "bootstrap/bootstrap.py").read_text())
    return re.findall(r'"([a-z_]+)"', m.group(1)) if m else []


def _code_ignition_stages(root: Path) -> list[str]:
    m = re.search(r"export const STAGES = \[([^\]]*)\]", (root / "worker/src/ignition.js").read_text())
    return re.findall(r"'([a-z-]+)'", m.group(1)) if m else []


def _code_liveness(root: Path) -> list[tuple[str, str, str, str]]:
    src = (root / "worker/src/tick.js").read_text()
    block = src[src.index("export const LIVENESS"):]
    block = block[:block.index("\n];")]
    return [(m.group(1), m.group(2), m.group(3), m.group(4)) for m in re.finditer(r"\['(M-[a-z-]+)', '([^']*)', '[a-z_0-9]+', '([<>=]+)', ([0-9.]+)", block)]


def render(root: Path) -> str:
    c = json.loads((root / CONTRACT).read_text())
    L = ["# What an Ultrastable system is", "", f"Generated from `{CONTRACT}` and the code by `python3 scripts/contract.py --write`. Do not edit by hand; "
         "`scripts/contract.py --check` fails when this page or the code drifts.", "", "> Ultrastable is the foundation for any autonomous system.", "",
         "## What it is", "", c["what"], "", "## How it runs", "", c["runs"], "",
         "Liveness metrics every system carries from its first tick (worker/src/tick.js); a breach files its own repair item:", ""]
    L += [f"- `{mid}` {name}: healthy when {op} {thr}" for mid, name, op, thr in _code_liveness(root)]
    L += ["", "## How it bootstraps", "", "`bootstrap/bootstrap.py` runs these stages in order. A blocked stage becomes a backlog item with an owner and a probe; only `qualify` ends a boot, for an idea that is not a system:", ""]
    L += [f"{i}. `{n}`: {w}" for i, (n, w) in enumerate(c["bootstrap_stages"], 1)]
    L += ["", "## How it becomes autonomous and reaches criticality", "", "The tick computes its own stage from its own tables (`worker/src/ignition.js`), "
          "files the first unmet one as `IGNITE-<stage>` and publishes it on `/health` and `/live`:", ""]
    L += [f"{i}. `{n}`: {w}" for i, (n, w) in enumerate(c["ignition_stages"], 1)]
    L += ["", c["criticality"], "", "## Invariants (each one probed on this repository by `scripts/contract.py --check`)", ""]
    L += [f"- **{v['id']}** ({v['rule']}): {v['says']}" for v in c["invariants"]]
    return "\n".join(L) + "\n"


def check(root: Path) -> list[str]:
    bad = []
    c = json.loads((root / CONTRACT).read_text())
    for v in c["invariants"]:
        for rel, needles in v["probe"].items():
            p = root / rel
            if not p.is_file():
                bad.append(f"{v['id']} ({v['rule']}): {rel} is missing")
                continue
            txt = p.read_text(encoding="utf-8")
            bad += [f"{v['id']} ({v['rule']}): {rel} does not contain {n!r}" for n in needles if n not in txt]
    if [n for n, _ in c["bootstrap_stages"]] != _code_bootstrap_stages(root):
        bad.append(f"bootstrap stages in {CONTRACT} differ from bootstrap/bootstrap.py: {_code_bootstrap_stages(root)}")
    if [n for n, _ in c["ignition_stages"]] != _code_ignition_stages(root):
        bad.append(f"ignition stages in {CONTRACT} differ from worker/src/ignition.js: {_code_ignition_stages(root)}")
    if not _code_liveness(root):
        bad.append("worker/src/tick.js: no liveness metrics could be read")
    page = root / PAGE
    if not page.is_file() or page.read_text() != render(root):
        bad.append(f"{PAGE} is not current: run python3 scripts/contract.py --write")
    return bad


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    root = Path(argv[argv.index("--root") + 1]) if "--root" in argv else Path(__file__).resolve().parents[1]
    if "--write" in argv:
        (root / PAGE).write_text(render(root))
        print(f"wrote {PAGE}")
        return 0
    bad = check(root)
    for b in bad:
        print("contract:", b)
    print(f"contract: {'FAIL' if bad else 'ok'} ({len(bad)} problem(s))")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

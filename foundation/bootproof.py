# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""BOOTPROOF-1 (Rowan, 2026-11-25): everything bootstraps from code alone, and a probe proves it every day.

"All surfaces, all files, all code, all instructions, everything has to work together automatically and seamlessly from the beginning ...
fully autonomous bootstrapping, everything."

The seed kernel (seed/) is what a new system is made from. This audit treats it as a fresh checkout and fails when something it needs is not
produced by code in the same tree: an agent instruction @import with no file, a wrangler placeholder nothing fills, a migration gap, a workflow
secret nobody declared (with its degrade route), a workflow with no trigger. The live half is `seedlaunch --e2e-scratch` (a never-before-used
slug deployed through the OIDC route and probed), run daily by seed-launch.yml.

  python3 -m foundation bootproof --check
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES = "doctrine/bootproof.json"
BUILTIN = {"GITHUB_TOKEN"}


def audit(root: Path = ROOT) -> list[str]:
    root = Path(root)
    seed = root / "seed"
    rules = json.loads((root / RULES).read_text())
    errs: list[str] = []
    for name in ("CLAUDE.md", "AGENTS.md"):
        f = seed / name
        if not f.exists():
            errs.append(f"seed/{name} missing: a new system would start with no agent instructions")
            continue
        for imp in re.findall(r"^@(\S+)$", f.read_text(), re.M):
            if imp != "AGENTS.md" and not (seed / imp).exists():
                errs.append(f"seed/{name} imports @{imp} but the seed does not carry it")
    tpl = (seed / "worker" / "wrangler.template.jsonc").read_text()
    boot = (seed / "bootstrap" / "bootstrap.py").read_text()
    for ph in sorted(set(re.findall(r"\{([a-z_0-9]+)\}", tpl))):
        if ph not in boot and ph not in rules["wrangler_filled_elsewhere"]:
            errs.append(f"wrangler placeholder {{{ph}}} is filled by nothing in bootstrap.py")
    nums = sorted(int(m.group(1)) for p in (seed / "worker" / "migrations").glob("*.sql") if (m := re.match(r"(\d+)", p.name)))
    dup = sorted({n for n in nums if nums.count(n) > 1} - set(rules["migration_duplicates_grandfathered"]))
    if dup:
        errs.append(f"seed migrations reuse number(s) {dup}: two changes collided (renaming an applied file would re-run it)")
    uniq = sorted(set(nums))
    if not uniq or uniq != list(range(uniq[0], uniq[0] + len(uniq))):
        errs.append(f"seed migrations are not a contiguous run: {uniq}")
    declared = set(rules["secrets"]) | BUILTIN
    for wf in sorted((seed / ".github" / "workflows").glob("*.yml")):
        text = wf.read_text()
        for s in sorted(set(re.findall(r"secrets\.([A-Z0-9_]+)", text)) - declared):
            errs.append(f"{wf.name} uses secret {s} that doctrine/bootproof.json does not declare with a route")
        if not re.search(r"^\s*(schedule|push|workflow_dispatch|pull_request|repository_dispatch|workflow_run):?", text, re.M):
            errs.append(f"{wf.name} has no trigger: it can never start by itself")
    for s, route in rules["secrets"].items():
        if not route.get("degrade") or not route.get("acquire"):
            errs.append(f"secret {s} lacks a degrade route or an automated acquire route")
    return errs


def main(argv=None) -> int:
    e = audit()
    print("bootproof ok" if not e else "\n".join(e))
    return 1 if e else 0


if __name__ == "__main__":
    sys.exit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Template is code only (TEMPLATE-CODE-ONLY-1, Rowan 2026-11-21). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation template --check     the template carries code and agent instructions only; exit 1 on any finding
  python3 -m foundation template --list      the findings, one per line (same as --check, exit 0)

This repository is the GitHub template new systems start from. `doctrine/template-boundary.json` names what may not live in it:
the company's own IP, legal, business and strategy papers (moved to the private ops repository, admin/), file names that only such
papers carry, and owner facts in the files the seed renders for a new system. Live data Ultrastable's own loops read sits under
`instances/ultrastable/`, beside the instance manifest. `check` also requires the rule in the agent files.
"""
from __future__ import annotations
import fnmatch, json, os, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/template-boundary.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def check(root=REPO, d: dict | None = None) -> list[str]:
    root = Path(root); d = d or load(root)
    bad = []
    for src, dst in d["moved"].items():
        p = root / src.rstrip("/")
        if p.exists():
            bad.append(f"{src}: admin material is back in the template; it lives in {d['admin_repo']} {dst}")
    for inst in d.get("instance_data", {}):
        if not inst.startswith("_") and not (root / inst.rstrip("/")).exists():
            bad.append(f"{inst}: declared instance data path is missing")
    skip = set(d["skip_dirs"])
    for base, dirs, names in os.walk(root):
        dirs[:] = [n for n in dirs if n not in skip]
        for n in names:
            if any(fnmatch.fnmatch(n, g) for g in d["banned_names"]):
                rel = (Path(base) / n).relative_to(root).as_posix()
                bad.append(f"{rel}: file name belongs to admin papers ({d['admin_repo']} admin/), not the template")
    sg = d["seed_generic"]
    for f in sg["files"]:
        p = root / f
        if not p.exists():
            bad.append(f"{f}: seed template file is missing")
            continue
        text = p.read_text(encoding="utf-8")
        for t in sg["banned_tokens"]:
            if t in text:
                bad.append(f"{f}: carries one instance's fact ({t!r}); the seed renders it for every new system")
    for f in d["agent_files"]:
        p = root / f
        if p.exists() and d["rule"] not in p.read_text(encoding="utf-8"):
            bad.append(f"{f}: does not state {d['rule']}")
    return bad


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    bad = check()
    print("\n".join(bad) if bad else "template ok: code and agent instructions only (TEMPLATE-CODE-ONLY-1)")
    return 1 if bad and "--list" not in argv else 0


if __name__ == "__main__":
    raise SystemExit(main())

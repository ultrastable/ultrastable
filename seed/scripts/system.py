#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""SYSTEM-1: the one definition of an Ultrastable system (doctrine/system.json), checked against the code that does each part.

  python3 scripts/system.py --check            every part names code that exists, and doctrine/SYSTEM.md is current
  python3 scripts/system.py --gen [--apply]    write doctrine/SYSTEM.md (imported by CLAUDE.md, so every agent starts from it)
  python3 scripts/system.py --root DIR ...     check another copy (the platform's clean room checks a fresh sandbox this way)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def load(root: Path) -> dict:
    return json.loads((root / "doctrine" / "system.json").read_text(encoding="utf-8"))


def render(d: dict) -> str:
    out = ["<!-- generated-by: scripts/system.py from doctrine/system.json (SYSTEM-1). Edit the JSON, then run --gen --apply. -->",
           "# What an Ultrastable system is", "", "> Ultrastable is the foundation for any autonomous system.", "", d["what"], ""]
    for s in d["sections"]:
        out += [f"## {s['title']}", ""]
        for p in s["parts"]:
            code = ", ".join(f"`{c}`" for c in p["code"])
            out.append(f"- **{p['id']}.** {p['says']} Code: {code}. Proof: {p['probe']}.")
        out.append("")
    return "\n".join(out)


def check(root: Path) -> list[str]:
    d, bad, seen = load(root), [], set()
    for s in d["sections"]:
        for p in s["parts"]:
            if p["id"] in seen:
                bad.append(f"part {p['id']} appears twice")
            seen.add(p["id"])
            if not p.get("code") or not p.get("probe"):
                bad.append(f"part {p['id']} needs code and a probe")
            for c in p.get("code", []):
                if not (root / c).exists():
                    bad.append(f"part {p['id']}: {c} does not exist (a statement with no code)")
    # doctrine/SYSTEM.md is the prose definition owned by COLDSTART-1 (a byte copy of the platform's
    # docs/doctrine/SYSTEM.md, checked by `foundation coldstart --check`); system.json is its machine map.
    if not (root / "doctrine" / "SYSTEM.md").exists():
        bad.append("doctrine/SYSTEM.md is missing")
    cl = root / "CLAUDE.md"
    if cl.exists() and "@doctrine/SYSTEM.md" not in cl.read_text(encoding="utf-8"):
        bad.append("CLAUDE.md does not import @doctrine/SYSTEM.md")
    return bad


def main(argv: list[str]) -> int:
    root = Path(argv[argv.index("--root") + 1]).resolve() if "--root" in argv else HERE
    if "--gen" in argv:
        text = render(load(root))
        if "--apply" in argv:
            (root / "doctrine" / "SYSTEM-MAP.md").write_text(text, encoding="utf-8")
        else:
            print(text)
        return 0
    bad = check(root)
    for b in bad:
        print("FAIL", b)
    print(f"system: {'ok' if not bad else str(len(bad)) + ' problem(s)'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""License consistency (runs in the existing PR-only `checks` workflow).

The canonical license is the Ultrastable License v1.0 (USL-1.0), the same text as in ultrastable/workers and ultrastable/spec.
Fails when LICENSE lost the identifier or a core clause, reads proprietary, or required licensing files are missing.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED_FILES = ["LICENSE", "LICENSING.md", "COMMERCIAL-TERMS.md", "NOTICE", "licensing/LICENSE-DECISIONS.md", "specs/README.md"]
REQUIRED_CLAUSES = ["LicenseRef-Ultrastable-USL-1.0", "COMMERCIAL USE REQUIRES A COMMERCIAL LICENSE", "UNLICENSED COMMERCIAL USE",
                    "GOVERNING LAW AND DISPUTES", "THE SPECIFICATION AND IMPLEMENTATIONS", "SOURCE-AVAILABLE, NOT OPEN SOURCE"]
FORBIDDEN = ["Proprietary and confidential", "No licence is granted"]


def check(root=ROOT) -> list[str]:
    root, bad = Path(root), []
    for rel in REQUIRED_FILES:
        if not (root / rel).is_file():
            bad.append(f"missing: {rel}")
    lic = (root / "LICENSE").read_text(encoding="utf-8") if (root / "LICENSE").is_file() else ""
    bad += [f"LICENSE lacks: {c}" for c in REQUIRED_CLAUSES if c not in lic]
    bad += [f"LICENSE still says: {f}" for f in FORBIDDEN if f.lower() in lic.lower()]
    return bad


if __name__ == "__main__":
    problems = check()
    for p in problems:
        print("FAIL:", p)
    print("OK: license files consistent" if not problems else f"{len(problems)} problems")
    sys.exit(1 if problems else 0)

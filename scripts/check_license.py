#!/usr/bin/env python3
"""License, specs and repo-split consistency (runs in the existing PR-only `checks` workflow).

Fails when: LICENSE lost a required clause or reads proprietary; a licensing file is missing; specs/README.md and the spec
files disagree; repo-split.json leaves a tracked file unassigned; or the split declares `reviewed` without counsel sign-off
and an entity name.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import split_repos  # noqa: E402

REQUIRED_FILES = ["LICENSE", "LICENSING.md", "COMMERCIAL-LICENSING.md", "NOTICE", "docs/legal/LICENSE-REVIEW.md", "specs/README.md", "repo-split.json"]
REQUIRED_CLAUSES = [
    "ULTRASTABLE HYBRID LICENSE", "LicenseRef-Ultrastable-Hybrid-0.9", "NOT legal advice",
    "COMMERCIAL USE REQUIRES A COMMERCIAL LICENSE", "Revenue", "Network Use", "Specifications",
    "GOVERNING LAW AND DISPUTES", "LIMITATION OF LIABILITY", "UNLICENSED COMMERCIAL USE",
]
FORBIDDEN_IN_LICENSE = [r"Proprietary and confidential", r"No licence is granted"]


def check(root=ROOT, files=None) -> list[str]:
    root, bad = Path(root), []
    for rel in REQUIRED_FILES:
        if not (root / rel).is_file():
            bad.append(f"missing: {rel}")
    lic = (root / "LICENSE").read_text(encoding="utf-8") if (root / "LICENSE").is_file() else ""
    for c in REQUIRED_CLAUSES:
        if c.lower() not in lic.lower():
            bad.append(f"LICENSE lacks: {c}")
    for f in FORBIDDEN_IN_LICENSE:
        if re.search(f, lic, re.I):
            bad.append(f"LICENSE still says: {f}")
    specs = sorted(p.name for p in (root / "specs").glob("[0-9][0-9]-*.md"))
    idx = (root / "specs/README.md").read_text(encoding="utf-8") if (root / "specs/README.md").is_file() else ""
    for s in specs:
        if f"({s})" not in idx:
            bad.append(f"specs/README.md does not list {s}")
    for n in re.findall(r"\]\((\d\d-[^)]+\.md)\)", idx):
        if n not in specs:
            bad.append(f"specs/README.md lists missing {n}")
    bad += split_repos.check(root, files)
    if (root / "repo-split.json").is_file():
        m = json.loads((root / "repo-split.json").read_text(encoding="utf-8"))
        if m.get("state") not in ("private-until-reviewed", "reviewed"):
            bad.append("repo-split.json state must be private-until-reviewed or reviewed")
        if m.get("state") == "reviewed":
            rev = (root / "docs/legal/LICENSE-REVIEW.md").read_text(encoding="utf-8")
            if not re.search(r"COUNSEL SIGN-OFF: \d{4}-\d{2}-\d{2}", rev):
                bad.append("state reviewed without 'COUNSEL SIGN-OFF: <date>' in docs/legal/LICENSE-REVIEW.md")
            if "[OWNER STEP: entity name" in lic:
                bad.append("state reviewed without an entity name in LICENSE")
    return bad


if __name__ == "__main__":
    problems = check()
    for p in problems:
        print("FAIL:", p)
    print("OK: license, specs and repo split are consistent" if not problems else f"{len(problems)} problems")
    sys.exit(1 if problems else 0)

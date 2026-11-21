# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DEPROT-1: dependency rot is watched by a bot, and the watch must cover every manifest. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation deprot --check   every package.json and pyproject.toml directory, and the workflows, has a Dependabot entry for its ecosystem

Dependabot opens the update pull requests on its own schedule; the lane merges a green one (no person). This check is the detector: a manifest added
without an entry is a failure (failure mode fm-dependency-rot, detector `dependency-watch`, yearfail month `dependency-rot`).
Consumers: doctrine/detectors.json, foundation/yearfail.py, tests/foundation/test_deprot.py."""
from __future__ import annotations
import re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ECO = {"package.json": "npm", "pyproject.toml": "pip"}
SKIP = {"node_modules", ".git", "kit", "artifacts", ".selfhost"}


def manifests(root: Path) -> set[tuple[str, str]]:
    out = set()
    for name, eco in ECO.items():
        for p in root.rglob(name):
            if not SKIP & set(p.relative_to(root).parts):
                d = "/" + p.parent.relative_to(root).as_posix()
                out.add((eco, "/" if d == "/." else d))
    if (root / ".github/workflows").is_dir():
        out.add(("github-actions", "/"))
    return out


def covered(root: Path) -> set[tuple[str, str]]:
    p = root / ".github/dependabot.yml"
    if not p.exists():
        return set()
    got, eco = set(), None
    for line in p.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*-\s*package-ecosystem:\s*(\S+)", line)
        if m:
            eco = m.group(1)
        m = re.match(r"\s*directory:\s*(\S+)", line)
        if m and eco:
            got.add((eco, m.group(1).strip("\"'")))
    return got


def check(root=REPO) -> list[str]:
    root = Path(root)
    return [f"no Dependabot entry for {e} at {d}" for e, d in sorted(manifests(root) - covered(root))]


def main(argv=None) -> int:
    bad = check()
    print("\n".join(bad) or "deprot ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

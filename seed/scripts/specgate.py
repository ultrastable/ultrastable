# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPEC-GATE-1: a work item an agent cannot misread. Ultrastable is the foundation for any autonomous system.

  python3 scripts/specgate.py [--check | --report]   (platform: python3 -m foundation specgate; every seeded system carries this file)

The unlearn.dev lessons (specs an agent can't misread, explicit out-of-scope lines, proof over plausibility, measure instead of
"seems fine") as an intake rule. An open item in docs/issues passes when its body carries all four:
  done       a machine-checkable done check   (**Done check:** cmd:... or GET https://...)
  predict    the metric it moves, as a prediction  (<metric> <op> <number> within <N> h)
  scope      an out-of-scope line              (**Out of scope:** ...)
  proof      a live proof step                 (**Closing probe:** naming a command or a live URL)
`--check` fails on an open item that misses any part, unless its id is in the shrink-only baseline in doctrine/specgate.json.
`quality()` is the share of open items that pass; the second loop reads it as essential variable spec_quality.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path.cwd()
CONF = "doctrine/specgate.json"
PARTS = {
    "done": r"\*\*Done check:\*\*\s*(cmd:|GET https?://)\S",
    "predict": r"[a-z_.]+\s*(>=|<=|==|>|<)\s*-?\d+(\.\d+)?\s+within\s+\d+\s*h",
    "scope": r"\*\*Out of scope:\*\*\s*\S",
    "proof": r"\*\*Closing probe:\*\*\s*`?(python3 |node |GET https?://|cmd:)",
}


def missing(body: str) -> list[str]:
    return [k for k, p in PARTS.items() if not re.search(p, body or "")]


def _open(root):
    for f in sorted((Path(root) / "docs/issues").glob("*.json")):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(j, dict):
            continue
        b = j.get("body", "")
        st = re.search(r"\*\*Status:\*\*\s*([A-Za-z-]+)", b)
        if st and st.group(1).lower() != "open":
            continue
        yield j.get("id", f.stem), b


def report(root=REPO) -> dict:
    rows = {iid: missing(b) for iid, b in _open(root)}
    ok = [i for i, m in rows.items() if not m]
    return {"open": len(rows), "passing": len(ok), "quality": round(len(ok) / len(rows), 3) if rows else 1.0,
            "failing": {i: m for i, m in rows.items() if m}}


def quality(root=REPO):
    return report(root)["quality"]


def added(root, base="origin/main"):
    """Item ids this change adds, from git. None when git cannot say (no base ref): then every open item is judged."""
    import subprocess
    r = subprocess.run(["git", "-C", str(root), "diff", "--name-only", "--diff-filter=A", f"{base}...HEAD", "--", "docs/issues"], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return {Path(x).stem for x in r.stdout.split()}


def check(root=REPO) -> list[str]:
    """A change may not add an item an agent can misread. Items the running loops file on main are judged by the essential variable
    spec_quality instead, whose ladder fixes the filer; failing every pull request for them would stop the line on a measurement."""
    c = Path(root) / CONF  # a new system starts with no baseline: every item must pass from day one
    base = set(json.loads(c.read_text(encoding="utf-8"))["baseline"]) if c.is_file() else set()
    new = added(root)
    return [f"{i}: missing {', '.join(m)} (SPEC-GATE-1)" for i, m in report(root)["failing"].items()
            if i not in base and (new is None or i in new)]


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "specgate ok: every new open item has a done check, a prediction, an out-of-scope line and a live proof"); return 1 if e else 0
    print(json.dumps(report(), indent=1)); return 0


if __name__ == "__main__":
    sys.exit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""REPO-MAP-1 (Good Regulator, Conant and Ashby 1970): an agent should not re-read the repository to learn its shape.

  python3 -m foundation repomap --map [--budget TOKENS] [--focus PATH ...]   print the ranked map within the token budget
  python3 -m foundation repomap --card PATH                                  print one file's card (symbols, imports, sha)
  python3 -m foundation repomap --check                                      the map rebuilds, two builds are byte-identical, cards match files

The engine is foundation/regulator (CODE-REGULATOR-1): a content-addressed SQLite model that re-parses only changed files, reads Python
and JS/TS, and ranks by personalised PageRank. This module is the command front for it and keeps its cache in .cache/repomap.sqlite, never
committed. The live filesystem stays authoritative: every card carries its source sha.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import hashlib, sys
from pathlib import Path

from .regulator import RepoModel, Store

REPO = Path(__file__).resolve().parents[1]
CACHE = ".cache/repomap.sqlite"
TREES = ("foundation", "seed/scripts", "seed/worker/src", "workers/core")


def keep(rel: str, trees=TREES) -> bool:
    """Source under the map trees; tests are found through impact, not shown in the map."""
    parts = rel.split("/")
    return any(rel.startswith(t + "/") for t in trees) and not any(x in ("test", "tests") for x in parts)


def model(root=REPO, db=None, trees=TREES) -> RepoModel:
    """A model over the given top-level trees of the repository (tests and fixtures excluded), refreshed by diff."""
    root = Path(root)
    if db is None:
        (root / CACHE).parent.mkdir(parents=True, exist_ok=True)
        db = str(root / CACHE)
    m = RepoModel(Store(db), str(root))
    walk = m._walk
    m._walk = lambda: ((r, f) for r, f in walk() if keep(r, trees))
    m.update()
    return m


def stable(root=REPO, budget=1024) -> bool:
    a, b = model(root, ":memory:"), model(root, ":memory:")
    return a.render_map(budget_tokens=budget) == b.render_map(budget_tokens=budget)


def check(root=REPO) -> list[str]:
    m = model(root)
    errs = []
    if not m.files():
        errs.append("no modules found under the map trees")
    for r in m.files():
        if hashlib.sha256((Path(root) / r["path"]).read_bytes()).hexdigest() != r["sha"]:
            errs.append(f"{r['path']}: card sha does not match the file")
    if not stable(root):
        errs.append("map is not byte-stable: two builds of the same tree differ (P11)")
    return errs


def _arg(argv, flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


def main(argv) -> int:
    if "--check" in argv:
        errs = check()
        for e in errs:
            print(f"repomap: {e}")
        print(f"repomap {'ok' if not errs else 'FAILED'}")
        return 1 if errs else 0
    if "--card" in argv:
        p = _arg(argv, "--card")
        rows = {r["path"]: r for r in model().files()}
        if p not in rows:
            print(f"repomap: no card for {p}"); return 1
        r = rows[p]
        print(f"{p} [{r['sha'][:8]}]\n  symbols: {r['symbols'].replace(chr(10), ', ')}\n  imports: {r['imports'].replace(chr(10), ', ')}"); return 0
    if "--map" in argv:
        focus = [a for a in argv[argv.index("--focus") + 1:] if not a.startswith("--")] if "--focus" in argv else []
        print(model().render_map(focus, int(_arg(argv, "--budget", 1024)))); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

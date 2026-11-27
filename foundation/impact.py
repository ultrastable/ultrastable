# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""IMPACT-TESTS-1 (feedforward): from a diff, name the tests it can break and run those first.

  python3 -m foundation impact --range BASE...HEAD [--run]   list (or run) the affected test files; the full suite stays the backstop
  python3 -m foundation impact --files F [F ...] [--run]     the same for an explicit file list (an uncommitted change)

The reasoning is foundation/regulator's affected_tests over its import graph (Python and JS/TS): a changed module affects every test
that imports it, directly or through another module. A changed test affects itself. A change to anything outside the graph (a JSON
register, a workflow, a new file) cannot be scoped, so it returns ALL and --run runs the whole suite: missing a dynamic dependency is
worse than spending the minutes. The full suite runs on main anyway, so a miss shows up there as an escaped defect.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path

from .regulator import RepoModel, Store, affected_tests

REPO = Path(__file__).resolve().parents[1]
ROOTS = ("foundation", "tests/foundation", "seed/worker", "seed/scripts", "workers/core")


def _model(root) -> RepoModel:
    m = RepoModel(Store(":memory:"), str(root))
    walk = m._walk
    m._walk = lambda: ((r, f) for r, f in walk() if any(r.startswith(t + "/") for t in ROOTS))
    m.update()
    return m


def affected(changed: list[str], root=REPO) -> list[str] | str:
    """Sorted test files, or 'ALL' when a change is outside what the import graph can scope."""
    m = _model(root)
    known = {r["path"] for r in m.files()}
    if any(f not in known for f in changed):
        return "ALL"
    tests, _ = affected_tests(m, changed)
    return tests


def changed_files(rng: str, root=REPO) -> list[str]:
    r = subprocess.run(["git", "-C", str(root), "diff", "--name-only", rng], capture_output=True, text=True)
    return [f for f in r.stdout.splitlines() if f]


def run(tests, root=REPO) -> int:
    root = Path(root)
    if tests == "ALL":
        a = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests/foundation"], cwd=root).returncode
        return a or subprocess.run(["node", "--test"], cwd=root / "seed/worker").returncode
    py = [t[len("tests/foundation/"):-3] for t in tests if t.startswith("tests/foundation/") and t.endswith(".py")]
    js = [t[len("seed/worker/"):] for t in tests if t.startswith("seed/worker/") and t.endswith(".js")]
    rc = 0
    if py:
        rc |= subprocess.run([sys.executable, "-m", "unittest", *py], cwd=root / "tests/foundation", env={**os.environ, "PYTHONPATH": str(root)}).returncode
    if js:
        rc |= subprocess.run(["node", "--test", *js], cwd=root / "seed/worker").returncode
    return rc


def main(argv) -> int:
    if "--range" in argv:
        files = changed_files(argv[argv.index("--range") + 1])
    elif "--files" in argv:
        files = [a for a in argv[argv.index("--files") + 1:] if not a.startswith("--")]
    else:
        print(__doc__); return 2
    tests = affected(files)
    print("impact: ALL (a change the import graph cannot scope)" if tests == "ALL" else f"impact: {len(tests)} test file(s)")
    if tests != "ALL":
        for t in tests:
            print(t)
    return run(tests) if "--run" in argv else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

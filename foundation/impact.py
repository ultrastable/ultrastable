# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""IMPACT-TESTS-1 (feedforward): from a diff, name the tests it can break and run those first.

  python3 -m foundation impact --range BASE...HEAD [--run]   list (or run) the affected test files; the full suite stays the backstop
  python3 -m foundation impact --files F [F ...] [--run]     the same for an explicit file list (an uncommitted change)

A changed module affects every test that imports it, and every test that imports a module that imports it (transitively, through
the REPO-MAP-1 import edges). A changed test affects itself. A change to anything the graph cannot see (a JSON register, a
workflow, a fixture) cannot be scoped, so it returns ALL and --run runs the whole suite: missing a dynamic dependency is worse than
spending the minutes. Nightly and on main the full suite runs anyway, so a miss here shows up there as an escaped defect.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import subprocess, sys
from pathlib import Path

from . import repomap

REPO = Path(__file__).resolve().parents[1]
PY_TESTS = ("tests/foundation", "test_*.py")
JS_TESTS = ("seed/worker/test", "*.test.js")
SCOPED = (".py", ".js", ".mjs")


def _tests(root: Path) -> dict[str, dict]:
    out = {}
    for base, pat in (PY_TESTS, JS_TESTS):
        d = root / base
        if d.is_dir():
            for p in sorted(d.glob(pat)):
                rel = p.relative_to(root).as_posix()
                out[rel] = repomap.card(rel, p.read_text(errors="replace"))
    return out


def _py_test_imports(card: dict, text: str) -> set[str]:
    import re
    mods = set()
    for m in re.finditer(r"from foundation import ([\w ,]+)|from foundation\.(\w+)|import foundation\.(\w+)", text):
        if m.group(1):
            mods |= {f"foundation/{n.split(' as ')[0].strip()}.py" for n in m.group(1).split(",") if n.strip()}
        else:
            mods.add(f"foundation/{m.group(2) or m.group(3)}.py")
    return mods | set(card["imports"])


def affected(changed: list[str], root=REPO) -> list[str] | str:
    """Sorted test files, or 'ALL' when a change is outside what the import graph can scope."""
    cards, _ = repomap.build(root)
    tests = _tests(root)
    if any(not f.endswith(SCOPED) for f in changed):
        return "ALL"
    rdeps: dict[str, set[str]] = {}
    for p, c in cards.items():
        for i in c["imports"]:
            rdeps.setdefault(i, set()).add(p)
    reach, todo = set(), [f for f in changed if f in cards]
    while todo:
        f = todo.pop()
        if f not in reach:
            reach.add(f); todo += list(rdeps.get(f, ()))
    out = {f for f in changed if f in tests}
    for t, c in tests.items():
        text = (root / t).read_text(errors="replace")
        deps = _py_test_imports(c, text) if t.endswith(".py") else set(c["imports"])
        if deps & reach:
            out.add(t)
    unknown = [f for f in changed if f not in cards and f not in tests]
    return "ALL" if unknown else sorted(out)


def changed_files(rng: str, root=REPO) -> list[str]:
    r = subprocess.run(["git", "-C", str(root), "diff", "--name-only", rng], capture_output=True, text=True)
    return [f for f in r.stdout.splitlines() if f]


def run(tests, root=REPO) -> int:
    if tests == "ALL":
        a = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests/foundation"], cwd=root).returncode
        return a or subprocess.run(["node", "--test"], cwd=root / "seed/worker").returncode
    py = [t[len("tests/foundation/"):-3] for t in tests if t.endswith(".py")]
    js = [t[len("seed/worker/"):] for t in tests if t.endswith(".js")]
    rc = 0
    if py:
        rc |= subprocess.run([sys.executable, "-m", "unittest", *py], cwd=root / "tests/foundation",
                             env={**__import__("os").environ, "PYTHONPATH": str(root)}).returncode
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

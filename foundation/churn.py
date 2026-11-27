# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""CHURN-GUARD-1 (ZHC-R13, #2678): an executor PR may not simply undo what main merged in the last day.

  python3 -m foundation churn --gate --range BASE...HEAD [--executor]   exit 3 when every file the change touches goes back to
                                                                         the exact content it had before a main commit of the last WINDOW_H hours

A loop that merges X and then merges "not X" burns the free tier and reports two changes where there was none. A red main is repaired by
foundation/redmain.py, which is not an executor PR, so --executor limits the gate to PRs whose body says "Executor run" (the same marker the
SUBSTANCE-1 gate reads). A change that undoes only some of its files, or undoes something older than the window, passes.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WINDOW_H = 24
MARK = "Executor run"


def _git(root, *a) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)


def _blob(root, rev, path):
    r = _git(root, "rev-parse", "--verify", "-q", f"{rev}:{path}")
    return r.stdout.strip() if r.returncode == 0 else None  # None: the file did not exist there


def reverts(rng: str, root=REPO, hours=WINDOW_H) -> tuple[list[str], list[str]]:
    """(files the change returns to a pre-commit state of the window, files it changes otherwise)."""
    base, head = rng.split("...") if "..." in rng else rng.split("..")
    mb = _git(root, "merge-base", base, head).stdout.strip() or base
    files = [f for f in _git(root, "diff", "--name-only", f"{mb}..{head}").stdout.splitlines() if f]
    back, other = [], []
    for f in files:
        now = _blob(root, head, f)
        recent = _git(root, "log", f"--since={hours} hours ago", "--format=%H", mb, "--", f).stdout.split()
        (back if any(_blob(root, f"{c}^", f) == now for c in recent) else other).append(f)
    return back, other


def gate(rng: str, root=REPO, executor=False, body=None) -> tuple[bool, str]:
    body = os.environ.get("PR_BODY", "") if body is None else body
    if executor and MARK not in body:
        return True, "not an executor PR"
    back, other = reverts(rng, root)
    if back and not other:
        return False, f"undoes main's last {WINDOW_H} h on every file it touches ({', '.join(back[:5])}); fix forward or let redmain repair"
    return True, f"{len(back)} file(s) restored, {len(other)} changed forward"


def main(argv) -> int:
    if "--gate" in argv and "--range" in argv:
        ok, why = gate(argv[argv.index("--range") + 1], executor="--executor" in argv)
        print(f"churn {'ok' if ok else 'REFUSED'}: {why}"); return 0 if ok else 3
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

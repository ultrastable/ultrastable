# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""CHURN-GUARD-1: an executor PR that only undoes main's last day is refused; a partial undo, a fix forward or a non-executor PR passes."""
import subprocess, unittest

from _repo import scratch
from foundation import churn as C


def git(d, *a):
    return subprocess.run(["git", "-C", str(d), *a], check=True, capture_output=True, text=True).stdout.strip()


def repo():
    d = scratch(); git(d, "init", "-q", "-b", "main"); git(d, "config", "user.email", "t@t"); git(d, "config", "user.name", "t")
    (d / "a.py").write_text("x = 1\n"); (d / "b.py").write_text("y = 1\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "base")
    (d / "a.py").write_text("x = 2\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "merge X")
    git(d, "checkout", "-qb", "pr"); return d


def commit(d, files):
    for k, v in files.items():
        (d / k).write_text(v)
    git(d, "add", "-A"); git(d, "commit", "-qm", "pr")


class Churn(unittest.TestCase):
    def test_pure_undo_is_refused(self):
        d = repo(); commit(d, {"a.py": "x = 1\n"})
        self.assertFalse(C.gate("main...pr", d, executor=True, body="Executor run 9")[0])

    def test_undo_plus_forward_change_passes(self):
        d = repo(); commit(d, {"a.py": "x = 1\n", "b.py": "y = 2\n"})
        self.assertTrue(C.gate("main...pr", d, executor=True, body="Executor run 9")[0])

    def test_fix_forward_passes(self):
        d = repo(); commit(d, {"a.py": "x = 3\n"})
        self.assertTrue(C.gate("main...pr", d, executor=True, body="Executor run 9")[0])

    def test_non_executor_pr_is_not_gated(self):
        d = repo(); commit(d, {"a.py": "x = 1\n"})
        self.assertTrue(C.gate("main...pr", d, executor=True, body="redmain repair")[0])

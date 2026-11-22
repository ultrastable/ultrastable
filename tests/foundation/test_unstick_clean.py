# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""UNSTICK-CLEAN-1: a dirty tree left by one PR must not break the next PR's reconcile."""
import subprocess, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/unstick_prs.sh"


def git(d, *a):
    return subprocess.run(["git", "-C", str(d), *a], check=True, capture_output=True, text=True).stdout


class Clean(unittest.TestCase):
    def test_cleanup_line_restores_a_dirty_tree(self):
        line = next(l for l in SCRIPT.read_text().splitlines() if "git reset -q --hard; git clean -fdq" in l)
        with tempfile.TemporaryDirectory() as d:
            git(d, "init", "-q", "-b", "main"); git(d, "config", "user.email", "t@t"); git(d, "config", "user.name", "t")
            (Path(d) / "README.md").write_text("a\n"); git(d, "add", "."); git(d, "commit", "-qm", "a")
            (Path(d) / "README.md").write_text("half-resolved\n"); (Path(d) / "stray.txt").write_text("x")
            subprocess.run(["bash", "-c", line.strip()], cwd=d, check=True, capture_output=True)
            self.assertEqual(git(d, "status", "--porcelain"), "")


if __name__ == "__main__":
    unittest.main()

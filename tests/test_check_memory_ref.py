# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""MEMORY-REF-1: memory staleness fails main only; a PR branch checked by the lane's workflow_dispatch gets a warning, like a pull_request run."""
import os, subprocess, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(env):
    e = {k: v for k, v in os.environ.items() if k not in ("GITHUB_EVENT_NAME", "GITHUB_REF")}
    e.update(env)
    src = (ROOT / "scripts/check_memory.py").read_text(encoding="utf-8").replace("MAX_COMMITS = 15", "MAX_COMMITS = -1")
    return subprocess.run([sys.executable, "-c", src], cwd=ROOT, env=e, capture_output=True, text=True)


class MemoryRef(unittest.TestCase):
    def test_lane_dispatch_on_a_pr_branch_warns(self):
        r = run({"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/agent/branchsweep-20261119"})
        if "OK: memory is current" in r.stdout:
            self.skipTest("no commit after the last memory update in this checkout")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertIn("::warning::", r.stdout)

    def test_main_still_fails_when_stale(self):
        r = run({"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main"})
        if "OK: memory is current" in r.stdout:
            self.skipTest("no commit after the last memory update in this checkout")
        self.assertEqual(r.returncode, 1, r.stdout); self.assertIn("FAIL", r.stdout)


if __name__ == "__main__":
    unittest.main()

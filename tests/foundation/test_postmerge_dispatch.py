# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""POSTMERGE-DISPATCH-1: a GITHUB_TOKEN merge fires no push workflow; the lane dispatches each one the merge's files trigger, once."""
import sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import postmerge_dispatch as pm  # noqa: E402


class PostMerge(unittest.TestCase):
    def test_globs_follow_github_semantics(self):
        self.assertTrue(pm.matches(["seed/worker/src/a.js"], ["seed/worker/**"]))
        self.assertTrue(pm.matches(["instances/x/worker/y.js"], ["instances/*/worker/**"]))
        self.assertFalse(pm.matches(["instances/x/y/worker/z.js"], ["instances/*/worker/**"]))
        self.assertFalse(pm.matches(["site/a.md"], ["site/**", "!site/*.md"]))

    def test_dispatches_once_and_skips_a_workflow_that_already_ran(self):
        trig = {"seed-launch.yml": ["foundation/bootaccept.py"], "deploy.yml": ["seed/worker/**"], "other.yml": ["docs/**"]}
        merged = [{"number": 1, "merged_at": "2026-11-25T21:00:00Z", "files": ["foundation/bootaccept.py", "seed/worker/src/v.js"]},
                  {"number": 2, "merged_at": "2026-11-25T21:10:00Z", "files": ["seed/worker/src/w.js"]}]
        ran = {"deploy.yml"}
        self.assertEqual(pm.plan(merged, trig, lambda wf, iso: int(wf in ran)), [(1, "seed-launch.yml")])
        self.assertEqual(pm.plan(merged, trig, lambda wf, iso: 0), [(1, "seed-launch.yml"), (1, "deploy.yml")])

    def test_reads_the_triggers_from_the_workflows_themselves(self):
        t = pm.triggers(ROOT)
        self.assertIn("foundation/bootaccept.py", t["seed-launch.yml"])
        self.assertIn("deploy-workers.yml", t)
        d = Path(tempfile.mkdtemp()); self.addCleanup(__import__("shutil").rmtree, d)
        (d / ".github/workflows").mkdir(parents=True)
        (d / ".github/workflows/a.yml").write_text("on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n")
        (d / ".github/workflows/b.yml").write_text("on:\n  push:\n    branches: [main]\n")  # cannot be dispatched
        self.assertEqual(pm.triggers(d), {"a.yml": ["**"]})

    def test_the_lane_runs_it_after_every_pass(self):
        self.assertIn("scripts/postmerge_dispatch.py --apply", (ROOT / ".github/workflows/lane.yml").read_text())


if __name__ == "__main__":
    unittest.main()

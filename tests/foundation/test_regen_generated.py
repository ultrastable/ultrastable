# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REGEN-GENERATED-1: every generator is registered, the workflow ignores only generated outputs, and a failing generator fails the run."""
import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import regen_generated as rg  # noqa: E402


class Regen(unittest.TestCase):
    def test_workflow_ignores_exactly_the_outputs(self):
        wf = (ROOT / ".github/workflows/regen-generated.yml").read_text()
        for o in rg.OUTPUTS:
            self.assertIn(f'"{o}"', wf)

    def test_outputs_exist(self):
        for o in rg.OUTPUTS:
            self.assertTrue((ROOT / o).exists(), o)

    def test_every_generator_runs_at_pr_time_or_is_post_merge_only_with_a_reason(self):
        """REGEN-PARITY-1: a pull request carries no generated file, so a generator its checks depend on must run in the job's workspace.
        #2615 added an essential variable and failed on a stale site/ultrastability-data.js, because the PR-time list did not rebuild it."""
        sh = (ROOT / "scripts/regen_generated.sh").read_text()
        every = {" ".join(c) for c, _ in rg.GENERATORS}
        self.assertTrue(set(rg.POST_MERGE_ONLY) <= every, "a post-merge-only entry names a generator that exists")
        self.assertTrue(all(len(why) > 20 for why in rg.POST_MERGE_ONLY.values()), "each one says why it cannot run in a check")
        for g in rg.pr_generators():
            self.assertIn(f'"{g}"', sh, f"{g} is neither run by scripts/regen_generated.sh nor listed post-merge-only")
        self.assertEqual(len(rg.pr_generators()) + len(rg.POST_MERGE_ONLY), len(rg.GENERATORS))
        self.assertIn("python3 -m foundation ultrastability --data --apply", rg.pr_generators())
        self.assertNotIn("python3 -m foundation decisions --settle --apply", rg.pr_generators(), "a generator that writes a ledger never runs in a check")

    def test_failure_is_reported(self):
        orig = rg.GENERATORS
        rg.GENERATORS = [(["python3", "-c", "import sys; sys.exit(3)"], ".")]
        try:
            self.assertEqual(len(rg.run_all(ROOT)), 1)
        finally:
            rg.GENERATORS = orig

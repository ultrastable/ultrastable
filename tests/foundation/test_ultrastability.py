# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import ultrastability as u

REPO = Path(__file__).resolve().parents[2]
BAD = {"criticality.cost": 3.0, "criticality.verified_share": 1.0, "claims.drift": 0, "criticality.k": 2.0}
GOOD = {**BAD, "criticality.cost": 0.5}


class T(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        (self.d / "doctrine").mkdir()
        (self.d / "docs/issues").mkdir(parents=True)
        for f in ("doctrine/ultrastability.json", "doctrine/clocks.json"):
            shutil.copy(REPO / f, self.d / f)
        (self.d / "ops").mkdir()

    def runs(self):
        return json.loads((self.d / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"]

    def test_repo_check(self):
        self.assertEqual(u.check(REPO), [])

    def test_bounds(self):
        v = {"min": 0, "max": 1.0}
        self.assertTrue(u.in_bounds(v, 1.0)); self.assertFalse(u.in_bounds(v, 1.01)); self.assertFalse(u.in_bounds(v, None))

    def test_patience_then_step_then_kept(self):
        before = self.runs()
        u.tick(self.d, True, read=BAD)
        self.assertEqual(self.runs(), before)  # one reading out is a disturbance for the first-order loop, not a second-order event
        r = u.tick(self.d, True, read=BAD)
        self.assertEqual([s["var"] for s in r["steps"]], ["spend"])
        self.assertEqual(self.runs(), before - 1)
        r = u.tick(self.d, True, read=GOOD)
        self.assertEqual(r["verdicts"][0]["verdict"], "kept")
        self.assertEqual(self.runs(), before - 1)

    def test_unsettled_step_is_reverted_then_next_step(self):
        before = self.runs()
        for _ in range(2):
            u.tick(self.d, True, read=BAD)
        verdicts, steps = [], []
        for _ in range(3):
            r = u.tick(self.d, True, read=BAD)
            verdicts += r["verdicts"]; steps += r["steps"]
        self.assertEqual(verdicts[0]["verdict"], "reverted")
        self.assertEqual(self.runs(), before)  # the failed parameter step was undone
        self.assertEqual(steps[0]["kind"], "item")  # and the next rung, a restructure, is taken in the same tick
        self.assertTrue((self.d / "docs/issues/Q-ULTRA-spend-2.json").is_file())
        r = u.tick(self.d, True, read=BAD)
        for _ in range(4):
            r = u.tick(self.d, True, read=BAD)
        self.assertIn("exhausted", r["variables"]["spend"])  # ladder spent: redesign item
        self.assertTrue((self.d / "docs/issues/Q-ULTRA-spend-REDESIGN.json").is_file())

    def test_dry_run_writes_nothing(self):
        u.tick(self.d, False, read=BAD); u.tick(self.d, False, read=BAD)
        self.assertFalse((self.d / "ops/ultrastability.jsonl").exists())


if __name__ == "__main__":
    unittest.main()

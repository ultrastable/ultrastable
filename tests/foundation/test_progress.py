# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PROGRESS-1: the systems list, the cadence step and the public routes stay wired, and the live reading fails on a stall."""
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import progress

ROOT = Path(__file__).resolve().parents[2]


class Progress(unittest.TestCase):
    def test_repo_clean(self):
        self.assertEqual(progress.check(ROOT), [])

    def test_a_system_without_a_repair_or_with_a_longer_than_weekly_cadence_fails(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            for rel in list(progress.WIRED) + [progress.CONFIG, ".github/workflows/executor.yml", ".github/workflows/product-manager.yml"]:
                (t / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(ROOT / rel, t / rel)
            self.assertEqual(progress.check(t), [])
            cfg = json.loads((t / progress.CONFIG).read_text())
            cfg["systems"][0]["heal"] = []
            cfg["systems"][1]["expect_hours"] = 400
            (t / progress.CONFIG).write_text(json.dumps(cfg))
            bad = progress.check(t)
            self.assertTrue(any("no heal workflow" in b for b in bad))
            self.assertTrue(any("longer than a week" in b for b in bad))
            (t / "site/progress.js").write_text("// gone")
            self.assertTrue(any("site/progress.js: no longer carries" in b for b in progress.check(t)))

    def test_live_reading(self):
        ok = {"systems": [{"id": "a", "state": "moving"}, {"id": "b", "state": "slow"}], "digests": {"weekly": {"substantive": 3}}}
        self.assertEqual(progress.live(fetch=lambda u: ok), [])
        bad = progress.live(fetch=lambda u: {"systems": [{"id": "a", "state": "stalled", "last_at": "x"}], "digests": {"weekly": {"substantive": 0}}})
        self.assertEqual(len(bad), 2)

        def boom(u):
            raise OSError("down")
        self.assertIn("unreadable", progress.live(fetch=boom)[0])


if __name__ == "__main__":
    unittest.main()

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

    def test_apps_launch_cadence(self):
        import datetime as dt
        newest = max(dt.datetime.strptime(json.loads(f.read_text())["launched"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
                     for f in (ROOT / "instances/spinoffs").glob("*/app.json"))  # relative to the registry, so the test never expires
        self.assertEqual(progress.apps(ROOT, now=newest + dt.timedelta(days=1)), [])
        late = progress.apps(ROOT, now=newest + dt.timedelta(days=40))
        self.assertEqual(len(late), 1)
        self.assertIn("run dry", late[0])

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

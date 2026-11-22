# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COMPAT-DATE-1: Worker compatibility dates advance by a loop; a stopped loop fails the check."""
import datetime as dt, json, unittest
from pathlib import Path

import _repo
from foundation import compatdate

REPO = Path(__file__).resolve().parents[2]
TODAY = dt.date(2026, 11, 22)


def w(root, rel, s):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s if isinstance(s, str) else json.dumps(s, indent=2) + "\n", encoding="utf-8")


class Loop(unittest.TestCase):
    def setUp(self):
        self.root = _repo.scratch()
        w(self.root, compatdate.RULES, json.loads((REPO / compatdate.RULES).read_text(encoding="utf-8")))
        w(self.root, "doctrine/topology.json", {"system_compatibility_date": "2026-01-01",
                                                 "workers": [{"id": "old", "compatibility_date": "2025-06-01"}, {"id": "new", "compatibility_date": "2026-11-01"}]})
        w(self.root, "a/wrangler.toml", 'name = "a"\ncompatibility_date = "2024-01-01"\n')

    def test_stale_dates_fail_check_then_move_and_recent_ones_stay(self):
        self.assertEqual(len(compatdate.check(self.root, TODAY)), 3)
        r = compatdate.run(self.root, apply=True, today=TODAY)
        self.assertEqual(r["target"], "2026-10-23"); self.assertEqual(len(r["moved"]), 3)
        t = json.loads((self.root / "doctrine/topology.json").read_text(encoding="utf-8"))
        self.assertEqual(t["system_compatibility_date"], "2026-10-23")
        self.assertEqual([x["compatibility_date"] for x in t["workers"]], ["2026-10-23", "2026-11-01"])
        self.assertIn('compatibility_date = "2026-10-23"', (self.root / "a/wrangler.toml").read_text(encoding="utf-8"))
        self.assertEqual(compatdate.check(self.root, TODAY), [])

    def test_idempotent_and_steps_at_most_monthly(self):
        compatdate.run(self.root, apply=True, today=TODAY)
        self.assertFalse(compatdate.run(self.root, apply=True, today=TODAY + dt.timedelta(days=20))["changed"])
        self.assertTrue(compatdate.run(self.root, apply=True, today=TODAY + dt.timedelta(days=28))["changed"])

    def test_dry_run_writes_nothing(self):
        before = (self.root / "a/wrangler.toml").read_text(encoding="utf-8")
        self.assertFalse(compatdate.run(self.root, apply=False, today=TODAY)["changed"])
        self.assertEqual((self.root / "a/wrangler.toml").read_text(encoding="utf-8"), before)


class Repo(unittest.TestCase):
    def test_repository_dates_are_fresh(self):
        self.assertEqual(compatdate.check(), [])


if __name__ == "__main__":
    unittest.main()

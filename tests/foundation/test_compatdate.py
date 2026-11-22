# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COMPAT-DATE-1: Worker compatibility dates advance by themselves."""
import datetime as dt, json, tempfile, unittest
from pathlib import Path

from foundation import compatdate

ROOT = Path(__file__).resolve().parents[2]


class CompatDate(unittest.TestCase):
    def test_repository_has_no_stale_date(self):
        self.assertEqual(compatdate.check(ROOT), [])

    def test_an_old_date_is_found_and_advanced_and_a_recent_one_kept(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); (t / "doctrine").mkdir(); (t / "a").mkdir()
            (t / "a/wrangler.toml").write_text('name = "a"\ncompatibility_date = "2024-01-01"\n')
            (t / "doctrine/topology.json").write_text(json.dumps({"system_compatibility_date": "2026-11-12", "workers": [{"id": "w", "compatibility_date": "2025-01-01"}]}, indent=1))
            today = dt.date(2026, 11, 22)
            self.assertEqual(len(compatdate.check(t, today)), 2)
            r = compatdate.run(t, apply=True, today=today)
            self.assertEqual(sorted(r["moved"]), ["a/wrangler.toml", "doctrine/topology.json"])
            self.assertEqual(compatdate.check(t, today), [])
            topo = json.loads((t / "doctrine/topology.json").read_text())
            self.assertEqual(topo["system_compatibility_date"], "2026-11-12")
            self.assertEqual(topo["workers"][0]["compatibility_date"], "2026-11-08")

    def test_a_dry_run_changes_nothing(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); (t / "wrangler.toml").write_text('compatibility_date = "2024-01-01"\n')
            self.assertEqual(compatdate.run(t, apply=False, today=dt.date(2026, 11, 22))["changed"], False)
            self.assertIn("2024-01-01", (t / "wrangler.toml").read_text())


if __name__ == "__main__":
    unittest.main()

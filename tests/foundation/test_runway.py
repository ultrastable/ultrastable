# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RUNWAY-1: the one-year unattended target is measured, an unmeasured component is never ok, and a shortfall files an item."""
import datetime as dt, json, shutil, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import runway  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
TODAY = dt.date(2026, 11, 20)


def tree(d: Path, cost_lines, cred_rows, issues=()):
    for sub in ("doctrine", "ops", "docs/issues"):
        (d / sub).mkdir(parents=True)
    shutil.copy(REPO / "doctrine/runway.json", d / "doctrine/runway.json")
    (d / "doctrine/credwatch.json").write_text(json.dumps({"registrations": [{"name": "domain-a", "auto_renew": True}]}))
    (d / "ops/cost-thresholds.json").write_text(json.dumps({"rows_read_max": 1000, "neurons_max": 100}))
    (d / "ops/cost.jsonl").write_text("".join(json.dumps(x) + "\n" for x in cost_lines))
    (d / "ops/credwatch.json").write_text(json.dumps({"rows": cred_rows}))
    for iid in issues:
        (d / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "body": "**Status:** open\n", "labels": []}))


GOOD_COST = [{"ts": "2026-11-19T00:00:00Z", "d1": [{"name": "x", "rows_read": 100}], "neurons": 5}]
GOOD_CRED = [{"name": "T", "state": "ok", "expires": None}, {"name": "domain-a", "state": "ok", "expires": "2027-01-01"}, {"name": "U", "state": "unbound", "expires": None}]


class Runway(unittest.TestCase):
    def test_meets_target_when_nothing_lapses(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); tree(d, GOOD_COST, GOOD_CRED)
            m = runway.run(d, apply=True, today=TODAY)
            self.assertTrue(m["meets_target"]); self.assertIsNone(m["runway_days"])
            self.assertEqual(list((d / "docs/issues").glob("Q-RUNWAY-*")), [])
            self.assertEqual(runway.probe("cost", d), 0)

    def test_unmeasured_cost_is_never_ok(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); tree(d, GOOD_COST + [{"ts": "2026-11-20T00:00:00Z", "unmeasured": "no credential", "d1": []}], GOOD_CRED)
            m = runway.run(d, apply=True, today=TODAY + dt.timedelta(days=9))
            self.assertEqual(m["below"], ["cost"]); self.assertFalse(m["meets_target"])
            self.assertTrue((d / "docs/issues/Q-RUNWAY-cost.json").exists()); self.assertEqual(runway.probe("cost", d), 1)

    def test_growth_and_expiring_token_shorten_the_runway(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            tree(d, [{"ts": "2026-11-09T00:00:00Z", "d1": [{"name": "x", "rows_read": 100}]}, {"ts": "2026-11-19T00:00:00Z", "d1": [{"name": "x", "rows_read": 500}]}],
                 [{"name": "T", "state": "ok", "expires": "2027-02-28"}])
            m = runway.measure(d, TODAY)
            self.assertEqual(m["components"]["cost"]["days"], 12); self.assertEqual(m["components"]["credentials"]["days"], 100)
            self.assertEqual(m["runway_days"], 12); self.assertEqual(m["below"], ["cost", "credentials"])

    def test_a_failure_nothing_repairs_ends_the_runway(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); tree(d, GOOD_COST, GOOD_CRED, issues=["Q-CIFAIL-x"])
            self.assertTrue(runway.run(d, apply=True, today=TODAY)["meets_target"])
            later = TODAY + dt.timedelta(days=8)
            (d / "ops/cost.jsonl").write_text(json.dumps({"ts": later.isoformat(), "d1": [{"name": "x", "rows_read": 100}]}) + "\n")
            m = runway.run(d, apply=True, today=later)
            self.assertEqual(m["components"]["failures"]["days"], 0); self.assertIn("failures", m["below"])

    def test_target_is_at_least_a_year_and_the_watchdog_measures_it(self):
        self.assertEqual(runway.check(REPO), [])
        self.assertIn("foundation runway --run --apply", (REPO / ".github/workflows/watchdog.yml").read_text())


if __name__ == "__main__":
    unittest.main()

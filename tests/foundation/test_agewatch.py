# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SLA-8H-1: the oldest open issue and PR are measured and anything past 8 hours is overdue; the fleet pass runs the check."""
import sys, unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import agewatch as A  # noqa: E402

NOW = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)


class AgeWatch(unittest.TestCase):
    def test_overdue_rows_and_oldest_ages(self):
        rows = [{"repo": "r", "kind": "pr", "number": 1, "created_at": "2026-11-21T09:00:00Z", "title": "old pr"},
                {"repo": "r", "kind": "issue", "number": 2, "created_at": "2026-11-21T15:00:00Z", "title": "young"}]
        r = A.overdue(rows, NOW)
        self.assertEqual([o["number"] for o in r["overdue"]], [1])
        self.assertEqual((r["oldest_pr_hours"], r["oldest_issue_hours"], r["open_prs"], r["open_issues"]), (9.0, 3.0, 1, 1))

    def test_the_fleet_pass_runs_the_check(self):
        self.assertIn("foundation agewatch --check", (ROOT / ".github/workflows/fleet.yml").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

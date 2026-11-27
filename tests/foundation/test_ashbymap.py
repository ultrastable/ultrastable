# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest

from foundation import ashbymap


class AshbyMap(unittest.TestCase):
    def test_repo_map_holds(self):
        self.assertEqual(ashbymap.check(), [])

    def test_interference_counts_a_step_that_knocks_another_variable_out(self):
        rows = [
            {"at": "2026-11-27T00:00:00Z", "ev": "reading", "var": "b", "ok": True},
            {"at": "2026-11-27T00:01:00Z", "ev": "step", "var": "a"},
            {"at": "2026-11-27T00:10:00Z", "ev": "reading", "var": "b", "ok": False},
            {"at": "2026-11-27T01:00:00Z", "ev": "step", "var": "a"},
            {"at": "2026-11-27T01:10:00Z", "ev": "reading", "var": "b", "ok": True, "unmeasured": True},
        ]
        self.assertEqual(ashbymap.interference(rows), {"steps": 2, "disturbed": 1, "interference_share": 0.5})

    def test_no_steps_is_unmeasured_not_zero(self):
        self.assertIsNone(ashbymap.interference([])["interference_share"])


if __name__ == "__main__":
    unittest.main()

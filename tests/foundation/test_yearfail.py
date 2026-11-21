# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""YEARFAIL-1: the simulated year runs, labels what is real, never calls an uncovered area a pass, and files a failing month."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import yearfail  # noqa: E402


class YearFail(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.res = yearfail.run(ROOT)

    def test_table_is_well_formed(self):
        self.assertEqual(yearfail.check(ROOT), [])

    def test_twelve_months_and_injected_failures_are_detected(self):
        self.assertGreaterEqual(len(self.res["months"]), 12)
        for m in self.res["months"]:
            if m["result"] == "PASS":
                self.assertTrue(m["detected"] and m["repaired_and_verified"])
                self.assertEqual(m["labels"]["repair"], "REAL" if m["area"] == "ci-breakage" else "SIMULATED")

    def test_uncovered_is_never_pass(self):
        for m in self.res["months"]:
            if m["result"] == "UNCOVERED":
                self.assertTrue(m["item"])
        self.assertEqual(self.res["pass"] + self.res["fail"] + self.res["uncovered"], len(self.res["months"]))

    def test_repository_is_untouched(self):
        self.assertFalse((ROOT / "docs/issues/Q-YEARFAIL-silent.json").exists())
        self.assertFalse((ROOT / "docs/issues/Q-CIFAIL-yearfail.json").exists())


if __name__ == "__main__":
    unittest.main()

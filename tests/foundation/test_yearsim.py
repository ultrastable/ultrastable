"""YEARSIM-1: the simulated year runs, labels what is real, never calls an uncovered area a pass, and files a failing month."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import yearsim  # noqa: E402


class YearSim(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.res = yearsim.run(ROOT)

    def test_table_is_well_formed(self):
        self.assertEqual(yearsim.check(ROOT), [])

    def test_twelve_months_and_injected_failures_are_detected(self):
        self.assertEqual(len(self.res["months"]), 12)
        for m in self.res["months"]:
            if m["result"] == "PASS":
                self.assertTrue(m["detected"] and m["repaired_and_verified"])
                self.assertEqual(m["labels"]["repair"], "SIMULATED")

    def test_uncovered_is_never_pass(self):
        for m in self.res["months"]:
            if m["result"] == "UNCOVERED":
                self.assertTrue(m["item"])
        self.assertEqual(self.res["pass"] + self.res["fail"] + self.res["uncovered"], 12)

    def test_repository_is_untouched(self):
        self.assertFalse((ROOT / "docs/issues/Q-YEARSIM-silent.json").exists())
        self.assertFalse((ROOT / "docs/issues/Q-CIFAIL-yearsim.json").exists())


if __name__ == "__main__":
    unittest.main()

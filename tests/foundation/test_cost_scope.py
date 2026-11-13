import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import cost

THR = {"rows_read_max": 500, "neurons_max": 100, "file_prefixes": ["ultrastable-"]}


class CostScope(unittest.TestCase):
    def test_foreign_database_does_not_trip_our_budget(self):
        r = {"d1": [{"name": "qnfo-audit", "rows_read": 9000}, {"name": "ultrastable-ops", "rows_read": 50}], "ai": {"neurons": 10}}
        self.assertEqual(cost.level(r, THR), 0.1)

    def test_our_database_over_budget_is_a_breach(self):
        r = {"d1": [{"name": "ultrastable-ops", "rows_read": 1000}], "ai": {"neurons": 0}}
        self.assertEqual(cost.level(r, THR), 2.0)

    def test_file_foreign_judges_everything(self):
        r = {"d1": [{"name": "qnfo-audit", "rows_read": 1000}], "ai": {"neurons": 0}}
        self.assertEqual(cost.level(r, dict(THR, file_foreign=True)), 2.0)


if __name__ == "__main__":
    unittest.main()

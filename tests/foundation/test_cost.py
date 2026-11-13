"""COST-GUARD-1: the declaration is complete; the cost level is the largest share of budget used."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import cost as C  # noqa: E402

THR = {"rows_read_max": 100, "rows_read_override": {"ultrastable-big": 1000}, "neurons_max": 50, "file_prefixes": ["ultrastable-"]}


class Cost(unittest.TestCase):
    def test_declaration(self):
        self.assertEqual(C.check(), [])

    def test_level(self):
        self.assertEqual(C.level({"d1": [{"name": "ultrastable-a", "rows_read": 250}, {"name": "ultrastable-big", "rows_read": 500}], "ai": {"neurons": 10}}, THR), 2.5)
        self.assertEqual(C.level({"d1": [], "ai": {"neurons": 100}}, THR), 2.0)
        self.assertEqual(C.level({"d1": [{"name": "ultrastable-a", "rows_read": 1}], "ai": {"neurons": 1}}, THR), 0.02)


if __name__ == "__main__":
    unittest.main()

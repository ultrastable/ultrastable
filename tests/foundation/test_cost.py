"""COST-GUARD-1: the declaration is complete and breaches are computed from budgets."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import cost as C  # noqa: E402

AUDIT = "35e2e573-92f3-46ac-83c6-22f6429fc5e5"


class Cost(unittest.TestCase):
    def test_declaration(self):
        self.assertEqual(C.check(), [])

    def test_breach_and_clean(self):
        cfg = C.load()
        bad = C.evaluate(cfg, {AUDIT: {"rows_read": 1_400_000_000, "read_queries": 650000}}, {"m": 900000})
        self.assertEqual({b["metric"] for b in bad}, {"d1_rows_read", "d1_rows_per_read_query", "ai_neurons", "ai_model_share"})
        self.assertEqual(C.evaluate(cfg, {AUDIT: {"rows_read": 10, "read_queries": 10}}, {"m": 10}), [])


if __name__ == "__main__":
    unittest.main()

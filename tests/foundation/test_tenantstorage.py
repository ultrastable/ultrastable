"""TENANT-STORAGE-1: declaration complete; worst case bounded by the ceiling."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import tenantstorage as T  # noqa: E402


class TenantStorage(unittest.TestCase):
    def test_declaration(self):
        self.assertEqual(T.check(), [])

    def test_worst_case_is_bounded(self):
        self.assertEqual(T.worst_case(T.load()), 7.1)

    def test_breach_detected(self):
        c = T.load(); c["default_budget"]["month"]["requests"] = 50_000_000
        self.assertGreater(T.worst_case(c), c["monthly_ceiling_usd"])


if __name__ == "__main__":
    unittest.main()

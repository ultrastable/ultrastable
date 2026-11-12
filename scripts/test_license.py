import unittest
from pathlib import Path
import check_license

ROOT = Path(__file__).resolve().parent.parent


class License(unittest.TestCase):
    def test_consistent(self):
        self.assertEqual(check_license.check(ROOT), [])

    def test_missing_clause_is_reported(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "LICENSE").write_text("Proprietary and confidential")
            self.assertTrue(check_license.check(d))


if __name__ == "__main__":
    unittest.main()

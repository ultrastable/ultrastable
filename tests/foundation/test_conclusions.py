# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import tempfile, unittest
from pathlib import Path

from foundation import conclusions as c


class ConclusionsTest(unittest.TestCase):
    def test_hit_then_stale_on_evidence_change(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); (d / "doctrine").mkdir()
            (d / "x.py").write_text("PROTECTED = ['a']\n")
            self.assertEqual(c.ask("Where is X?", d)[0], "miss")
            c.put("Where is X?", "x.py", ["x.py"], d)
            self.assertEqual(c.ask("where is x", d)[0], "hit")
            (d / "x.py").write_text("PROTECTED = ['b']\n")
            state, _, ch = c.ask("Where is X?", d)
            self.assertEqual((state, ch), ("stale", ["x.py"]))
            self.assertEqual(c.check(d), ([], ["Where is X?"]))

    def test_put_needs_real_evidence(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); (d / "doctrine").mkdir()
            with self.assertRaises(ValueError):
                c.put("q", "a", [], d)
            with self.assertRaises(ValueError):
                c.put("q", "a", ["missing.py"], d)

    def test_repo_ledger_is_valid(self):
        self.assertEqual(c.check()[0], [])


if __name__ == "__main__":
    unittest.main()

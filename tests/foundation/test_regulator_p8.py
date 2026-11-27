# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import io, sqlite3, unittest
from unittest import mock

from foundation.regulator.audit import next_rate, should_audit
from foundation.regulator import cli


class Audit(unittest.TestCase):
    def test_protected_always_audited(self):
        self.assertTrue(should_audit("c1", ["seed/autonomy/x.json"], ["seed/autonomy/"], 0.0))

    def test_sampling_is_deterministic_and_rate_bounded(self):
        a = [should_audit(f"c{i}", ["a.py"], [], 0.2) for i in range(2000)]
        self.assertEqual(a, [should_audit(f"c{i}", ["a.py"], [], 0.2) for i in range(2000)])
        self.assertTrue(0.12 < sum(a) / 2000 < 0.28)
        self.assertFalse(any(should_audit(f"c{i}", ["a.py"], [], 0.0) for i in range(200)))

    def test_rate_escalates_on_defect_and_decays(self):
        self.assertEqual(next_rate(0.4, True), 0.8)
        self.assertEqual(next_rate(0.8, True), 1.0)
        self.assertEqual(next_rate(0.05, False), 0.05)
        self.assertEqual(next_rate(0.4, False), 0.2)


class Schema(unittest.TestCase):
    def test_schema_output_builds_the_ledger(self):
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            cli.main(["schema"])
        db = sqlite3.connect(":memory:"); db.executescript(out.getvalue())
        names = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
        self.assertTrue({"token_log", "conclusion", "step_change", "file_state"} <= names)


if __name__ == "__main__":
    unittest.main()

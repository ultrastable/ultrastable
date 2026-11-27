# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import io, json, unittest
from unittest import mock

from test_regulator import make_repo, REPO
from foundation.regulator import Store, RepoModel
from foundation.regulator.algedonic import Channel, preempt
from foundation.regulator.prefix import stable
from foundation.regulator import cli


class Algedonic(unittest.TestCase):
    def test_debounce_and_order(self):
        ch = [Channel("slo_burn", 2.0, 2), Channel("security", 1.0)]
        self.assertEqual(preempt(ch, {"slo_burn": [3.0], "security": [0.5]}), [])
        self.assertEqual(preempt(ch, {"slo_burn": [3.0, 4.0], "security": [1.2]}), ["slo_burn", "security"])


class Prefix(unittest.TestCase):
    def test_prefix_stable_until_code_changes(self):
        m = RepoModel(Store(), make_repo(REPO)); m.update()
        self.assertTrue(stable(m, ["api/handler.py"], runs=3))


class Hook(unittest.TestCase):
    def test_hook_payload_lands_in_ledger(self):
        import os, tempfile
        db = os.path.join(tempfile.mkdtemp(), "l.sqlite")
        payload = {"session_id": "s1", "tool_name": "Read", "tool_input": {"file_path": "a"}, "tool_response": "x" * 400}
        with mock.patch("sys.stdin", io.StringIO(json.dumps(payload))):
            cli.main(["hook", "--db", db])
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            cli.main(["tokens", "--db", db])
        self.assertAlmostEqual(json.loads(out.getvalue())["share_by_kind"]["read"], 1.0)


if __name__ == "__main__":
    unittest.main()

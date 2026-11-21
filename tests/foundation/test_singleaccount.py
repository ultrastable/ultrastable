# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# SPDX-License-Identifier: LicenseRef-Ultrastable
# Ultrastable is the foundation for any autonomous system.
import tempfile, unittest, json
from pathlib import Path
from foundation import singleaccount as sa

ROOT = Path(__file__).resolve().parents[2]


class SingleAccount(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(sa.check(ROOT), [])

    def test_a_reference_fails(self):
        with tempfile.TemporaryDirectory() as t:
            r = Path(t); (r / "doctrine").mkdir(); (r / "deploy").mkdir()
            (r / PATHS).write_text((ROOT / PATHS).read_text())
            (r / "deploy/cloudflare-accounts.json").write_text(json.dumps({"target": {"id": "81e3a4efb4eb66e613529b87682911bb"}}))
            (r / "x.json").write_text('{"account": "edb167b78c9fb901ea5bca3ce58ccc4b"}')
            self.assertEqual(len(sa.check(r)), 1)
            (r / "x.json").write_text('{"account": "81e3a4efb4eb66e613529b87682911bb"}')
            self.assertEqual(sa.check(r), [])


PATHS = "doctrine/single-account.json"
if __name__ == "__main__":
    unittest.main()


class Moved(unittest.TestCase):
    def test_moved_fails_while_pending(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "ops").mkdir()
            (Path(t) / "ops/account-move.json").write_text(json.dumps({"items": {"a": "pending", "b": "moved"}}))
            self.assertEqual(sa.moved(t), ["a"])
            (Path(t) / "ops/account-move.json").write_text(json.dumps({"items": {"a": "moved"}}))
            self.assertEqual(sa.moved(t), [])


class Runtime(unittest.TestCase):
    def test_runtime_clean_and_catches(self):
        self.assertEqual(sa.runtime_scan(ROOT), [])
        with tempfile.TemporaryDirectory() as t:
            r = Path(t); (r / "doctrine").mkdir(); (r / "site").mkdir()
            d = json.loads((ROOT / PATHS).read_text()); (r / PATHS).write_text(json.dumps(d))
            (r / "site/a.js").write_text('fetch("https://qnfo-social.q08.workers.dev/x")')
            self.assertEqual(len(sa.runtime_scan(r)), 1)
            (r / "site/a.js").write_text('fetch("https://ultrastable.io/x")')
            self.assertEqual(sa.runtime_scan(r), [])

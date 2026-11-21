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


class Live(unittest.TestCase):
    NS = {"Answer": [{"type": 2, "data": "grace.ns.cloudflare.com."}, {"type": 2, "data": "leonidas.ns.cloudflare.com."}]}

    def fake(self, other_workers):
        def get(url, token=None):
            if "dns-query" in url:
                return self.NS
            if url.split("?")[0].endswith("/accounts"):
                return {"result": [{"id": "81e3a4efb4eb66e613529b87682911bb", "name": "ultrastable"}, {"id": "other", "name": "other"}]}
            if "/workers/scripts" in url:
                return {"result": [{"id": w} for w in other_workers]}
            if "/r2/buckets" in url:
                return {"result": {"buckets": []}}
            return {"result": []}
        return get

    def test_clean_other_account_passes(self):
        r = sa.live(ROOT, get=self.fake(["qnfo-ops"]), token="t")
        self.assertTrue(r["ok"], r)

    def test_ultrastable_worker_elsewhere_fails(self):
        r = sa.live(ROOT, get=self.fake(["qnfo-ops", "ultrastable-tick", "tenant-ps-mail"]), token="t")
        self.assertFalse(r["ok"]); self.assertEqual(len(r["problems"]), 2)

    def test_wrong_name_servers_fail(self):
        f = self.fake([])
        def get(url, token=None):
            return {"Answer": [{"type": 2, "data": "julian.ns.cloudflare.com."}]} if "dns-query" in url else f(url, token)
        self.assertFalse(sa.live(ROOT, get=get, token="t")["ok"])

    def test_no_token_is_unmeasured_not_clean(self):
        r = sa.live(ROOT, get=self.fake([]), token="")
        self.assertTrue(any("unmeasured" in n for n in r["notes"]))

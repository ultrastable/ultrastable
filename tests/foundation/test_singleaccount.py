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

    def fake(self, other_workers, bindings=()):
        def get(url, token=None):
            if "dns-query" in url:
                return self.NS
            if "/settings" in url:
                return {"result": {"bindings": list(bindings)}}
            if "/accounts/81e3a4efb4eb66e613529b87682911bb/workers/scripts" in url:
                return {"result": [{"id": "tenant-ps-core"}]}
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

    def test_dependency_on_retired_account_fails(self):
        r = sa.live(ROOT, get=self.fake([], [{"type": "plain_text", "name": "MAIL_RELAY_URL", "text": "https://tenant-ps-mail.q08.workers.dev"}]), token="t")
        self.assertFalse(r["ok"]); self.assertIn("MAIL_RELAY_URL", r["problems"][0])

    def test_wrong_name_servers_fail(self):
        f = self.fake([])
        def get(url, token=None):
            return {"Answer": [{"type": 2, "data": "julian.ns.cloudflare.com."}]} if "dns-query" in url else f(url, token)
        self.assertFalse(sa.live(ROOT, get=get, token="t")["ok"])

    def test_no_token_is_unmeasured_not_clean(self):
        r = sa.live(ROOT, get=self.fake([]), token="")
        self.assertTrue(any("unmeasured" in n for n in r["notes"]))


class Retire(unittest.TestCase):
    def run_with(self, io_status):
        calls = []
        def get(url, token=None):
            if url.split("?")[0].endswith("/accounts"):
                return {"result": [{"id": "81e3a4efb4eb66e613529b87682911bb"}, {"id": "old"}]}
            if "account.id=81e3" in url:
                return {"result": [{"name": "ultrastable.io", "status": io_status, "id": "n"}]}
            if "account.id=old" in url:
                return {"result": [{"name": "ultrastable.io", "status": "active", "id": "o"}]}
            if "/accounts/old/workers/scripts" in url:
                return {"result": [{"id": "ultrastable-site"}, {"id": "qnfo-ops"}]}
            return {"result": []}
        r = sa.retire(ROOT, get=get, call=lambda m, p, t, b=None: calls.append(m + " " + p), token="t")
        return r, calls

    def test_waits_while_zone_is_pending_here(self):
        r, calls = self.run_with("pending")
        self.assertEqual(calls, []); self.assertTrue(any("waiting" in n for n in r["notes"]))

    def test_deletes_only_ultrastable_assets_once_active(self):
        r, calls = self.run_with("active")
        self.assertEqual(calls, ["DELETE /accounts/old/workers/scripts/ultrastable-site?force=true", "DELETE /zones/o"])
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

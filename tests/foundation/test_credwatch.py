# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TOKEN-EXPIRY-1: expiry is measured, an unbound or unprobed credential is never ok, and a value is never written."""
import datetime as dt, json, shutil, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import credwatch  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
TODAY = dt.date(2026, 11, 20)


def http(cf_expires="2026-12-01T00:00:00Z", cf_status="active", code=200):
    def f(url, tok):
        if "cloudflare" in url:
            return code, {}, json.dumps({"result": {"status": cf_status, "expires_on": cf_expires}})
        return 200, {"GitHub-Authentication-Token-Expiration": "2027-06-01 00:00:00 UTC"}, ""
    return f


class Cred(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory(); self.d = Path(self._td.name); (self.d / "doctrine").mkdir()
        shutil.copy(REPO / "doctrine/credwatch.json", self.d / "doctrine/credwatch.json")
        self.env = {"CLOUDFLARE_API_TOKEN": "s3cret-value", "LANE_PAT": "another-value"}

    def tearDown(self):
        self._td.cleanup()

    def rows(self, **k):
        return {r["name"]: r for r in credwatch.assess(credwatch.cfg(self.d), TODAY, k.pop("env", self.env), http(**k))}

    def test_expiring_token_files_an_item_and_no_value_is_written(self):
        r = credwatch.run(self.d, apply=True, today=TODAY, env=self.env, http=http())
        self.assertEqual(r["bad"], ["CLOUDFLARE_API_TOKEN"]); self.assertTrue(r["changed"])
        it = json.loads((self.d / "docs/issues/Q-CRED-CLOUDFLARE_API_TOKEN.json").read_text())
        self.assertIn("cmd:python3 -m foundation credwatch --probe CLOUDFLARE_API_TOKEN", it["body"])
        for p in self.d.rglob("*.json"):
            self.assertNotIn("s3cret-value", p.read_text()); self.assertNotIn("another-value", p.read_text())
        self.assertFalse(credwatch.run(self.d, apply=True, today=TODAY, env=self.env, http=http())["changed"], "a second run with the same states writes nothing")
        self.assertEqual(credwatch.probe_recorded("CLOUDFLARE_API_TOKEN", self.d), 1)
        self.assertEqual(credwatch.probe_recorded("LANE_PAT", self.d), 0)

    def test_states(self):
        self.assertEqual(self.rows(cf_expires=None)["CLOUDFLARE_API_TOKEN"]["state"], "ok")
        self.assertEqual(self.rows(cf_status="disabled")["CLOUDFLARE_API_TOKEN"]["state"], "invalid")
        self.assertEqual(self.rows(code=401)["CLOUDFLARE_API_TOKEN"]["state"], "invalid")
        self.assertEqual(self.rows(code=503)["CLOUDFLARE_API_TOKEN"]["state"], "unmeasured")
        self.assertEqual(self.rows(env={})["LANE_PAT"]["state"], "unbound")
        self.assertEqual(self.rows()["LANE_PAT"]["days_left"], 193)

    def test_domains_warn_before_they_lapse(self):
        c = credwatch.cfg(self.d)
        self.assertEqual(credwatch.assess(c, TODAY, {}, http())[-1]["state"], "ok")
        late = {r["name"]: r["state"] for r in credwatch.assess(c, dt.date(2027, 10, 1), {}, http())}
        self.assertEqual(late["domain-ultrastable.io"], "expiring")
        self.assertEqual(credwatch.assess(c, dt.date(2027, 11, 11), {}, http())[-1]["state"], "expired")

    def test_config_and_wiring(self):
        self.assertEqual(credwatch.check(REPO), [])
        self.assertIn("foundation credwatch --run --apply", (REPO / ".github/workflows/watchdog.yml").read_text())


if __name__ == "__main__":
    unittest.main()

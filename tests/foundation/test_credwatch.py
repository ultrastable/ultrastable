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
        cfg = json.loads((REPO / "doctrine/credwatch.json").read_text())
        cfg["credentials"] = [c for c in cfg["credentials"] if c["kind"] != "cloudflare-worker-token"]  # the Worker route is tested below; these cases test expiry
        for c in cfg["credentials"]:
            c.pop("optional", None)
        (self.d / "doctrine/credwatch.json").write_text(json.dumps(cfg))
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

    def test_optional_credentials_are_recorded_but_never_file_items_or_limit_the_runway(self):
        cfg = credwatch.cfg(REPO)
        names = {c["name"]: c for c in cfg["credentials"]}
        self.assertTrue(names["CLOUDFLARE_API_TOKEN"].get("optional") and names["LANE_PAT"].get("optional"))
        self.assertEqual(names["CF_DEPLOY_TOKEN"]["kind"], "cloudflare-worker-token")
        self.assertFalse(names["CF_DEPLOY_TOKEN"].get("optional"))
        d = self.d / "doctrine/credwatch.json"; c = json.loads(d.read_text())
        c["credentials"][0]["optional"] = True; d.write_text(json.dumps(c))
        r = credwatch.run(self.d, apply=True, today=TODAY, env=self.env, http=http(code=401))
        self.assertEqual(r["bad"], []); self.assertFalse((self.d / "docs/issues/Q-CRED-CLOUDFLARE_API_TOKEN.json").exists())
        self.assertTrue(json.loads((self.d / "ops/credwatch.json").read_text())["rows"][0]["optional"])

    def test_worker_route_state_comes_from_reading_the_account(self):
        from foundation import workerroute
        self.assertEqual(workerroute.reaches_account({}, api=lambda m, p: {"success": True})["state"], "ok")
        def refused(m, p): raise OSError("GET d1/database: HTTP 403")
        self.assertEqual(workerroute.reaches_account({}, api=refused)["state"], "invalid")
        def down(m, p): raise OSError("GET d1/database: HTTP 502")
        self.assertEqual(workerroute.reaches_account({}, api=down)["state"], "unmeasured")
        self.assertEqual(credwatch.probe({"name": "CF_DEPLOY_TOKEN", "kind": "cloudflare-worker-token"}, {})["state"], "unmeasured", "no OIDC token in the environment is never ok")

    def test_domains_warn_before_they_lapse(self):
        c = credwatch.cfg(self.d)
        self.assertEqual(credwatch.assess(c, TODAY, {}, http())[-1]["state"], "ok")
        late = {r["name"]: r["state"] for r in credwatch.assess(c, dt.date(2027, 10, 1), {}, http())}
        self.assertEqual(late["domain-ultrastable.io"], "expiring")
        self.assertEqual(credwatch.assess(c, dt.date(2027, 11, 11), {}, http())[-1]["state"], "expired")

    def test_config_and_wiring(self):
        self.assertEqual(credwatch.check(REPO), [])
        self.assertIn("foundation credwatch --run --apply", (REPO / ".github/workflows/watchdog.yml").read_text())


class Ledger(unittest.TestCase):
    """CRED-EXPIRY-1: the detector reads the recorded states; a required credential not ok, an expiry in the window or a never-recorded one fails."""
    def _root(self, rows):
        d = Path(tempfile.mkdtemp()); (d / "doctrine").mkdir(); (d / "ops").mkdir()
        (d / "doctrine/credwatch.json").write_text(json.dumps({"warn_days": 45, "registrations": [],
            "credentials": [{"name": "A", "kind": "github-token", "used_by": "x"}, {"name": "B", "kind": "github-token", "used_by": "y", "optional": True}]}))
        (d / "ops/credwatch.json").write_text(json.dumps({"rows": rows}))
        return d

    def test_ledger(self):
        self.assertEqual(credwatch.ledger(self._root([{"name": "A", "state": "ok"}, {"name": "B", "state": "invalid"}]), TODAY), [])
        self.assertTrue(credwatch.ledger(self._root([{"name": "B", "state": "ok"}]), TODAY)[0].startswith("A: never recorded"))
        self.assertEqual(credwatch.ledger(self._root([{"name": "A", "state": "invalid"}, {"name": "B", "state": "ok"}]), TODAY), ["A: invalid"])
        soon = credwatch.ledger(self._root([{"name": "A", "state": "ok"}, {"name": "dom", "state": "ok", "expires": "2026-12-10"}]), TODAY)
        self.assertTrue(any("20 days left" in m for m in soon))

    def test_admin_app_probe_reads_dry(self):
        """APP-CRED-WATCH-1: the admin App probe sends a dry repo-settings op and maps the answer."""
        from foundation import workerroute
        sent = []
        class R:
            def __init__(self, b): self.b = b
            def read(self): return self.b
            def __enter__(self): return self
            def __exit__(self, *a): return False
        def opener(req, timeout=0):
            if "token.example" in req.full_url:
                return R(b'{"value": "jwt"}')
            sent.append(json.loads(req.data)); return R(b'{"ok": true, "dry": true, "drift": []}')
        env = {"ACTIONS_ID_TOKEN_REQUEST_URL": "https://token.example/?x=1", "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "t"}
        self.assertEqual(workerroute.admin_app(env, opener=opener)["state"], "ok")
        self.assertEqual(sent, [{"op": "repo-settings", "repo": "ultrastable/ultrastable", "dry": True}])


if __name__ == "__main__":
    unittest.main()

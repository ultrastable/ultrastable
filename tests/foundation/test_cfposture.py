# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CF-POSTURE-1: the Cloudflare account's settings are rules measured against the live account; unreadable is never passed."""
import json, shutil, sys, tempfile, unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import cfposture as C  # noqa: E402

NOW = datetime(2026, 11, 20, tzinfo=timezone.utc)
POL = C.policy(ROOT)
# the account as measured on 2026-11-20 (ids only)
LIVE = {
    "workers": [{"id": "ultrastable-tick", "modified_on": "2026-11-20T15:12:55Z", "observability": {"enabled": True}},
                {"id": "ultrastable-site", "modified_on": "2026-11-20T15:16:03Z", "observability": None},
                {"id": "us-idea-16438b610e", "modified_on": "2026-11-10T10:57:22Z", "observability": None},
                {"id": "us-idea-fresh", "modified_on": "2026-11-19T10:00:00Z", "observability": None}],
    "alerts": [{"alert_type": "billing_budget_alert", "enabled": True, "mechanisms": {"email": [{"id": "x"}]}}],
    "tokens": [{"name": "deployer", "status": "active", "expires_on": None}, {"name": "short", "status": "active", "expires_on": "2027-03-01T00:00:00Z"}],
    "zones": [{"name": "ultrastable.net", "status": "pending"}],
    "members": [{"status": "accepted"}],
}


def by_id(rows):
    return {r["id"]: r for r in rows}


class Evaluate(unittest.TestCase):
    def test_measured_account_fails_the_rules_it_broke(self):
        r = by_id(C.evaluate(POL, LIVE, NOW))
        self.assertEqual(r["worker-logs-on"]["detail"], ["ultrastable-site"], "a preview Worker is judged by the idle rule, not the log rule")
        self.assertEqual(r["no-idle-preview-workers"]["detail"], ["us-idea-16438b610e"])
        self.assertEqual(r["alerts-reach-code"]["detail"], sorted(POL["required_alerts"]), "a policy that only mails a person does not count")
        self.assertEqual(r["tokens-outlive-horizon"]["detail"], ["short"])
        self.assertEqual(r["zones-active"]["status"], "fail")
        self.assertEqual((r["second-member"]["status"], r["second-member"]["kind"]), ("fail", "gate"))

    def test_healthy_account_passes(self):
        live = {"workers": [{"id": "a", "modified_on": "2026-11-20T00:00:00Z", "observability": {"enabled": True}}],
                "alerts": [{"alert_type": t, "enabled": True, "mechanisms": {"webhooks": [{"id": "w"}]}} for t in POL["required_alerts"]],
                "tokens": [{"name": "t", "status": "active", "expires_on": None}], "zones": [{"name": "z", "status": "active"}], "members": [{"status": "accepted"}, {"status": "accepted"}]}
        self.assertEqual({r["status"] for r in C.evaluate(POL, live, NOW)}, {"pass"})

    def test_unreadable_is_unmeasured_never_passed(self):
        rows = C.evaluate(POL, {"workers": None, "alerts": None, "tokens": None, "zones": None, "members": None, "_why": {"alerts": "GET /alerting: HTTP 403"}}, NOW)
        self.assertEqual({r["status"] for r in rows}, {"unmeasured"})
        self.assertEqual(by_id(rows)["alerts-reach-code"]["detail"], ["GET /alerting: HTTP 403"])

    def test_read_live_marks_a_refused_section(self):
        import urllib.error
        def opener(req, timeout=0):
            raise urllib.error.HTTPError(req.full_url, 403, "no", {}, None)
        live = C.read_live(POL, "t", opener)
        self.assertIsNone(live["workers"]); self.assertIn("HTTP 403", live["_why"]["workers"])


class Apply(unittest.TestCase):
    def test_failure_files_an_item_and_a_pass_closes_it(self):
        tmp = Path(tempfile.mkdtemp(prefix="ultrastable-test-cfp-")); self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / "ops").mkdir()
        rows = C.evaluate(POL, LIVE, NOW)
        done = C.apply(tmp, POL, rows, NOW)
        self.assertIn("filed Q-CFP-worker-logs-on.json", done)
        self.assertFalse((tmp / "docs/issues/Q-CFP-second-member.json").exists(), "a gate files no item")
        j = json.loads((tmp / "docs/issues/Q-CFP-worker-logs-on.json").read_text())
        self.assertIn("cmd:python3 -m foundation cfposture --rule worker-logs-on", j["body"])
        self.assertEqual(C.rule_passed(tmp, "worker-logs-on")[0], False)
        fixed = [dict(r, status="pass", detail=[]) for r in rows]
        self.assertIn("closed Q-CFP-worker-logs-on.json", C.apply(tmp, POL, fixed, NOW))
        self.assertTrue(C.rule_passed(tmp, "worker-logs-on")[0])


class Repo(unittest.TestCase):
    def test_static_check_and_wiring(self):
        self.assertEqual(C.static_check(ROOT), [])
        self.assertIn("python3 -m foundation cfposture --check", (ROOT / ".github/workflows/checks.yml").read_text(encoding="utf-8"))
        self.assertIn("python3 -m foundation cfposture --probe --apply", (ROOT / ".github/workflows/cost-guard.yml").read_text(encoding="utf-8"))

    def test_an_upload_without_logging_fails(self):
        tmp = Path(tempfile.mkdtemp(prefix="ultrastable-test-cfp-")); self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / "doctrine").mkdir(); (tmp / "deploy").mkdir(); (tmp / "site").mkdir()
        (tmp / "doctrine/cf-posture.json").write_text(json.dumps(dict(POL, upload_paths=["deploy/a.mjs"])))
        (tmp / "deploy/a.mjs").write_text('form.append("metadata", JSON.stringify({ main_module: "w.js" }));\n')
        (tmp / "site/b.js").write_text('fd.set("metadata", JSON.stringify({ main_module: "w.js", observability: { enabled: true } }));\n')
        fails = C.static_check(tmp)
        self.assertTrue(any("deploy/a.mjs" in f and "observability" in f for f in fails))
        self.assertTrue(any("site/b.js" in f and "not in upload_paths" in f for f in fails))


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SEED-LAUNCH-1: every seed is built, deployed, year-gated and probed live by the system; a standalone seed is self-contained."""
import datetime as dt, json, re, shutil, tempfile, unittest
from pathlib import Path

from foundation import seedlaunch

ROOT = Path(__file__).resolve().parents[2]


class SeedLaunch(unittest.TestCase):
    def _ledger(self, rows):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        (d / "ops").mkdir()
        (d / seedlaunch.LEDGER).write_text("".join(json.dumps(r) + "\n" for r in rows))
        return d

    def test_check_fails_on_failed_e2e(self):
        d = self._ledger([{"kind": "e2e", "at": seedlaunch._now(), "passed": False, "failed_stages": {"verify_live": "x"}}])
        self.assertTrue(seedlaunch.check(d))

    def test_check_passes_fresh_and_fails_stale(self):
        d = self._ledger([{"kind": "e2e", "at": seedlaunch._now(), "passed": True}])
        self.assertEqual(seedlaunch.check(d), [])
        later = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)
        self.assertTrue(seedlaunch.check(d, now=later))

    def test_verdict_requires_year_gate_and_live(self):
        log = {"stages": [{"stage": s, "status": "ok"} for s in seedlaunch.REQUIRED if s != "verify_live"] + [{"stage": "verify_live", "status": "degraded", "detail": "dry"}]}
        v = seedlaunch.verdict(log)
        self.assertFalse(v["passed"])
        self.assertIn("verify_live", v["failed_stages"])
        self.assertIn("year_gate", seedlaunch.REQUIRED)

    def test_set_front(self):
        t = seedlaunch.set_front("---\nslug: a\n---\n# Idea\n", slug="b", workers_dev="true")
        self.assertIn("slug: b", t)
        self.assertIn("workers_dev: true", t)

    def test_bootstrap_runs_the_gates(self):
        src = (ROOT / "seed/bootstrap/bootstrap.py").read_text()
        self.assertIn('"start", "year_gate", "verify_live"', src)

    def test_seed_worker_imports_stay_inside_the_seed(self):
        """SEED-SELFCONTAINED-1: a repository made from the seed must build on its own; no source import may leave seed/."""
        seed = (ROOT / "seed").resolve()
        bad = []
        for f in (ROOT / "seed/worker/src").rglob("*.js"):
            for m in re.finditer(r"""(?:from|import\()\s*['"](\.[^'"]+)['"]""", f.read_text()):
                tgt = (f.parent / m.group(1)).resolve()
                if not str(tgt).startswith(str(seed)):
                    bad.append(f"{f.relative_to(ROOT)} -> {m.group(1)}")
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()


class AccountGuard(unittest.TestCase):
    def test_refuses_other_account(self):
        import os
        from foundation import seedlaunch
        old = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        os.environ["CLOUDFLARE_ACCOUNT_ID"] = "0" * 32
        try:
            r = seedlaunch.launch(Path("/nonexistent"), "e2e")
        finally:
            if old is None:
                os.environ.pop("CLOUDFLARE_ACCOUNT_ID")
            else:
                os.environ["CLOUDFLARE_ACCOUNT_ID"] = old
        self.assertFalse(r["passed"])
        self.assertIn("account", r["failed_stages"])


class E2EOidc(unittest.TestCase):
    def _root(self, row):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        (d / "ops").mkdir(); (d / "ops" / "deploys.jsonl").write_text(json.dumps(row) + "\n")
        return d

    def test_waits_then_verifies(self):
        d = self._root({"kind": "seed", "slug": "s", "url": "https://x", "year_p10": 730, "uploaded": True, "live_ok": False})
        calls, slept = [], []
        probed = []
        ok = lambda u: probed.append(u) or [{"capability": "frontend", "path": "/", "ok": True, "why": ""}]
        r = seedlaunch.e2e_oidc(root=d, run=lambda a: (calls.append(a) or (0, "OK")), sleep=slept.append, coldstart_live=ok)
        self.assertTrue(r["passed"]); self.assertEqual(len(calls), 2); self.assertEqual(slept, [660])
        self.assertEqual(probed, ["https://x"]); self.assertEqual(r["coldstart"], {"frontend": True})

    def test_coldstart_miss_fails_the_launch(self):
        d = self._root({"kind": "seed", "slug": "s", "url": "https://x", "year_p10": 730, "uploaded": True, "live_ok": True})
        miss = lambda u: [{"capability": "discoverable", "path": "/.well-known/ultrastable.json", "ok": False, "why": "status 404, expected [200]"}]
        r = seedlaunch.e2e_oidc(root=d, run=lambda a: (0, "OK"), sleep=lambda s: None, coldstart_live=miss)
        self.assertFalse(r["passed"]); self.assertIn("/.well-known/ultrastable.json", r["failed_stages"]["coldstart"])

    def test_upload_error_fails(self):
        d = self._root({"kind": "seed", "slug": "s", "year_p10": 730, "live_ok": False, "error": "ENOENT"})
        r = seedlaunch.e2e_oidc(root=d, run=lambda a: (1, "FAIL"), sleep=lambda s: None)
        self.assertFalse(r["passed"]); self.assertIn("provision", r["failed_stages"])


class Scrub(unittest.TestCase):
    def test_retired_account_is_scrubbed(self):
        from foundation import cfaccount
        env = {"CLOUDFLARE_ACCOUNT_ID": cfaccount.retired_ids()[0], "CLOUDFLARE_API_TOKEN": "x"}
        self.assertTrue(cfaccount.scrub(env))
        self.assertEqual(env, {})

    def test_ultrastable_account_kept(self):
        from foundation import cfaccount
        env = {"CLOUDFLARE_ACCOUNT_ID": "81e3a4efb4eb66e613529b87682911bb", "CLOUDFLARE_API_TOKEN": "x"}
        self.assertFalse(cfaccount.scrub(env))
        self.assertEqual(len(env), 2)

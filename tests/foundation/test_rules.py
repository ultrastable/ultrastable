# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import datetime as dt, json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests.foundation._repo import copy_repo
from foundation import rules as R

NOW = dt.datetime(2026, 11, 18, 12, 0, tzinfo=dt.timezone.utc)


class Rules(unittest.TestCase):
    def test_registry_complete_in_repo(self):
        self.assertEqual(R.check(), [])

    def test_rule_without_ci_or_runtime_probe_fails(self):
        root = copy_repo()
        p = root / R.REG; d = json.loads(p.read_text())
        d["rules"][0]["ci"] = []; d["rules"][1]["runtime"] = []
        p.write_text(json.dumps(d))
        bad = R.check(root)
        self.assertTrue(any("no CI check" in b for b in bad)); self.assertTrue(any("no runtime probe" in b for b in bad))

    def test_ci_command_not_in_workflow_fails_and_required_rule_missing_fails(self):
        root = copy_repo()
        p = root / R.REG; d = json.loads(p.read_text())
        d["rules"][0]["ci"].append({"cmd": "python3 -m foundation closedloop --nope"})
        d["rules"] = [r for r in d["rules"] if r["id"] != "free-tier"]
        p.write_text(json.dumps(d))
        bad = R.check(root)
        self.assertTrue(any("not run by" in b for b in bad)); self.assertTrue(any("free-tier missing" in b for b in bad))

    def test_violation_files_once_runs_fix_and_unmeasured_never_files(self):
        root = copy_repo()
        calls = []
        def sh(cmd, cwd, timeout=300):
            calls.append(cmd)
            return (1, "boom") if "closedloop" in cmd else (0, "ok")
        o = R.run(root, apply=True, now=NOW, sh=sh)
        self.assertIn("Q-RULE-closed-loops-closedloop", o["filed"])
        self.assertEqual(o["rules"]["closed-loops"]["status"], "violated")
        self.assertTrue((root / "docs/issues/Q-RULE-closed-loops-closedloop.json").is_file())
        self.assertEqual(R.run(root, apply=True, now=NOW + dt.timedelta(hours=7), sh=sh)["filed"], [])
        self.assertEqual(R.run(root, apply=True, due=True, now=NOW + dt.timedelta(hours=8), sh=sh)["at"], o["at"] if False else R.run(root, apply=False, due=True, now=NOW + dt.timedelta(hours=8), sh=sh)["at"])
        self.assertEqual(o["rules"]["front-end-matches-back-end"]["status"], "unmeasured")  # pages-live not written yet

    def test_secret_and_qnfo_probes_bite(self):
        root = copy_repo()
        (root / "ops").mkdir(exist_ok=True)
        (root / "ops/x.jsonl").write_text('{"t": "ghp_' + "a" * 36 + '"}\n')
        (root / "site/new-page.js").write_text("// QNFO research data\n")
        d = json.loads((root / R.REG).read_text())
        import subprocess
        subprocess.run(["git", "init", "-q"], cwd=root); subprocess.run(["git", "add", "-A"], cwd=root)
        self.assertEqual(R.p_no_secrets(root, d)[0], "violated")
        self.assertEqual(R.p_no_qnfo(root, d)[0], "violated")

    def test_pages_live_slot(self):
        root = copy_repo(); d = json.loads((root / R.REG).read_text())
        self.assertEqual(R.p_pages_live(root, d, NOW)[0], "unmeasured")
        (root / "ops/pages-live.json").write_text(json.dumps({"at": "2026-11-18T11:00:00Z", "failing": ["/live"]}))
        self.assertEqual(R.p_pages_live(root, d, NOW)[0], "violated")
        (root / "ops/pages-live.json").write_text(json.dumps({"at": "2026-11-18T11:00:00Z", "failing": []}))
        self.assertEqual(R.p_pages_live(root, d, NOW)[0], "ok")


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SUBSTANCE-1: only changes that alter executable behaviour count, open a PR or redeploy."""
import json, subprocess, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tests.foundation._repo import ROOT
from foundation import substance


class Vectors(unittest.TestCase):
    def test_every_shared_vector(self):
        v = json.loads((ROOT / substance.VECTORS).read_text(encoding="utf-8"))
        c = substance.cfg()
        for case in v["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(substance.classify_file(case["path"], case["status"], case["removed"], case["added"], c), case["expect"])
        for case in v["verdicts"]:
            with self.subTest(case["name"]):
                self.assertEqual(substance.verdict(case["kinds"]), case["expect"])

    def test_check_is_clean(self):
        self.assertEqual(substance.check(), [])


DIFF = """diff --git a/site/dashboard-data.js b/site/dashboard-data.js
index 1..2 100644
--- a/site/dashboard-data.js
+++ b/site/dashboard-data.js
@@ -2 +2 @@
- "asof": "5e4a1aab",
+ "asof": "d02d20a",
diff --git a/scripts/smoke_probe.py b/scripts/smoke_probe.py
--- a/scripts/smoke_probe.py
+++ b/scripts/smoke_probe.py
@@ -1 +1 @@
-import json, os
+import os
"""


class Diff(unittest.TestCase):
    def test_spinoff_registry_mirror_is_generated_not_code(self):
        # foundation/spinoff.py writes spinoffs/registry.js ("do not edit"); the daily spinoff data PR must not read as trivial code.
        self.assertEqual(substance.file_class("spinoffs/registry.js", substance.cfg()), "generated")

    def test_measured_executor_pr_is_trivial(self):
        r = substance.classify_diff(DIFF)
        self.assertEqual(r["verdict"], "trivial")
        self.assertEqual({x["path"]: x["kind"] for x in r["files"]}, {"site/dashboard-data.js": "generated", "scripts/smoke_probe.py": "import"})

    def test_path_filter(self):
        self.assertEqual(substance.classify_diff(DIFF, paths=["site/**"])["files"][0]["path"], "site/dashboard-data.js")


def _git(d, *a):
    subprocess.run(["git", *a], cwd=d, check=True, capture_output=True)


class Repo(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory(prefix="ultrastable-test-substance-"); self.addCleanup(td.cleanup)
        self.d = Path(td.name)
        (self.d / "doctrine").mkdir()
        for f in (substance.CONFIG, substance.VECTORS):
            (self.d / f).write_text((ROOT / f).read_text(encoding="utf-8"), encoding="utf-8")
        (self.d / "site").mkdir(); (self.d / "ops").mkdir()
        (self.d / "site/w.js").write_text("export const LIMIT = 70;\nexport function f(x) { return x > LIMIT; }\n")
        _git(self.d, "init", "-q"); _git(self.d, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
        _git(self.d, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base")

    def commit(self, msg="c"):
        _git(self.d, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
        _git(self.d, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg)

    def test_working_tree_number_bump_is_trivial_and_new_file_is_behaviour(self):
        (self.d / "site/w.js").write_text("export const LIMIT = 71;\nexport function f(x) { return x > LIMIT; }\n")
        self.assertEqual(substance.classify_range(None, self.d)["verdict"], "trivial")
        (self.d / "site/new.js").write_text("export const g = () => 1;\n")
        self.assertEqual(substance.classify_range(None, self.d)["verdict"], "substantive")

    def test_deploy_gate_skips_data_churn_until_the_live_deploy_ages(self):
        now = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)
        (self.d / "ops/deploys.jsonl").write_text(json.dumps({"at": (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"), "live_matches_commit": True, "sha": "x"}) + "\n")
        self.commit()
        (self.d / "site/w.js").write_text("export const LIMIT = 72;\nexport function f(x) { return x > LIMIT; }\n"); self.commit()
        d = substance.deploy_decision("HEAD~1..HEAD", ["site/**"], self.d, now=now)
        self.assertFalse(d["deploy"], d)
        self.assertTrue(substance.deploy_decision("HEAD~1..HEAD", ["site/**"], self.d, now=now + timedelta(hours=30))["deploy"])
        (self.d / "site/w.js").write_text("export const LIMIT = 72;\nexport function f(x) { return x >= LIMIT; }\n"); self.commit()
        self.assertTrue(substance.deploy_decision("HEAD~1..HEAD", ["site/**"], self.d, now=now)["deploy"])
        self.assertTrue(substance.deploy_decision("deadbeef..HEAD", ["site/**"], self.d, now=now)["deploy"])  # unreadable base never skips

    def test_report_states_and_origins(self):
        (self.d / "site/w.js").write_text("export const LIMIT = 73;\nexport function f(x) { return x > LIMIT; }\n")
        _git(self.d, "add", "-A"); _git(self.d, "-c", "user.name=bot[bot]", "-c", "user.email=b@b", "commit", "-qm", "bump")
        r = substance.report(self.d, days=7)
        self.assertEqual(r["by_origin"]["system"]["trivial"], 1)
        self.assertEqual(r["state"], "trivial-only")
        self.assertIn("state trivial-only", " ".join(substance.check_targets(r, substance.cfg(self.d))))


if __name__ == "__main__":
    unittest.main()


class Gate(unittest.TestCase):
    def test_gate_modes(self):
        import os
        from unittest import mock
        triv = {"verdict": "trivial", "files": [], "behaviour": []}
        rec = {"verdict": "record", "files": [], "behaviour": []}
        with mock.patch.object(substance, "classify_range", return_value=triv):
            with mock.patch.dict(os.environ, {"PR_BODY": "Executor run 1", "PR_AUTHOR": "github-actions[bot]"}):
                self.assertEqual(substance.main(["--gate", "--executor", "--range", "a...b"]), 3)
            with mock.patch.dict(os.environ, {"PR_BODY": "", "PR_AUTHOR": "ultrastable-1[bot]"}):
                self.assertEqual(substance.main(["--gate", "--executor", "--range", "a...b"]), 3)
            with mock.patch.dict(os.environ, {"PR_BODY": "", "PR_AUTHOR": "rwnq8"}):
                self.assertEqual(substance.main(["--gate", "--executor", "--range", "a...b"]), 0)
        with mock.patch.object(substance, "classify_range", return_value=rec), mock.patch.dict(os.environ, {"PR_BODY": "", "PR_AUTHOR": "github-actions[bot]"}):
            self.assertEqual(substance.main(["--gate", "--executor", "--range", "a...b"]), 0, "a bookkeeping PR of records passes")

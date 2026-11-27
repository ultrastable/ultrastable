# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-29 (visible progress, content stickiness and substantive change): the Python half of the substance rule, `python3 -m foundation substance`.

US-29-R08 the Python classifier returns every shared vector, US-29-R09 a diff is parsed and classified, US-29-R10 the gate, US-29-R11 the deploy gate,
US-29-R12 the seven-day report, US-29-R13 the targets and the config check, US-29-R76 every missing key of the config named without a crash."""
import json, os, subprocess, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import substance  # noqa: E402

GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
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
diff --git a/foundation/new.py b/foundation/new.py
new file mode 100644
--- /dev/null
+++ b/foundation/new.py
@@ -0,0 +1 @@
+def f(x): return x
diff --git a/foundation/old.py b/foundation/old.py
deleted file mode 100644
--- a/foundation/old.py
+++ /dev/null
@@ -1 +0,0 @@
-def g(x): return x
"""


def git(d, *a, author=None):
    cmd = list(GIT)
    if author:
        cmd[2] = f"user.name={author}"
    subprocess.run([*cmd, *a], cwd=d, check=True, capture_output=True)


class Repo(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory(prefix="ultrastable-test-spec29-"); self.addCleanup(td.cleanup)
        self.d = Path(td.name)
        (self.d / "doctrine").mkdir()
        for f in (substance.CONFIG, substance.VECTORS):
            (self.d / f).write_text((ROOT / f).read_text(encoding="utf-8"), encoding="utf-8")
        (self.d / "site").mkdir(); (self.d / "ops").mkdir()
        self.w = self.d / "site/w.js"
        self.w.write_text("export const LIMIT = 70;\nexport function f(x) { return x > LIMIT; }\n")
        subprocess.run(["git", "init", "-q"], cwd=self.d, check=True)
        git(self.d, "add", "-A"); git(self.d, "commit", "-qm", "base")

    def commit(self, subject="c", author=None, body=""):
        git(self.d, "add", "-A"); git(self.d, "commit", "-qm", subject + ("\n\n" + body if body else ""), author=author)


class Classifier(unittest.TestCase):
    def test_us_29_r08_the_python_classifier_returns_every_shared_vector(self):
        v = json.loads((ROOT / substance.VECTORS).read_text(encoding="utf-8"))
        c = substance.cfg()
        self.assertGreaterEqual(len(v["cases"]), 20)
        for case in v["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(substance.classify_file(case["path"], case["status"], case["removed"], case["added"], c), case["expect"])
        for case in v["verdicts"]:
            with self.subTest(case["name"]):
                self.assertEqual(substance.verdict(case["kinds"]), case["expect"])
        self.assertEqual(substance.check(), [])

    def test_us_29_r09_a_diff_is_parsed_per_file_and_classified_with_its_added_and_deleted_files(self):
        files = {f["path"]: f["status"] for f in substance.parse_diff(DIFF)}
        self.assertEqual(files["foundation/new.py"], "added")
        self.assertEqual(files["foundation/old.py"], "removed")
        self.assertEqual(files["scripts/smoke_probe.py"], "modified")
        r = substance.classify_diff(DIFF)
        self.assertEqual({x["path"]: x["kind"] for x in r["files"]}, {"site/dashboard-data.js": "generated", "scripts/smoke_probe.py": "import",
                                                                     "foundation/new.py": "behaviour", "foundation/old.py": "behaviour"})
        self.assertEqual(r["verdict"], "substantive")
        self.assertEqual(sorted(r["behaviour"]), ["foundation/new.py", "foundation/old.py"])
        only = substance.classify_diff(DIFF, paths=["site/**", "scripts"])
        self.assertEqual([x["path"] for x in only["files"]], ["site/dashboard-data.js", "scripts/smoke_probe.py"])
        self.assertEqual(only["verdict"], "trivial")
        self.assertEqual(substance.classify_diff("")["verdict"], "record")


class Tree(Repo):
    def test_us_29_r09_the_working_tree_counts_untracked_files_as_added(self):
        self.w.write_text("export const LIMIT = 71;\nexport function f(x) { return x > LIMIT; }\n")
        self.assertEqual(substance.classify_range(None, self.d)["verdict"], "trivial")
        (self.d / "site/new.js").write_text("export const g = () => 1;\n")
        self.assertEqual(substance.classify_range(None, self.d)["verdict"], "substantive")

    def test_us_29_r09_a_range_that_git_cannot_read_is_an_error_and_never_a_verdict(self):
        with self.assertRaises(RuntimeError):
            substance.classify_range("deadbeef..HEAD", self.d)


class Gate(unittest.TestCase):
    def run_gate(self, verdict, env, *flags):
        res = {"verdict": verdict, "files": [], "behaviour": []}
        with mock.patch.object(substance, "classify_range", return_value=res), mock.patch.dict(os.environ, env):
            return substance.main(["--gate", *flags, "--range", "a...b"])

    def test_us_29_r10_without_executor_the_gate_refuses_anything_that_is_not_substantive(self):
        self.assertEqual(self.run_gate("trivial", {}), 3)
        self.assertEqual(self.run_gate("record", {}), 3)
        self.assertEqual(self.run_gate("substantive", {}), 0)

    def test_us_29_r10_with_executor_the_gate_refuses_an_executor_pr_and_a_trivial_pr_of_a_bot_and_passes_the_rest(self):
        e = lambda body, author: {"PR_BODY": body, "PR_AUTHOR": author}  # noqa: E731
        self.assertEqual(self.run_gate("trivial", e("Executor run 2026-11-25T01:00", "github-actions[bot]"), "--executor"), 3)
        self.assertEqual(self.run_gate("record", e("Executor run 2026-11-25T01:00", "github-actions[bot]"), "--executor"), 3, "an executor PR must change behaviour")
        self.assertEqual(self.run_gate("trivial", e("", "ultrastable-1[bot]"), "--executor"), 3, "a system-opened PR whose code change is trivial")
        self.assertEqual(self.run_gate("record", e("", "github-actions[bot]"), "--executor"), 0, "a records-only bookkeeping PR passes")
        self.assertEqual(self.run_gate("trivial", e("", "a-person"), "--executor"), 0, "a person's PR is not the gate's business")
        self.assertEqual(self.run_gate("substantive", e("Executor run x", "github-actions[bot]"), "--executor"), 0)
        self.assertTrue(substance.is_executor_pr("Executor run 2026-11-25", substance.cfg()))
        self.assertFalse(substance.is_executor_pr("", substance.cfg()))


class Scenario(unittest.TestCase):
    def test_us_29_t07_an_executor_change_that_only_bumps_a_hash_and_an_import_is_refused_and_one_that_changes_behaviour_passes(self):
        trivial = substance.classify_diff(DIFF.split("diff --git a/foundation/new.py")[0])
        self.assertEqual(trivial["verdict"], "trivial")
        for res, want in ((trivial, 3), (substance.classify_diff(DIFF), 0)):
            with mock.patch.object(substance, "classify_range", return_value=res), mock.patch.dict(os.environ, {"PR_BODY": "Executor run 2026-11-25T01:00:00Z", "PR_AUTHOR": "github-actions[bot]"}):
                self.assertEqual(substance.main(["--gate", "--executor", "--range", "a...b"]), want)


class Deploy(Repo):
    NOW = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)

    def test_us_29_r11_a_push_with_no_behaviour_change_deploys_only_when_the_newest_live_deploy_is_old_or_unknown(self):
        (self.d / "ops/deploys.jsonl").write_text(json.dumps({"at": (self.NOW - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"), "live_matches_commit": True, "sha": "x"}) + "\n")
        self.commit()
        self.w.write_text("export const LIMIT = 72;\nexport function f(x) { return x > LIMIT; }\n"); self.commit()
        d = substance.deploy_decision("HEAD~1..HEAD", ["site/**"], self.d, now=self.NOW)
        self.assertFalse(d["deploy"], d)
        self.assertIn("2.0 h old < 20 h", d["why"])
        late = substance.deploy_decision("HEAD~1..HEAD", ["site/**"], self.d, now=self.NOW + timedelta(hours=30))
        self.assertTrue(late["deploy"]); self.assertIn("refreshing data", late["why"])
        self.assertEqual(substance.cfg(self.d)["deploy"]["max_age_hours"], 20)

    def test_us_29_r11_a_behaviour_change_an_unreadable_range_and_an_unknown_deploy_age_all_deploy(self):
        self.w.write_text("export const LIMIT = 70;\nexport function f(x) { return x >= LIMIT; }\n"); self.commit()
        self.assertTrue(substance.deploy_decision("HEAD~1..HEAD", ["site/**"], self.d, now=self.NOW)["deploy"])
        self.assertTrue(substance.deploy_decision("deadbeef..HEAD", ["site/**"], self.d, now=self.NOW)["deploy"], "an unknown base never skips a deploy")
        self.w.write_text("export const LIMIT = 99;\nexport function f(x) { return x >= LIMIT; }\n"); self.commit()
        d = substance.deploy_decision("HEAD~1..HEAD", ["site/**"], self.d, now=self.NOW)
        self.assertTrue(d["deploy"]); self.assertIn("unknown", d["why"], "no live deploy row at all")

    def test_us_29_r11_a_deploy_row_that_neither_matched_nor_uploaded_is_not_a_live_deploy(self):
        (self.d / "ops/deploys.jsonl").write_text(json.dumps({"at": "2026-11-21T11:00:00Z", "live_matches_commit": False}) + "\nnot json\n"
                                                  + json.dumps({"at": "2026-11-21T10:00:00Z", "uploaded": True}) + "\n")
        age = substance.last_deploy_age_h(self.d, now=self.NOW)
        self.assertAlmostEqual(age, 2.0, places=2)


class Report(Repo):
    def test_us_29_r12_commits_are_split_by_origin_and_verdict_and_the_state_is_read_from_the_systems_own_commits(self):
        self.w.write_text("export const LIMIT = 71;\nexport function f(x) { return x > LIMIT; }\n"); self.commit("bump", author="exec[bot]")
        self.w.write_text("export const LIMIT = 71;\nexport function f(x) { return x >= LIMIT; }\n"); self.commit("fix by a person")
        (self.d / "ops/x.jsonl").write_text("{}\n"); self.commit("lane: record [skip ci]")
        self.w.write_text("export const LIMIT = 71;\nexport function f(x) { return x >= LIMIT && true; }\n"); self.commit("executor work", body="Executor run 2026-11-25T01:00:00Z")
        r = substance.report(self.d, days=7)
        self.assertEqual(r["by_origin"]["system"], {"substantive": 1, "trivial": 1, "record": 0})
        self.assertEqual(r["by_origin"]["session"]["substantive"], 1)
        self.assertEqual(r["by_origin"]["bookkeeping"]["record"], 1)
        self.assertEqual(r["state"], "shipping")
        self.assertEqual(r["system_trivial"], 1)
        self.assertEqual(r["system_substantive_share"], 0.5)
        self.assertEqual(r["substantive_share"], round(2 / 3, 3), "bookkeeping commits are not in the share")
        self.assertEqual(r["marker"], "SUBSTANCE-1")

    def test_us_29_r12_a_system_that_commits_only_trivia_is_trivial_only_and_one_that_commits_nothing_is_stalled(self):
        self.w.write_text("export const LIMIT = 73;\nexport function f(x) { return x > LIMIT; }\n"); self.commit("bump", author="bot[bot]")
        r = substance.report(self.d, days=7)
        self.assertEqual(r["state"], "trivial-only")
        self.assertIsNone(r["hours_since_substantive_system"])
        quiet = substance.report(self.d, days=7, now=datetime.now(timezone.utc) + timedelta(hours=72))
        self.assertEqual(quiet["state"], "stalled")
        self.assertEqual(substance.origin_of("a", "a@a", "x [skip ci]", "", substance.cfg()), "bookkeeping")
        self.assertEqual(substance.origin_of("a", "a@a", "x", "Executor run 1", substance.cfg()), "system")
        self.assertEqual(substance.origin_of("a[bot]", "a@a", "x", "", substance.cfg()), "system")
        self.assertEqual(substance.origin_of("person", "p@p", "x", "", substance.cfg()), "session")

    def test_us_29_r13_the_targets_fail_on_a_trivial_system_change_a_low_share_or_a_state_that_is_not_shipping(self):
        c = substance.cfg()
        ok = {"system_trivial": 0, "substantive_share": 0.9, "state": "shipping"}
        self.assertEqual(substance.check_targets(ok, c), [])
        bad = substance.check_targets({"system_trivial": 2, "substantive_share": 0.1, "state": "trivial-only"}, c)
        self.assertEqual(len(bad), 3)
        self.assertTrue(any(b.startswith("system_trivial 2 > 0") for b in bad))
        self.assertTrue(any("substantive_share 0.1 < 0.5" in b for b in bad))
        self.assertTrue(any("state trivial-only" in b and "48 h" in b for b in bad))
        self.assertEqual(substance.check_targets({"system_trivial": 0, "substantive_share": None, "state": "shipping"}, c), [], "no commit to measure is not a breach of the share")

    def test_us_29_r13_the_config_check_names_a_missing_key_and_a_vector_that_no_longer_holds(self):
        cfg = json.loads((self.d / substance.CONFIG).read_text(encoding="utf-8"))
        del cfg["targets"]
        (self.d / substance.CONFIG).write_text(json.dumps(cfg), encoding="utf-8")
        vec = json.loads((self.d / substance.VECTORS).read_text(encoding="utf-8"))
        vec["cases"][0]["expect"] = "behaviour"
        (self.d / substance.VECTORS).write_text(json.dumps(vec), encoding="utf-8")
        errs = substance.check(self.d)
        self.assertTrue(any("missing targets" in e for e in errs))
        self.assertTrue(any(e.startswith("vector ") for e in errs))

    def _without(self, key):
        cfg = json.loads((self.d / substance.CONFIG).read_text(encoding="utf-8"))
        del cfg[key]
        (self.d / substance.CONFIG).write_text(json.dumps(cfg), encoding="utf-8")

    def _whole(self):
        (self.d / substance.CONFIG).write_text((ROOT / substance.CONFIG).read_text(encoding="utf-8"), encoding="utf-8")

    def test_us_29_r13_a_missing_deploy_key_is_named_and_a_missing_doc_keys_is_named_and_shows_as_the_vectors_it_breaks(self):
        self._without("deploy")
        self.assertEqual(substance.check(self.d), [f"{substance.CONFIG}: missing deploy"])
        self._whole()
        self._without("doc_keys")
        errs = substance.check(self.d)
        self.assertIn(f"{substance.CONFIG}: missing doc_keys", errs)
        self.assertTrue(any(e.startswith("vector ") and "expected comment" in e for e in errs), errs)

    # Changed deliberately with the fix of check(): the earlier test pinned the defect (a KeyError for these four keys); it now pins the named result.
    def test_us_29_r76_a_missing_classifier_key_is_named_in_the_result_and_does_not_raise(self):
        for key in substance.CLASSIFIER_KEYS:
            with self.subTest(key):
                self._whole()
                self._without(key)
                errs = substance.check(self.d)
                self.assertEqual(errs, [f"{substance.CONFIG}: missing {key}"], "the key is named and no vector is classified without it")
        self._whole()
        self._without("code_ext"); cfg = json.loads((self.d / substance.CONFIG).read_text(encoding="utf-8")); del cfg["targets"]
        (self.d / substance.CONFIG).write_text(json.dumps(cfg), encoding="utf-8")
        self.assertEqual(substance.check(self.d), [f"{substance.CONFIG}: missing code_ext", f"{substance.CONFIG}: missing targets"], "every missing key is named")


if __name__ == "__main__":
    unittest.main()

"""Executor: driver-order pick, path guard, edits, no-credential recording."""
import json, os, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import executor  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (removed when the run ends)

I = lambda n, labels=(), **k: {"number": n, "title": f"t{n}", "labels": [{"name": l} for l in labels], "updated_at": "2026-11-12T00:00:00Z", **k}


class Executor(unittest.TestCase):
    def test_pick_driver_order_and_skips(self):
        issues = [I(1, ["hold"]), I(2), I(3, ["p1"]), I(4, ["p0"], pull_request={}), I(5, ["owner"])]
        self.assertEqual(executor.pick(issues)["number"], 3)
        self.assertIsNone(executor.pick([I(1, ["blocked"])]))

    def test_stale_claim_is_retaken_fresh_is_not(self):
        import datetime as dt
        at = dt.datetime(2026, 11, 12, 1, 0, tzinfo=dt.timezone.utc)
        self.assertIsNone(executor.pick([I(1, ["in-progress"])], at))
        at2 = dt.datetime(2026, 11, 12, 4, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(executor.pick([I(1, ["in-progress"])], at2)["number"], 1)

    def test_path_guard(self):
        for bad in ("/etc/x", "../x", ".github/workflows/a.yml", "autonomy/policy.json", ".git/config", "a/.env"):
            self.assertIsNotNone(executor.safe_path(bad), bad)
        self.assertIsNone(executor.safe_path("docs/a.md"))

    def test_apply_edits_writes_and_rejects(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(executor.apply_edits([{"path": "docs/a.md", "content": "x"}], d), ["docs/a.md"])
            self.assertEqual((Path(d) / "docs/a.md").read_text(), "x")
            with self.assertRaises(ValueError):
                executor.apply_edits([{"path": ".github/workflows/x.yml", "content": "x"}], d)
            with self.assertRaises(ValueError):
                executor.apply_edits([], d)

    def test_no_model_credential_is_recorded_not_hidden(self):
        import os, unittest.mock as m
        with tempfile.TemporaryDirectory() as d, m.patch.object(executor, "gh_json", return_value=[I(7)]), m.patch.dict(os.environ, {"EXECUTOR_SOURCE": "issues"}, clear=True):
            row = executor.run("o/r", apply=True, root=d)
            self.assertEqual(row["result"], "no-model-credential")
            line = json.loads((Path(d) / executor.LOG).read_text().splitlines()[0])
            self.assertEqual(line["issue"], 7)
            self.assertIn("within 24 h", line["prediction"])

    def test_pick_and_record_need_no_model_key(self):
        import os, unittest.mock as m
        with m.patch.object(executor, "gh_json", return_value=[I(3), I(2)]), m.patch.dict(os.environ, {"EXECUTOR_SOURCE": "issues"}, clear=True):
            self.assertEqual(executor.pick_row("o/r")["issue"], 2)

    def test_needs_you_page_is_current_and_link_only(self):
        from foundation import needsyou
        self.assertEqual(needsyou.check(), [])


class Baseline(unittest.TestCase):
    OUT = "FAIL: test_a (test_m.C.test_a)\n---\nERROR: test_b (test_m.C.test_b)\nFAIL: test_a (test_m.C.test_a)\n"

    def test_failing_tests_are_parsed_once_each(self):
        self.assertEqual(executor.failing_tests(self.OUT), [("test_a", "test_m.C.test_a"), ("test_b", "test_m.C.test_b")])
        self.assertEqual(executor.failing_tests("OK"), [])

    def test_only_failures_that_predate_the_change_are_baseline(self):
        import subprocess
        d = Path(scratch()); (d / "tests/foundation").mkdir(parents=True)
        (d / "tests/foundation/test_m.py").write_text("import unittest\nclass C(unittest.TestCase):\n    def test_old(self): self.fail('red on main')\n    def test_new(self): pass\n")
        g = lambda *a: subprocess.run(["git", *a], cwd=d, check=True, capture_output=True)
        g("init", "-q"); g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x")
        got = executor.preexisting_failures([("test_old", "test_m.C.test_old"), ("test_new", "test_m.C.test_new")], d)
        self.assertEqual(got, {"test_m.C.test_old"})  # test_new passes on the committed tree, so a failure of it would be the change's own


if __name__ == "__main__":
    unittest.main()


NL = chr(10)


class QueueMode(unittest.TestCase):
    """QUEUE-1: the executor works repository-data items, needs no GitHub Issues, and the merge of its PR is the closure."""

    def _repo(self, d):
        (Path(d) / "docs/issues").mkdir(parents=True)
        for n, lab in (("Q-1", "p2"), ("Q-2", "p1")):
            body = NL.join(["**Owner:** executor", "**Trigger:** tick", "**Done check:** file:x", "**Status:** open", "", f"work {n}"])
            (Path(d) / f"docs/issues/{n}.json").write_text(json.dumps({"id": n, "title": n, "body": body, "labels": [lab]}))
        (Path(d) / "docs/issues/Q-3.json").write_text(json.dumps({"id": "Q-3", "title": "owner", "labels": ["p0"], "body": NL.join(["**Owner:** ROWAN", "**Trigger:** t", "**Done check:** file:x", "**Status:** open"])}))

    def test_takeable_skips_owner_items_and_orders_by_priority(self):
        with tempfile.TemporaryDirectory() as d:
            self._repo(d)
            from foundation import queue
            self.assertEqual(executor.pick(queue.takeable(d))["number"], "Q-2")
            self.assertEqual(sorted(i["number"] for i in queue.takeable(d)), ["Q-1", "Q-2"])

    def test_three_failures_park_an_item_and_close_requires_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            self._repo(d)
            from foundation import queue
            for _ in range(3):
                executor.log(d, {"issue": "Q-2", "result": "failed"})
            self.assertEqual([i["number"] for i in queue.takeable(d)], ["Q-1"])
            queue.close(d, "Q-1", "closed by the pull request that carries this change")
            self.assertEqual(queue.takeable(d), [])
            self.assertNotIn("Q-1: closed without evidence", "".join(queue.check(d)))


class Baseline(unittest.TestCase):
    OUT = "FAIL: test_a (test_m.C.test_a)\n---\nERROR: test_b (test_m.C.test_b)\nFAIL: test_a (test_m.C.test_a)\n"

    def test_failing_tests_are_parsed_once_each(self):
        self.assertEqual(executor.failing_tests(self.OUT), [("test_a", "test_m.C.test_a"), ("test_b", "test_m.C.test_b")])
        self.assertEqual(executor.failing_tests("OK"), [])

    def test_only_failures_that_predate_the_change_are_baseline(self):
        import subprocess
        d = Path(scratch()); (d / "tests/foundation").mkdir(parents=True)
        (d / "tests/foundation/test_m.py").write_text("import unittest\nclass C(unittest.TestCase):\n    def test_old(self): self.fail('red on main')\n    def test_new(self): pass\n")
        g = lambda *a: subprocess.run(["git", *a], cwd=d, check=True, capture_output=True)
        g("init", "-q"); g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x")
        got = executor.preexisting_failures([("test_old", "test_m.C.test_old"), ("test_new", "test_m.C.test_new")], d)
        self.assertEqual(got, {"test_m.C.test_old"})  # test_new passes on the committed tree, so a failure of it would be the change's own


if __name__ == "__main__":
    unittest.main()


class Ladder(unittest.TestCase):
    def test_ladder_call_is_defined_and_passes_the_attempt_to_the_rung(self):
        import unittest.mock as m
        from foundation import agent_ladder
        with m.patch.object(agent_ladder, "call", return_value=({"files": []}, {"model": "x"})) as c:
            self.assertEqual(executor.ladder_call("p", 2, ROOT)[1]["model"], "x")
        self.assertEqual(c.call_args.args[:2], ("p", 2))


class RepairLoop(unittest.TestCase):
    def test_repairs_and_server_side_constraint_are_in_the_code(self):
        from foundation import executor
        src = Path(executor.__file__).read_text(encoding="utf-8")
        self.assertGreaterEqual(executor.REPAIRS, 1)
        self.assertIn("YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS", src)
        self.assertIn("Server-side only: never reference localhost", executor.build_prompt({"number": 1, "title": "t", "body": ""}, ""))

    def test_cloudflare_dict_response_is_accepted(self):
        import io, os, urllib.request
        from unittest import mock
        body = json.dumps({"result": {"response": {"summary": "s", "files": []}}}).encode()
        with mock.patch.dict(os.environ, {"CLOUDFLARE_ACCOUNT_ID": "a", "CLOUDFLARE_API_TOKEN": "t"}), \
             mock.patch.object(urllib.request, "urlopen", return_value=io.BytesIO(body)):
            self.assertEqual(executor.call_cloudflare("p")["summary"], "s")

    def test_crossrepo_eligibility_and_pr_body(self):
        from foundation import crossrepo as cx
        ok = {"title": "packs: x", "body": "a\n\nClosing probe: file_exists:core/x.js", "labels": [{"name": "open-loop"}]}
        self.assertTrue(cx.eligible(ok))
        self.assertFalse(cx.eligible(dict(ok, labels=[{"name": "protected-change"}])))
        self.assertFalse(cx.eligible(dict(ok, title="EPIC: all")))
        self.assertFalse(cx.eligible(dict(ok, body="no probe here")))
        body = cx.pr_body(7, {"models": ["m"]}, "t")
        for field in ("Item: #7", "Spec:", "Prediction:", "Evidence:", "Author:", "Reviewer:", "Closes #7"):
            self.assertIn(field, body)

    def test_crossrepo_cap_stops_intake(self):
        from foundation import crossrepo as cx
        from unittest import mock
        with mock.patch.object(cx, "prs_today", return_value=cx.MAX_PRS_PER_DAY):
            self.assertEqual(cx.takeable("o/r"), [])

    def test_every_generated_file_checked_in_ci_is_regenerated_by_the_executor(self):
        """Root cause of repeated executor PR failures: a queue change made site/roadmap-data.js stale and the executor did not regenerate it."""
        ci = (Path(executor.__file__).resolve().parents[1] / ".github/workflows/checks.yml").read_text(encoding="utf-8")
        self.assertIn("build_site_roadmap.py --check", ci)
        self.assertIn(["python3", "scripts/build_site_roadmap.py"], executor.GENERATORS)

    def test_items_probed_in_protected_paths_are_not_takeable(self):
        from foundation import queue as q
        self.assertTrue(q.protected_probe("grep:.github/workflows/lane.yml::clock --heal"))
        self.assertTrue(q.protected_probe("file:autonomy/x.json"))
        self.assertFalse(q.protected_probe("file:foundation/x.py"))
        self.assertFalse(q.protected_probe(""))


class PortItems(unittest.TestCase):
    """PORT-EXEC-1: a PORT-<runtime> item closes on its adapter verify command; the evidence file is the change."""

    def test_verify_command_is_read_from_the_item_body(self):
        from foundation import executor
        self.assertEqual(executor.verify_command({"body": "x\nverify: python3 -c pass\ny"}), "python3 -c pass")
        self.assertIsNone(executor.verify_command({"body": "no command"}))

    def test_passing_verify_yields_the_evidence_file_and_failing_verify_raises(self):
        import sys
        from foundation import executor
        with tempfile.TemporaryDirectory() as d:
            ok = {"number": "PORT-gcp", "title": "t", "body": f"verify: {Path(sys.executable).as_posix()} -c pass"}
            out = executor.port_call(ok, d)("")
            self.assertEqual(out["files"][0]["path"], "ops/port-evidence/gcp-verify.json")
            self.assertEqual(json.loads(out["files"][0]["content"])["exit"], 0)
            self.assertIsNone(executor.safe_path(out["files"][0]["path"]))
            bad = {"number": "PORT-gcp", "title": "t", "body": f"verify: {Path(sys.executable).as_posix()} -c raise(SystemExit(3))"}
            with self.assertRaises(RuntimeError):
                executor.port_call(bad, d)


class Effect(unittest.TestCase):
    """EFFECT-1: items with executable effect are taken first; a change no code reads is rejected."""
    def test_effect_items_sort_first(self):
        a = {"number": "Q-GROW-x", "labels": [{"name": "p0"}]}
        b = {"number": "Q-CIFAIL-y", "labels": [{"name": "p5"}]}
        self.assertEqual(executor.pick([a, b])["number"], "Q-CIFAIL-y")
        self.assertEqual(executor.effect_tier({"number": "OL-1", "labels": ["bug"]}), 0)

    def test_data_file_nothing_reads_is_rejected(self):
        self.assertIn("no code consumer", executor.consumer_gap(["doctrine/never-read-anywhere-xyz.json"], ROOT))
        self.assertIn("no code consumer", executor.consumer_gap(["docs/issues/Q-X.json", "ops/x.jsonl"], ROOT))
        self.assertIsNone(executor.consumer_gap(["foundation/executor.py"], ROOT))

    def test_elision_marker_or_a_gutted_file_is_refused(self):
        import subprocess
        r = scratch()
        subprocess.run(["git", "init", "-q"], cwd=r, check=True)
        (r / "a.js").write_text("\n".join(f"export const v{i} = {i};" for i in range(60)) + "\n")
        (r / "b.py").write_text("x = 1\n")
        subprocess.run(["git", "add", "-A"], cwd=r, check=True)
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "-qm", "x"], cwd=r, check=True)
        self.assertIsNone(executor.elision_gap(["a.js", "b.py"], r))
        (r / "b.py").write_text("# ... existing code ...\nx = 2\n")
        self.assertIn("elision marker", executor.elision_gap(["b.py"], r))
        (r / "a.js").write_text("export const v0 = 0;\n")
        self.assertIn("shrink", executor.elision_gap(["a.js"], r))
        self.assertIsNone(executor.consumer_gap(["doctrine/code-agents.json"], ROOT))  # read by foundation/agents.py

    def test_a_config_that_loses_its_keys_is_refused(self):  # SCHEMA-KEEP-1: 54d6e57e7 replaced actions-budget.json with an unrelated document
        import subprocess
        r = scratch()
        subprocess.run(["git", "init", "-q"], cwd=r, check=True)
        (r / "c.json").write_text('{"_doc": "d", "essential": [], "monthly_free_minutes": 2000}')
        subprocess.run(["git", "add", "-A"], cwd=r, check=True)
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "-qm", "x"], cwd=r, check=True)
        self.assertIsNone(executor.contract_gap(["c.json"], r))
        (r / "c.json").write_text('{"_doc": "d2", "essential": [], "monthly_free_minutes": 2000, "extra": 1}')
        self.assertIsNone(executor.contract_gap(["c.json"], r), "adding a key is fine")
        (r / "c.json").write_text('{"id": "free-tier-meter:spend", "budget": {}}')
        self.assertIn("essential", executor.contract_gap(["c.json"], r)); self.assertIn("SCHEMA-KEEP-1", executor.contract_gap(["c.json"], r))
        self.assertIsNone(executor.contract_gap(["new.json"], r), "a new file has nothing to keep")


class ForeignCifail(unittest.TestCase):
    def test_other_repos_ci_item_is_not_takeable_here(self):  # FOREIGN-FIX-1
        from foundation import executor
        other = {"number": "Q-CIFAIL-practical-solutions-deploy-tenant", "title": "Q-CIFAIL-x: deploy-tenant is failing in ultrastable/practical-solutions"}
        own = {"number": "Q-CIFAIL-ultrastable-checks", "title": "Q-CIFAIL-y: checks is failing in ultrastable/ultrastable"}
        self.assertTrue(executor.foreign_cifail(other, "ultrastable/ultrastable"))
        self.assertFalse(executor.foreign_cifail(own, "ultrastable/ultrastable"))
        self.assertFalse(executor.foreign_cifail({"number": 5, "title": "something is failing in a/b"}, "ultrastable/ultrastable"))


class WatchdogTests(unittest.TestCase):
    def test_hung_run_records_a_stall_row_and_exits_clean(self):
        import io, contextlib, time
        from unittest import mock
        from foundation import executor
        rows = []
        with mock.patch.dict(os.environ, {"EXECUTOR_WATCHDOG_S": "1"}), \
             mock.patch.object(executor, "run", side_effect=lambda *a, **k: time.sleep(5)), \
             mock.patch.object(executor, "log", side_effect=lambda root, row: rows.append(row)), \
             contextlib.redirect_stdout(io.StringIO()):
            rc = executor.main(["--apply"])
        self.assertEqual(rc, 0)
        self.assertEqual(rows[0]["result"], "stalled")


class StallIsNotSwallowed(unittest.TestCase):
    """EXEC-WATCHDOG-2: measured 2026-11-19, every run recorded `failed: _Stall:` because run()'s `except Exception` caught the watchdog's signal."""

    def test_stall_inside_run_records_the_item_as_stalled(self):
        import io, contextlib, time
        from unittest import mock
        rows = []
        def fake_run(*a, **k):
            executor.LAST_ROW.update(issue="Q-9", title="t", models=["m"])
            try:
                time.sleep(5)
            except Exception as e:  # the swallow path run() has; a BaseException passes through it
                return {"result": "failed", "detail": f"{type(e).__name__}: {e}"}
            return {"result": "failed", "detail": "slept"}
        self.assertTrue(issubclass(executor.Stall, BaseException) and not issubclass(executor.Stall, Exception))
        if not hasattr(__import__("signal"), "SIGALRM"):
            self.skipTest("no SIGALRM on this platform")
        with mock.patch.dict(os.environ, {"EXECUTOR_WATCHDOG_S": "1"}), mock.patch.object(executor, "run", side_effect=fake_run), \
             mock.patch.object(executor, "log", side_effect=lambda root, row: rows.append(row)), contextlib.redirect_stdout(io.StringIO()):
            rc = executor.main(["--apply"])
        self.assertEqual(rc, 0)
        self.assertEqual((rows[0]["result"], rows[0]["issue"], rows[0]["models"]), ("stalled", "Q-9", ["m"]))

    def test_no_new_attempt_starts_without_time_for_it(self):
        import subprocess, time
        from unittest import mock
        d = scratch()
        (d / "docs/issues").mkdir(parents=True)
        body = "\n".join(["**Owner:** executor", "**Trigger:** tick", "**Done check:** file:x", "**Status:** open", "", "work"])
        (d / "docs/issues/Q-1.json").write_text(json.dumps({"id": "Q-1", "title": "one", "body": body, "labels": ["p1"]}))
        for c in (["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "i"]):
            subprocess.run(["git", *c], cwd=d, check=True, capture_output=True)
        calls = []
        def model(prompt):
            calls.append(prompt); return {"files": [{"path": ".github/workflows/x.yml", "content": "x"}]}  # deny list: an unusable reply
        with mock.patch.object(executor, "DEADLINE", [time.monotonic() + 5]), mock.patch.dict(os.environ, {"EXECUTOR_SOURCE": "queue"}):
            row = executor.run("o/r", apply=True, issue_no="Q-1", root=d, model_call=model, checks=[])
        self.assertEqual(len(calls), 1)
        self.assertIn("out_of_time", row)
        self.assertEqual(row["result"], "failed")
        self.assertIn("checks failed after 1 attempts", row["detail"])


class TargetedChecks(unittest.TestCase):
    """CHECKS-TARGETED-1: the pre-PR checks are the tests related to the change, not the whole suite that cannot finish inside the watchdog."""

    def test_related_tests_follow_imports_and_names(self):
        rel = executor.related_tests(["foundation/agent_ladder.py", "docs/notes.md"])
        self.assertIn("test_agent_ladder.py", rel)
        self.assertIn("test_executor.py", rel)  # imports foundation.agent_ladder by name
        self.assertEqual(executor.related_tests(["docs/notes.md"]), [])
        self.assertEqual(executor.related_tests(["tests/foundation/test_clock.py"]), ["test_clock.py"])

    def test_checks_compile_changed_python_and_run_related_modules_only(self):
        from unittest import mock
        with mock.patch.dict(os.environ, {"EXECUTOR_CHECKS": ""}):
            cs = executor.checks_for(["foundation/clock.py"])
        self.assertEqual(cs[0], executor.CHECKS[0])
        self.assertIn(["python3", "-m", "py_compile", "foundation/clock.py"], cs)
        self.assertIn(["python3", "-m", "unittest", "discover", "-s", "tests/foundation", "-p", "test_clock.py"], cs)
        self.assertNotIn(executor.CHECKS[1], cs)
        with mock.patch.dict(os.environ, {"EXECUTOR_CHECKS": "full"}):
            self.assertEqual(executor.checks_for(["foundation/clock.py"]), executor.CHECKS)


class PrRepair(unittest.TestCase):
    """PR-REPAIR-1 (OL-20261113-2): an OL-PR-<n> item is repaired on the pull request's own branch; only after two failed repairs is the change redone from main and the pull request superseded."""

    def _world(self):
        import subprocess
        from _repo import git
        origin, d = scratch(), scratch()
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True, capture_output=True)
        git(d, "init", "-q", "-b", "main"); git(d, "remote", "add", "origin", str(origin))
        (d / "docs/issues").mkdir(parents=True)
        body = "\n".join(["**Owner:** operations", "**Trigger:** lane pass", "**Done check:** cmd:python3 -m foundation loopowner --closed 9", "**Status:** open", "", "land or supersede pull request #9"])
        (d / "docs/issues/OL-PR-9.json").write_text(json.dumps({"id": "OL-PR-9", "title": "OL-PR-9: land or supersede pull request #9 (ci-failed)", "body": body, "labels": ["p1"]}))
        (d / "a.txt").write_text("a\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "base"); git(d, "push", "-q", "origin", "main")
        git(d, "checkout", "-q", "-b", "agent/feature"); (d / "b.txt").write_text("broken\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "feature"); git(d, "push", "-q", "origin", "agent/feature")
        git(d, "checkout", "-q", "main"); (d / "c.txt").write_text("newer main\n"); git(d, "add", "-A"); git(d, "commit", "-qm", "main moves"); git(d, "push", "-q", "origin", "main")
        return origin, d

    def _run(self, d, model):
        from unittest import mock
        real, gh = executor.sh, []
        def sh(argv, root=executor.REPO, timeout=600):
            if argv[0] == "gh":
                gh.append(argv[1:4])
                return 0, "https://github.com/o/r/pull/77" if argv[1:3] == ["pr", "create"] else "tests/foundation/test_b.py FAILING test_b: AssertionError: broken"
            if argv[0] == "python3":
                return 0, ""  # write-back and the generated-file resolver are not under test here
            return real(argv, root, timeout)
        def gh_json(args, root=None):
            return {"state": "OPEN", "headRefName": "agent/feature", "isCrossRepository": False, "title": "feature", "files": [{"path": "b.txt"}]} if args[:2] == ["pr", "view"] else [{"databaseId": 5, "name": "checks"}]
        with mock.patch.object(executor, "sh", sh), mock.patch.object(executor, "gh_json", gh_json), mock.patch.dict(os.environ, {"EXECUTOR_SOURCE": "queue"}):
            return executor.run("o/r", apply=True, issue_no="OL-PR-9", root=d, model_call=model, checks=[]), gh

    def test_the_pull_request_branch_is_repaired_in_place_with_the_failed_log_in_the_prompt(self):
        from _repo import git
        origin, d = self._world()
        prompts = []
        def model(prompt):
            prompts.append(prompt); return {"summary": "fix b", "files": [{"path": "b.txt", "content": "fixed\n"}]}
        row, gh = self._run(d, model)
        self.assertEqual((row["result"], row["mode"], row["repairs_pr"]), ("pr-repaired", "pr-repair", 9), row)
        self.assertIn("REPAIRING PULL REQUEST #9", prompts[0]); self.assertIn("FAILING test_b", prompts[0]); self.assertIn("b.txt", prompts[0])
        self.assertEqual(git(origin, "show", "agent/feature:b.txt"), "fixed\n", "the fix is pushed to the pull request's own branch")
        self.assertEqual(git(origin, "show", "agent/feature:c.txt"), "newer main\n", "main was merged into the branch")
        self.assertIn("feature", git(origin, "log", "--format=%s", "agent/feature"), "the pull request's own commits are kept, not replaced")
        self.assertNotIn(["pr", "create", "-R"], gh, "no second pull request is opened")
        self.assertIn(["workflow", "run", "checks.yml"], gh, "checks are started on the repaired branch so the lane can merge it")
        self.assertIn("**Status:** closed", json.loads(git(origin, "show", "agent/feature:docs/issues/OL-PR-9.json"))["body"])

    def test_after_two_failed_repairs_the_change_is_redone_from_main_and_the_pull_request_superseded(self):
        from _repo import git
        origin, d = self._world()
        for _ in range(2):
            executor.log(d, {"issue": "OL-PR-9", "result": "failed", "mode": "pr-repair"})
        self.assertEqual(executor.pr_repair_failures("OL-PR-9", d), 2)
        prompts = []
        def model(prompt):
            prompts.append(prompt); return {"summary": "redo", "files": [{"path": "b.py", "content": "def b():\n    return 2\n"}]}  # SUBSTANCE-1: a code change, not a record
        row, gh = self._run(d, model)
        self.assertEqual((row["result"], row.get("superseded_pr")), ("pr-opened", 9), row)
        self.assertNotIn("REPAIRING PULL REQUEST", prompts[0])
        self.assertEqual(git(origin, "show", "agent/feature:b.txt"), "broken\n", "the old branch is left as it was")
        self.assertIn(["pr", "close", "9"], gh, "the old pull request is closed as superseded, naming its replacement")

    def test_a_change_with_no_executable_effect_opens_no_pull_request(self):  # SUBSTANCE-1
        origin, d = self._world()
        for _ in range(2):
            executor.log(d, {"issue": "OL-PR-9", "result": "failed", "mode": "pr-repair"})
        row, gh = self._run(d, lambda prompt: {"summary": "touch", "files": [{"path": "notes.txt", "content": "x\n"}]})
        self.assertEqual(row["result"], "failed", row)
        self.assertIn("rejected-trivial", row["detail"])
        self.assertNotIn(["pr", "create", "-R"], gh)

    def test_a_closed_or_forked_pull_request_is_not_repaired(self):
        from unittest import mock
        _, d = self._world()
        for pr in ({"state": "MERGED", "headRefName": "agent/feature"}, {"state": "OPEN", "headRefName": "agent/feature", "isCrossRepository": True}, {"state": "OPEN", "headRefName": "main"}):
            with mock.patch.object(executor, "gh_json", return_value=pr):
                self.assertIsNone(executor.pr_repair({"number": "OL-PR-9"}, "o/r", d))
        self.assertIsNone(executor.pr_repair({"number": "Q-1"}, "o/r", d))

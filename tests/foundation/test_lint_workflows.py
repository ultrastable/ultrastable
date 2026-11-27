# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-24-R19: the workflow budget lint (scripts/lint_workflows.py) runs on the real workflow files as a test, and each of its rules
(US-24-R11, R12, R14, R15, R56) is shown to fire on a workflow that breaks it. The kill switch for non-essential workflows
(scripts/actions_guard.py, US-24-R25) leaves an essential or unpaused workflow alone without calling the code host, exempts a public
repository and fails a run it cannot cancel (US-24-R59)."""
import contextlib, importlib.util, io, json, os, tempfile, unittest
from unittest import mock
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _load(name):
    spec = importlib.util.spec_from_file_location(name, REPO / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _lint(cwd):
    lint, out, old = _load("lint_workflows"), io.StringIO(), os.getcwd()
    os.chdir(cwd)
    try:
        with contextlib.redirect_stdout(out):
            code = lint.main()
    finally:
        os.chdir(old)
    return code, out.getvalue()


GOOD = """# budget: 2 min a run
# trigger: push, because the check reads the change
# free-alternative: the tick Worker's gate
name: ok
on:
  pull_request:
  schedule:
    - cron: '17 3 * * *'
concurrency: {group: ok, cancel-in-progress: true}
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps: [{run: 'true'}]
"""


class LintWorkflows(unittest.TestCase):
    def _one(self, text):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / ".github" / "workflows").mkdir(parents=True)
            (Path(d) / ".github" / "workflows" / "w.yml").write_text(text, encoding="utf-8")
            return _lint(d)

    def test_real_workflows_pass(self):
        code, out = _lint(REPO)
        self.assertEqual(code, 0, out)
        self.assertIn("0 problem(s)", out)

    def test_a_daily_schedule_with_headers_timeout_and_concurrency_passes(self):
        """US-24-T09: a daily cron that carries all three header comments passes."""
        self.assertEqual(self._one(GOOD)[0], 0)

    def test_each_rule_fires(self):
        """US-24-R56 US-24-T09: an hourly cron, a missing header comment and a matrix each fail and name their rule."""
        cases = {
            "missing header comment '# budget:'": GOOD.replace("# budget: 2 min a run\n", ""),
            "missing header comment '# trigger:'": GOOD.replace("# trigger: push, because the check reads the change\n", ""),
            "missing header comment '# free-alternative:'": GOOD.replace("# free-alternative: the tick Worker's gate\n", ""),
            "has no timeout-minutes": GOOD.replace("    timeout-minutes: 5\n", ""),
            "uses a matrix": GOOD.replace("    timeout-minutes: 5\n", "    timeout-minutes: 5\n    strategy: {matrix: {v: [1, 2]}}\n"),
            "runs more than daily": GOOD.replace("17 3 * * *", "17 * * * *"),
            "needs a concurrency group": GOOD.replace("concurrency: {group: ok, cancel-in-progress: true}\n", ""),
        }
        for want, text in cases.items():
            code, out = self._one(text)
            self.assertEqual(code, 1, want)
            self.assertIn(want, out)
        self.assertIn("runs more than daily", self._one(GOOD.replace("17 3 * * *", "*/10 3 * * *"))[1])


class ActionsGuard(unittest.TestCase):
    def _run(self, cfg, name):
        guard, old = _load("actions_guard"), os.getcwd()
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "actions-budget.json").write_text(json.dumps(cfg), encoding="utf-8")
            os.chdir(d)
            try:
                return guard.main(name)
            finally:
                os.chdir(old)

    def test_essential_and_unpaused_workflows_run_with_no_call_to_the_code_host(self):
        """US-24-R59: an essential workflow always runs, even with the budget paused."""
        # neither branch reads GITHUB_REPOSITORY or calls gh: a KeyError here would mean the guard went on to cancel
        self.assertEqual(self._run({"paused": True, "essential": ["checks"]}, "checks"), 0)
        self.assertEqual(self._run({"paused": False, "paused_workflows": ["scout"], "essential": []}, "uiux"), 0)

    def test_us_24_r59_a_public_repository_is_exempt_from_the_pause_and_a_run_the_pause_cannot_cancel_fails(self):
        guard, old = _load("actions_guard"), os.getcwd()
        calls = []
        def fake(answers):
            def run(cmd, capture_output=True, text=True):
                calls.append(" ".join(cmd))
                return answers.pop(0)
            return run
        ok = lambda out="": mock.Mock(returncode=0, stdout=out, stderr="")
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "actions-budget.json").write_text(json.dumps({"paused": True, "essential": ["checks"]}), encoding="utf-8")
            os.chdir(d)
            try:
                env = {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "9"}
                with mock.patch.dict("os.environ", env), mock.patch.object(guard.subprocess, "run", fake([ok("false")])):
                    self.assertEqual(guard.main("scout"), 0, "a public repository: no minute is billed, the pause does not apply")
                self.assertEqual(len(calls), 1, "only the visibility was read; nothing was cancelled")
                with mock.patch.dict("os.environ", env), mock.patch.object(guard.subprocess, "run", fake([ok("true"), mock.Mock(returncode=1, stdout="", stderr="forbidden")])):
                    self.assertEqual(guard.main("scout"), 1, "a pause that cannot cancel the run fails it, so no work runs")
                with mock.patch.dict("os.environ", env), mock.patch.object(guard.subprocess, "run", fake([ok("true"), ok()])), mock.patch.object(guard.time, "sleep", lambda s: None):
                    self.assertEqual(guard.main("scout"), 0, "a private repository's paused run is cancelled")
                self.assertTrue(any("/cancel" in str(c) for c in calls))
            finally:
                os.chdir(old)

    def test_the_committed_budget_names_the_essential_workflows(self):
        cfg = json.loads((REPO / "actions-budget.json").read_text("utf-8"))
        self.assertIn("checks", cfg["essential"])
        for name in cfg["essential"]:
            self.assertTrue((REPO / ".github" / "workflows" / f"{name}.yml").is_file(), name)


if __name__ == "__main__":
    unittest.main()


class PrRange(unittest.TestCase):
    def test_pr_gates_measure_against_the_merge_parent(self):
        """#2767: base.sha goes stale when main moves, and the merge ref then counts main's commits as the PR's."""
        text = (REPO / ".github/workflows/checks.yml").read_text()
        self.assertNotIn('"${BASE_SHA}...HEAD"', text)
        self.assertIn('prsize.py --range "HEAD^1...HEAD"', text)

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import workflow_lint as wl  # noqa: E402

CONC = "concurrency:\n  group: x-${{ github.ref }}\n  cancel-in-progress: true\n"
GOOD = """name: x
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
""" + CONC + """jobs:
  t:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - run: echo hi
"""


def rules(text):
    return sorted({f.split()[1] for f in wl.lint_text(text)})


class LintTests(unittest.TestCase):
    def test_good_workflow_is_clean(self):
        self.assertEqual(wl.lint_text(GOOD), [])

    def test_missing_permissions_concurrency_timeout(self):
        bad = GOOD.replace("permissions:\n  contents: read\n", "").replace(CONC, "").replace("    timeout-minutes: 5\n", "")
        self.assertEqual(rules(bad), ["W01", "W02", "W03"])

    def test_concurrency_justification_comment_is_accepted(self):
        self.assertEqual(wl.lint_text(GOOD.replace(CONC, "# no-concurrency: single manual job\n")), [])

    def test_timeout_over_limit(self):
        self.assertEqual(rules(GOOD.replace("timeout-minutes: 5", "timeout-minutes: 360")), ["W03"])

    def test_schedule_forbidden(self):
        self.assertEqual(rules(GOOD.replace("  push:", "  schedule:\n    - cron: '0 * * * *'\n  push:")), ["W04"])

    def test_commented_schedule_is_ignored(self):
        self.assertEqual(wl.lint_text(GOOD.replace("on:\n", "on:\n  # schedule: none, runs from the tick\n")), [])

    def test_pull_request_target_forbidden(self):
        self.assertIn("W05", rules(GOOD.replace("  pull_request:", "  pull_request_target:")))

    def test_unpinned_actions(self):
        self.assertEqual(rules(GOOD.replace("checkout@v4", "checkout@main")), ["W06"])
        self.assertEqual(rules(GOOD.replace("actions/checkout@v4", "owner/act")), ["W06"])
        self.assertEqual(wl.lint_text(GOOD.replace("actions/checkout@v4", "owner/act@0123456789abcdef0123456789abcdef01234567")), [])
        self.assertEqual(wl.lint_text(GOOD.replace("actions/checkout@v4", "./local-action")), [])

    def test_secret_in_pr_job_needs_guard(self):
        bad = GOOD + "      - run: deploy\n        env: { T: ${{ secrets.TOKEN }} }\n"
        self.assertEqual(rules(bad), ["W07"])
        guarded = bad.replace("    runs-on: ubuntu-latest", "    if: github.event_name == 'workflow_dispatch'\n    runs-on: ubuntu-latest")
        self.assertEqual(wl.lint_text(guarded), [])
        self.assertEqual(wl.lint_text(GOOD + "      - run: gh pr list\n        env: { T: ${{ secrets.GITHUB_TOKEN }} }\n"), [])

    def test_macos_windows_forbidden(self):
        self.assertEqual(rules(GOOD.replace("ubuntu-latest", "macos-latest")), ["W08"])

    # ---- US-24 W10 to W17: the rules the first version of the linter did not enforce ----

    def test_us_24_r15_matrix_over_four_jobs_is_w10(self):
        m5 = GOOD.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node: [18, 20, 22]\n        os: [a, b]\n")
        self.assertEqual(rules(m5), ["W10"])  # 3 x 2 = 6 jobs
        m4 = GOOD.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node: [18, 20]\n        os: [a, b]\n")
        self.assertEqual(wl.lint_text(m4), [])  # 2 x 2 = 4 is allowed
        dyn = GOOD.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    strategy:\n      matrix: ${{ fromJson(needs.x.outputs.m) }}\n")
        self.assertEqual(rules(dyn), ["W10"])  # no explicit list
        inc = GOOD.replace("    runs-on: ubuntu-latest\n", "    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node:\n          - 18\n          - 20\n        include:\n          - node: 22\n          - node: 24\n          - node: 26\n")
        self.assertEqual(rules(inc), ["W10"])  # 2 axis values + 3 include entries = 5

    def test_us_24_r13_pull_request_workflow_without_path_filter_is_w11_and_the_exemption_comment_passes(self):
        self.assertEqual(wl.lint_text(GOOD), [], "off unless the flag is given")
        self.assertEqual(sorted({f.split()[1] for f in wl.lint_text(GOOD, require_path_filters=True)}), ["W11"])
        self.assertEqual(wl.lint_text(GOOD.replace("on:\n", "# no-path-filter: the suite is the whole repository\non:\n"), require_path_filters=True), [])
        filtered = GOOD.replace("  pull_request:\n", "  pull_request:\n    paths-ignore: ['docs/**']\n").replace("    branches: [main]\n", "    branches: [main]\n    paths-ignore: ['docs/**']\n")
        self.assertEqual(wl.lint_text(filtered, require_path_filters=True), [])

    def test_us_24_r11_pull_request_concurrency_without_cancel_in_progress_is_w12(self):
        self.assertEqual(rules(GOOD.replace("  cancel-in-progress: true\n", "")), ["W12"])
        push_only = GOOD.replace("  pull_request:\n", "").replace("  cancel-in-progress: true\n", "")
        self.assertEqual(wl.lint_text(push_only), [])  # the cancel is for superseded pull request runs

    def test_us_24_r16_self_hosted_and_larger_runners_are_w13(self):
        for runner in ("self-hosted", "ubuntu-latest-8-cores", "ubuntu-22.04-xl", "[self-hosted, linux]"):
            self.assertEqual(rules(GOOD.replace("ubuntu-latest", runner)), ["W13"], runner)
        self.assertEqual(wl.lint_text(GOOD.replace("ubuntu-latest", "ubuntu-24.04")), [])

    def test_us_24_r42_top_level_write_scope_on_a_multi_job_workflow_is_w14_and_single_job_is_exempt(self):
        two = GOOD + "  u:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: echo\n"
        self.assertEqual(wl.lint_text(two), [])
        self.assertEqual(rules(two.replace("  contents: read", "  contents: write")), ["W14"])
        self.assertEqual(rules(two.replace("permissions:\n  contents: read", "permissions: write-all")), ["W14"])
        self.assertEqual(wl.lint_text(GOOD.replace("  contents: read", "  contents: write")), [])  # one job: top level is per job
        per_job = two.replace("  u:\n    runs-on", "  u:\n    permissions:\n      contents: write\n    runs-on")
        self.assertEqual(wl.lint_text(per_job), [])

    def test_us_24_r17_missing_cache_with_a_lock_file_is_w15(self):
        import tempfile
        node = GOOD.replace("      - run: echo hi", "      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: echo hi")
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(wl.lint_text(node, repo_root=d), [], "no lock file, no finding")
            (Path(d) / "package-lock.json").write_text("{}", encoding="utf8")
            self.assertEqual(sorted({f.split()[1] for f in wl.lint_text(node, repo_root=d)}), ["W15"])
            cached = node.replace("          node-version: 22", "          node-version: 22\n          cache: npm")
            self.assertEqual(wl.lint_text(cached, repo_root=d), [])
        self.assertEqual(wl.lint_text(node), [], "the rule is off without a repository root")

    def test_us_24_t10_us_24_r12_allow_timeout_raises_the_cap_to_60_and_needs_a_reason(self):
        slow = GOOD.replace("timeout-minutes: 5", "timeout-minutes: 30")
        self.assertEqual(rules(slow), ["W03"])
        self.assertEqual(wl.lint_text("# allow-timeout: 30 end to end proof of a seed launch\n" + slow), [])
        self.assertEqual(rules("# allow-timeout: 30\n" + slow), ["W03"], "a reason is required")
        self.assertEqual(rules("# allow-timeout: 90 too long\n" + GOOD.replace("timeout-minutes: 5", "timeout-minutes: 90")), ["W03"])
        self.assertEqual(rules("# allow-timeout: 20 reason\n" + GOOD.replace("timeout-minutes: 5", "timeout-minutes: 30")), ["W03"], "the cap is what the comment states")

    def test_us_24_t09_us_24_r57_a_six_job_matrix_pr_concurrency_without_cancel_a_self_hosted_runner_and_two_write_jobs_are_w10_w12_w13_w14(self):
        text = GOOD.replace("  cancel-in-progress: true\n", "").replace("  contents: read", "  contents: write").replace(
            "    runs-on: ubuntu-latest\n", "    runs-on: self-hosted\n    strategy:\n      matrix:\n        node: [18, 20, 22]\n        os: [a, b]\n")
        text += "  u:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: echo\n"
        self.assertEqual(rules(text), ["W10", "W12", "W13", "W14"])

    def test_us_24_r57_the_opt_in_rules_w11_and_w17_are_enforced_when_asked_and_quiet_otherwise(self):
        sched = "# allow-schedule: daily, 2 minutes\n" + GOOD.replace("  push:", "  schedule:\n    - cron: '0 6 * * *'\n  push:")
        self.assertEqual(wl.lint_text(sched), [])
        strict = {f.split()[1] for f in wl.lint_text(sched, require_path_filters=True, require_second_route=True)}
        self.assertEqual(strict, {"W11", "W17"})
        self.assertEqual({f.split()[1] for f in wl.lint_text(GOOD, require_path_filters=True, require_second_route=True)}, {"W11"}, "a workflow with no schedule has no second route to name")

    def test_us_24_r56_require_headers_flag(self):
        self.assertEqual(wl.lint_text(GOOD), [])
        self.assertEqual(sorted({f.split()[1] for f in wl.lint_text(GOOD, require_headers=True)}), ["W16"])
        head = "# budget: 5 minutes a run\n# trigger: push to main\n# free-alternative: the Cloudflare tick\n"
        self.assertEqual(wl.lint_text(head + GOOD, require_headers=True), [])

    def test_us_24_r44_require_second_route_flag(self):
        sched = "# allow-schedule: daily, 2 minutes\n" + GOOD.replace("  push:", "  schedule:\n    - cron: '0 6 * * *'\n  push:")
        self.assertEqual(wl.lint_text(sched), [])
        self.assertEqual(sorted({f.split()[1] for f in wl.lint_text(sched, require_second_route=True)}), ["W17"])
        self.assertEqual(wl.lint_text("# second-route: tick step ghcost_watchdog\n" + sched, require_second_route=True), [])

    def test_strict_and_repo_root_flags_run_from_the_command_line(self):
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(wl.main(["--strict", str(ROOT / ".github/workflows/ci.yml")]), 1)
        self.assertIn("W16", buf.getvalue())
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(wl.main(["--repo-root", str(ROOT), str(ROOT / ".github/workflows/ci.yml")]), 0)

    def test_real_workflows_pass(self):
        files = sorted((ROOT / ".github/workflows").glob("*.y*ml"))
        self.assertTrue(files)
        for f in files:
            self.assertEqual(wl.lint_text(f.read_text(encoding="utf8"), f.name), [], f.name)


if __name__ == "__main__":
    unittest.main()

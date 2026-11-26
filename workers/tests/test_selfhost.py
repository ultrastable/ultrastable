# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import selfhost_check as sc  # noqa: E402
import spec_truth as st  # noqa: E402
import sync_agent_files as saf  # noqa: E402
import sync_agent_bootstrap as sab  # noqa: E402
import safe_merge as sm  # noqa: E402
import docs_audit as da  # noqa: E402
import review_gate as rg  # noqa: E402
import canary_revert as cr  # noqa: E402

GOOD = """## What
Adds the claims module.

Item: #2
Spec: US-08-R03, US-SPEC-08
Prediction: core_tests_passing >= 150 within 1 h
Evidence: npm test: core 151 pass, 0 fail
Author: claude-code (sonnet)
Reviewer: codex (different model)
"""


class PullRequestContract(unittest.TestCase):
    def check(self, body=GOOD, author="someone", files=("core/claims/index.js",), labels=()):
        return sc.check(body, author, list(files), list(labels))

    def test_us_20_r02_a_complete_record_passes(self):
        self.assertEqual(self.check(), [])

    def test_t20_2_us_20_r02_a_missing_item_is_refused(self):
        self.assertTrue(any(p.startswith("Item:") for p in self.check(GOOD.replace("Item: #2", "Item: <issue>"))))

    def test_us_20_r02_prediction_must_be_checkable_or_na_with_a_reason(self):
        bad = self.check(GOOD.replace("core_tests_passing >= 150 within 1 h", "it will probably work"))
        self.assertTrue(any(p.startswith("Prediction:") for p in bad))
        self.assertEqual(self.check(GOOD.replace("core_tests_passing >= 150 within 1 h", "n/a documentation only")), [])

    def test_us_20_r02_us_20_r03_us_20_r05_a_blank_field_does_not_take_the_next_line_as_its_value(self):
        blank_evidence = GOOD.replace("Evidence: npm test: core 151 pass, 0 fail", "Evidence:")
        self.assertEqual(sc.field(blank_evidence, "Evidence"), None)
        self.assertTrue(any(p.startswith("Evidence:") for p in self.check(blank_evidence)))
        blank_reviewer = GOOD.replace("Reviewer: codex (different model)", "Reviewer:") + "Protected-change: pending\n"
        self.assertEqual(sc.field(blank_reviewer, "Reviewer"), None)
        self.assertTrue(any(p.startswith("Reviewer:") for p in self.check(blank_reviewer)))

    def test_us_20_r05_evidence_must_be_real_output(self):
        self.assertTrue(any(p.startswith("Evidence:") for p in self.check(GOOD.replace("npm test: core 151 pass, 0 fail", "looks good"))))

    def test_t20_3_us_20_r04_never_review_your_own_work(self):
        body = GOOD.replace("Reviewer: codex (different model)", "Reviewer: claude-code (sonnet)")
        self.assertTrue(any("differ" in p for p in self.check(body)))

    def test_t20_4_us_20_r07_protected_paths_need_a_reason_and_the_label(self):
        probs = self.check(files=["agents/CONTRACT.md", "core/x.js"])
        self.assertTrue(any(p.startswith("Protected-change:") for p in probs))
        self.assertTrue(any("label" in p for p in probs))
        ok = self.check(GOOD + "Protected-change: tightening the review rule after a trial finding\n", files=["agents/CONTRACT.md"], labels=["protected-change"])
        self.assertEqual(ok, [])

    def test_us_20_r03_dependency_bots_are_exempt(self):
        self.assertEqual(sc.check("", "dependabot[bot]", ["package.json"], []), [])

    def test_us_20_r07_the_guard_files_themselves_are_protected(self):
        self.assertEqual(sorted(sc.protected(["core/test/no-qnfo.test.js", "tools/selfhost_check.py", "README.md"])), ["core/test/no-qnfo.test.js", "tools/selfhost_check.py"])


SPEC = """# US-SPEC-99: Example

## 9. Reference implementation status

- Tick: BUILT in `core/src/tick.js` with tests in `core/test/tick.test.js`.
- Old path: BUILT in `worker/src/tick.js`.
- Vague: BUILT, trust us.
- Mixed: PLANNED; part is BUILT in `core/src/tick.js`.
- Running only: RUNNING in the reference fleet.

## 10. Appendix

- BUILT in `nowhere/at/all.js` (outside the status section, ignored)
"""


class SpecTruth(unittest.TestCase):
    def test_t20_5_us_20_r06_finds_false_built_labels_only_in_the_status_section(self):
        with tempfile.TemporaryDirectory() as d:
            specs, code = Path(d) / "specs", Path(d) / "code"
            (code / "core" / "src").mkdir(parents=True)
            (code / "core" / "src" / "tick.js").write_text("x")
            (code / "core" / "test").mkdir(parents=True)
            (code / "core" / "test" / "tick.test.js").write_text("x")
            specs.mkdir()
            (specs / "US-SPEC-99-example.md").write_text(SPEC, encoding="utf-8")
            f = st.findings(specs, code)
            self.assertEqual([x["line"] for x in f], [6, 7])
            self.assertEqual(f[0]["problem"], "labelled BUILT but none of the named paths exist")
            self.assertEqual(f[1]["problem"], "labelled BUILT but names no file")

    def test_us_20_r06_several_code_directories_are_searched(self):
        with tempfile.TemporaryDirectory() as d:
            specs, a, b = Path(d) / "specs", Path(d) / "a", Path(d) / "b"
            for p in (specs, a, b / "docs"):
                p.mkdir(parents=True)
            (b / "docs" / "why.md").write_text("x")
            (specs / "US-SPEC-98-x.md").write_text("## 1. Reference implementation status\n\n- Doc: BUILT in `docs/why.md`.\n", encoding="utf-8")
            self.assertEqual(st.findings(specs, [a, b]), [])
            self.assertEqual(len(st.findings(specs, [a])), 1)


def main_exit(mod, argv):
    err = io.StringIO()
    with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
        rc = mod.main(argv)
    return rc, err.getvalue()


class ProtectedPathGate(unittest.TestCase):
    """US-20-R03, R04, R07, R08: the automated gate (the human code owner is an optional extra, never the dependency)."""

    def test_us_20_r04_reviewer_variants_with_punctuation_are_the_same_reviewer(self):
        for rev in ("Claude-Code  (Sonnet)", "claude code sonnet", "CLAUDE_CODE (sonnet)."):
            body = GOOD.replace("Reviewer: codex (different model)", "Reviewer: " + rev)
            self.assertTrue(any("differ" in p for p in sc.check(body, "someone", ["core/x.js"], [])), rev)
        self.assertEqual(sc.party("Claude-Code (sonnet)"), sc.party("claude code  sonnet"))
        self.assertNotEqual(sc.party("codex"), sc.party("claude-code"))

    def test_us_20_r07_every_codeowners_path_is_protected(self):
        text = (ROOT / ".github" / "CODEOWNERS").read_text(encoding="utf-8")
        paths = sc.codeowners_paths(text)
        self.assertGreaterEqual(len(paths), 10)
        for p in paths:
            self.assertEqual(sc.protected([p]), [p], p + " is in CODEOWNERS but not protected by the record check")

    def test_t20_9_us_20_r14_deleting_a_guard_file_fails(self):
        self.assertEqual(sc.deleted_guards("D\ttools/selfhost_check.py\nM\tREADME.md\n"), ["tools/selfhost_check.py"])
        self.assertEqual(sc.deleted_guards("R100\ttools/spec_truth.py\ttools/x.py\n"), ["tools/spec_truth.py"])
        self.assertEqual(sc.deleted_guards("M\ttools/selfhost_check.py\nD\tcore/other.js\n"), [])
        with tempfile.TemporaryDirectory() as d:
            body, ns = Path(d) / "pr.md", Path(d) / "ns.txt"
            body.write_text(GOOD + "Protected-change: removing a guard for a test of the gate\n", encoding="utf-8")
            ns.write_text("D\tcore/test/no-qnfo.test.js\n", encoding="utf-8")
            rc, err = main_exit(sc, ["--body-file", str(body), "--author", "someone", "--files", "core/test/no-qnfo.test.js", "--labels", "protected-change", "--name-status", str(ns)])
            self.assertEqual(rc, 1)
            self.assertIn("guard file is deleted", err)

    def test_t20_9_us_20_r14_adding_a_human_approver_fails_when_closed_loop(self):
        diff = "--- a/.github/CODEOWNERS\n+++ b/.github/CODEOWNERS\n+/docs/ @someone\n+# comment\n"
        self.assertEqual(sc.added_human_approver(diff), ["/docs/ @someone"])
        self.assertEqual(sc.added_human_approver("-/docs/ @someone\n"), [])
        with tempfile.TemporaryDirectory() as d:
            body, cd = Path(d) / "pr.md", Path(d) / "co.diff"
            body.write_text(GOOD + "Protected-change: tighten code ownership of the docs\n", encoding="utf-8")
            cd.write_text(diff, encoding="utf-8")
            args = ["--body-file", str(body), "--author", "someone", "--files", ".github/CODEOWNERS", "--labels", "protected-change", "--codeowners-diff", str(cd)]
            self.assertEqual(main_exit(sc, args)[0], 0, "without --closed-loop a human approver is only an extra control")
            rc, err = main_exit(sc, args + ["--closed-loop"])
            self.assertEqual(rc, 1)
            self.assertIn("human approver", err)

    def test_t20_8_us_20_r08_a_second_open_pr_on_the_same_protected_group_is_reported(self):
        others = [{"number": 7, "files": ["AGENTS.md", "README.md"]}, {"number": 8, "files": [".github/workflows/ci.yml"]}, {"number": 9, "files": ["core/x.js"]}]
        probs = sc.overlapping(["CLAUDE.md", "core/y.js"], others, me=12)
        self.assertEqual(len(probs), 1)
        self.assertIn("#7", probs[0])
        self.assertIn("agent-instructions", probs[0])
        self.assertEqual(sc.overlapping(["CLAUDE.md"], others, me=7), [], "a pull request is never compared with itself")
        self.assertEqual(sc.overlapping(["core/y.js"], others, me=12), [], "an unprotected change has no component")
        self.assertEqual(sc.overlapping(["SCOPE.md"], others, me=12), [], "a different component is a different change")
        with tempfile.TemporaryDirectory() as d:
            body, op = Path(d) / "pr.md", Path(d) / "other.json"
            body.write_text(GOOD + "Protected-change: change one instruction file at a time\n", encoding="utf-8")
            op.write_text(json.dumps(others), encoding="utf-8")
            rc, err = main_exit(sc, ["--body-file", str(body), "--author", "someone", "--files", "CLAUDE.md", "--labels", "protected-change", "--other-prs", str(op), "--number", "12"])
            self.assertEqual(rc, 1)
            self.assertIn("One change per protected component", err)

    def test_t20_7_us_20_r15_exempt_authors_are_exactly_the_listed_bots(self):
        self.assertEqual(sc.EXEMPT_AUTHORS, ("dependabot[bot]", "github-actions[bot]"))
        self.assertEqual(sc.check("", "github-actions[bot]", ["AGENTS.md"], []), [], "the workflow-generated refresh is exempt")
        self.assertNotEqual(sc.check("", "someone-else[bot]", ["AGENTS.md"], []), [], "any other login needs the record")

    def test_us_20_r15_an_exempt_author_skips_the_gate_options_too(self):
        with tempfile.TemporaryDirectory() as d:
            body, ns = Path(d) / "pr.md", Path(d) / "ns.txt"
            body.write_text("", encoding="utf-8")
            ns.write_text("D\ttools/spec_truth.py\n", encoding="utf-8")
            self.assertEqual(main_exit(sc, ["--body-file", str(body), "--author", "dependabot[bot]", "--files", "package.json", "--name-status", str(ns)])[0], 0)


class SpecTruthTests(unittest.TestCase):
    """US-20-R06: BUILT names a file that exists and a test that passes."""

    def tree(self, d, spec_line, with_test=True):
        specs, code = Path(d) / "specs", Path(d) / "code"
        (code / "core").mkdir(parents=True)
        (code / "core" / "x.js").write_text("export const x = 1\n")
        (code / "core" / "x.test.js").write_text("// test\n")
        specs.mkdir()
        (specs / "US-SPEC-97-x.md").write_text("## 1. Reference implementation status\n\n" + spec_line + "\n", encoding="utf-8")
        return specs, code

    def test_us_20_r06_a_built_line_naming_code_but_no_test_is_reported_with_tests_flag(self):
        with tempfile.TemporaryDirectory() as d:
            specs, code = self.tree(d, "- Thing: BUILT in `core/x.js`.")
            self.assertEqual(st.findings(specs, code), [], "the default report checks the file half only")
            f = st.findings(specs, code, check_tests=True)
            self.assertEqual([x["problem"] for x in f], ["labelled BUILT but names no test"])
            self.assertEqual(st.counts(f), {"false_built": 0, "no_test_named": 1, "failing_tests": 0})

    def test_us_20_r06_a_line_that_names_a_test_passes_the_tests_flag(self):
        with tempfile.TemporaryDirectory() as d:
            specs, code = self.tree(d, "- Thing: BUILT in `core/x.js`, test `core/x.test.js`.")
            self.assertEqual(st.findings(specs, code, check_tests=True), [])

    def test_us_20_r06_a_failing_named_test_is_reported_with_run_flag(self):
        with tempfile.TemporaryDirectory() as d:
            specs, code = self.tree(d, "- Thing: BUILT in `core/x.js`, test `core/x.test.js`.")
            calls = []

            def runner(base, path):
                calls.append(path.name)
                return False, "1 failed"
            f = st.findings(specs, code, run=True, runner=runner)
            self.assertEqual([x["problem"] for x in f], ["named test does not pass"])
            self.assertEqual(f[0]["test"], "core/x.test.js")
            self.assertEqual(calls, ["x.test.js"])
            ok = st.findings(specs, code, run=True, runner=lambda b, p: (True, "ok"))
            self.assertEqual(ok, [])

    def test_us_20_r06_a_test_file_named_by_two_lines_runs_once(self):
        with tempfile.TemporaryDirectory() as d:
            specs, code = self.tree(d, "- A: BUILT in `core/x.js`, test `core/x.test.js`.\n- B: BUILT in `core/x.js`, test `core/x.test.js`.")
            calls = []
            st.findings(specs, code, run=True, runner=lambda b, p: (calls.append(1) or True, "ok"))
            self.assertEqual(len(calls), 1)

    def test_us_20_r06_a_missing_interpreter_is_a_failure_not_a_pass(self):
        with tempfile.TemporaryDirectory() as d:
            code = Path(d)
            (code / "a.test.js").write_text("x")
            old = os.environ.get("PATH", "")
            os.environ["PATH"] = ""
            try:
                ok, detail = st.run_test(code, code / "a.test.js")
            finally:
                os.environ["PATH"] = old
            self.assertFalse(ok)
            self.assertIn("cannot run", detail)

    def test_us_20_r06_default_output_is_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            specs, code = self.tree(d, "- Thing: BUILT in `nowhere/x.js`.")
            err = io.StringIO()
            with contextlib.redirect_stdout(err):
                rc = st.main(["--spec-dir", str(specs), "--code-dir", str(code), "--strict"])
            self.assertEqual(rc, 1)
            self.assertIn("1 BUILT status line(s) do not match the code", err.getvalue())
            self.assertNotIn("names code but no test", err.getvalue())

    def test_t20_5_us_20_r06_a_missing_file_is_still_reported_with_the_new_flags(self):
        with tempfile.TemporaryDirectory() as d:
            specs, code = self.tree(d, "- Thing: BUILT in `nowhere/x.js`, test `nowhere/x.test.js`.")
            f = st.findings(specs, code, check_tests=True, run=True, runner=lambda b, p: (True, "ok"))
            self.assertEqual([x["problem"] for x in f], ["labelled BUILT but none of the named paths exist"])


class GeneratedAgentFiles(unittest.TestCase):
    """US-20-R01, R09, R10 and T20-1: one contract, many doors, drift is detected and (in the org repository) regenerated."""

    def test_t20_1_generated_files_equal_the_contract_in_every_repo(self):
        for repo in saf.REPOS:
            files = saf.files(repo)
            for rel in ("AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", ".cursor/rules/ultrastable.mdc", ".github/pull_request_template.md", ".github/ISSUE_TEMPLATE/work-item.yml"):
                self.assertIn(rel, files, repo)
            contract = saf.contract_text()
            for rel in ("AGENTS.md", ".github/copilot-instructions.md", ".cursor/rules/ultrastable.mdc"):
                self.assertEqual(files[rel].count(contract), 1, f"{repo}:{rel} carries the contract once")
            with tempfile.TemporaryDirectory() as d:
                self.assertEqual(main_exit(saf, ["--repo", repo, "--target", d])[0], 0)
                self.assertEqual(main_exit(saf, ["--repo", repo, "--target", d, "--check"])[0], 0)

    def test_us_20_r01_check_fails_on_a_hand_edited_agent_file(self):
        with tempfile.TemporaryDirectory() as d:
            main_exit(saf, ["--repo", "workers", "--target", d])
            (Path(d) / "AGENTS.md").write_text("hand edited\n", encoding="utf-8")
            rc, err = main_exit(saf, ["--repo", "workers", "--target", d, "--check"])
            self.assertEqual(rc, 1)
            self.assertIn("DIFFERS AGENTS.md", err)

    def test_us_20_r09_contract_carries_the_tool_cannot_do_all_table(self):
        c = saf.contract_text()
        self.assertIn("If your tool cannot do all of that", c)
        for row in ("Only talk", "Read and edit files", "Use git and the GitHub CLI or API"):
            self.assertIn(row, c)

    def test_us_20_r02_the_pull_request_template_carries_the_six_record_fields(self):
        pr = saf.files("workers")[".github/pull_request_template.md"]
        for f in ("Item:", "Spec:", "Prediction:", "Evidence:", "Author:", "Reviewer:"):
            self.assertIn(f, pr)

    def test_us_20_r01_the_selfhost_workflow_is_generated_for_spec_license_dotgithub_and_not_for_workers(self):
        for repo in ("spec", "license", ".github"):
            self.assertIn(".github/workflows/selfhost.yml", saf.files(repo))
        self.assertNotIn(".github/workflows/selfhost.yml", saf.files("workers"))

    def test_us_20_r01_the_generated_workflow_passes_the_workflow_lint_in_strict_mode(self):
        with tempfile.TemporaryDirectory() as d:
            for repo in ("spec", "license", ".github"):
                p = Path(d) / (repo.strip(".") + ".yml")
                p.write_text(saf.workflow_text(repo), encoding="utf-8")
                r = subprocess.run([sys.executable, str(ROOT / "tools" / "workflow_lint.py"), "--strict", str(p)], capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, repo + ": " + r.stdout + r.stderr)

    def test_us_20_r06_the_spec_repository_workflow_runs_spec_truth_and_the_others_do_not(self):
        self.assertIn("spec_truth.py", saf.workflow_text("spec"))
        self.assertIn("--strict", saf.workflow_text("spec"))
        self.assertNotIn("spec_truth.py", saf.workflow_text("license"))
        for repo in ("spec", "license", ".github"):
            t = saf.workflow_text(repo)
            self.assertIn("selfhost_check.py", t)
            self.assertIn("--closed-loop", t)
            self.assertIn(f"--repo {repo}", t)

    def test_us_20_r16_agent_bootstrap_block_is_idempotent_and_replaces_in_place(self):
        once = sab.upsert("# Title\n\nbody\n")
        self.assertEqual(once.count(sab.BEGIN), 1)
        self.assertEqual(sab.upsert(once), once, "running it again changes nothing")
        stale = once.replace("fetch ", "fetch OLD ")
        fixed = sab.upsert(stale)
        self.assertEqual(fixed, once)

    def test_us_20_r16_agent_bootstrap_removes_an_orphaned_marker(self):
        broken = "# Title\n\n" + sab.BEGIN + "\nhalf an edit\n"
        out = sab.upsert(broken)
        self.assertEqual(out.count(sab.BEGIN), 1)
        self.assertEqual(out.count(sab.END), 1)


class SelfClosedLint(unittest.TestCase):
    """SELF-CLOSED-LOOPS-1 lint (US-20-R10 neighbour): instruction files carry the rule; an added line may not wait on a person."""
    LINT = ROOT / "tools" / "self_closed_lint.py"

    def lint(self, cwd, *args):
        return subprocess.run([sys.executable, str(self.LINT), *args], cwd=cwd, capture_output=True, text=True)

    def repo(self, d, instruction="AGENTS.md", with_pointer=True):
        text = "# Agents\n\nSELF-CLOSED-LOOPS-1 applies here.\n" + ("AGENT-BOOTSTRAP-1 pointer.\n" if with_pointer else "")
        (Path(d) / instruction).write_text(text, encoding="utf-8")

    def git(self, d, *a):
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}
        r = subprocess.run(["git", *a], cwd=d, capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_us_20_r16_selftest_passes(self):
        r = self.lint(ROOT, "--selftest")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("4 passed, 0 failed", r.stdout)

    def test_us_20_r16_an_instruction_file_without_the_rule_fails(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "AGENTS.md").write_text("# Agents\n", encoding="utf-8")
            r = self.lint(d, "--no-diff")
            self.assertEqual(r.returncode, 1)
            self.assertIn("SELF-CLOSED-LOOPS-1", r.stdout)

    def test_us_20_r16_a_pointer_is_required_with_the_rule(self):
        with tempfile.TemporaryDirectory() as d:
            self.repo(d, with_pointer=False)
            r = self.lint(d, "--no-diff")
            self.assertEqual(r.returncode, 1)
            self.assertIn("AGENT-BOOTSTRAP-1", r.stdout)
            self.repo(d)
            self.assertEqual(self.lint(d, "--no-diff").returncode, 0)

    def test_us_20_r16_a_diff_adding_text_that_waits_on_a_person_fails_and_a_gate_line_is_exempt(self):
        with tempfile.TemporaryDirectory() as d:
            self.repo(d)
            self.git(d, "init", "-q", "-b", "main")
            self.git(d, "add", "-A")
            self.git(d, "commit", "-qm", "base")
            (Path(d) / "notes.md").write_text("Status: pending owner decision on pricing\nIDENTITY-BOUND: pending owner decision on signing\n", encoding="utf-8")
            self.git(d, "checkout", "-qb", "work")
            self.git(d, "add", "-A")
            self.git(d, "commit", "-qm", "work")
            r = self.lint(d, "--base", "main")
            self.assertEqual(r.returncode, 1, r.stdout)
            self.assertIn("notes.md: waits on a person: Status: pending owner decision", r.stdout)
            self.assertNotIn("IDENTITY-BOUND: pending", r.stdout.replace("Status: pending owner decision on pricing", ""))

    def test_us_20_r16_a_missing_base_is_a_failure_not_a_pass(self):
        with tempfile.TemporaryDirectory() as d:
            self.repo(d)
            self.git(d, "init", "-q", "-b", "main")
            r = self.lint(d, "--base", "origin/nope")
            self.assertEqual(r.returncode, 1)
            self.assertIn("not found", r.stdout)

    def test_us_20_r16_a_base_with_no_merge_base_is_a_failure_not_a_pass(self):
        with tempfile.TemporaryDirectory() as d:
            self.repo(d)
            self.git(d, "init", "-q", "-b", "main")
            self.git(d, "add", "-A")
            self.git(d, "commit", "-qm", "base")
            self.git(d, "checkout", "-q", "--orphan", "feature")
            (Path(d) / "notes.md").write_text("Status: pending owner decision on the rollout\n", encoding="utf-8")
            self.git(d, "add", "-A")
            self.git(d, "commit", "-qm", "unrelated history")
            r = self.lint(d, "--base", "main")
            self.assertEqual(r.returncode, 1, r.stdout)
            self.assertIn("git diff main...HEAD failed", r.stdout)


class MergeDoors(unittest.TestCase):
    """US-20-R17: the merge doors refuse on missing evidence."""
    PR = {"state": "OPEN", "isDraft": False, "mergeable": "MERGEABLE", "headRefOid": "abc", "files": [{"path": "core/x.js"}]}
    GATE = {"body": "Author: tool-a\nReviewer: tool-b\nEvidence: 151 pass", "author": "tool-a", "reviewers": [], "checks": "success", "labels": []}

    def test_us_20_r17_safe_merge_needs_the_record_check_and_the_test_job_on_the_head_commit(self):
        self.assertTrue(sm.decide(self.PR, "success", "success")[0])
        ok, why = sm.decide(self.PR, None, "success")
        self.assertFalse(ok)
        self.assertIn("not completed", why)
        self.assertFalse(sm.decide(self.PR, "success", None)[0], "no record check on the head commit is not a pass")
        self.assertFalse(sm.decide(self.PR, "success", "failure")[0])
        self.assertFalse(sm.decide(self.PR, "failure", "success")[0])

    def test_us_20_r17_review_gate_requires_an_independent_reviewer_a_number_green_checks_and_a_protected_reason(self):
        self.assertEqual(rg.gate(self.GATE), [])
        self.assertTrue(any(p.startswith("R1") for p in rg.gate({**self.GATE, "body": "Author: tool-a\nReviewer: tool-a\nEvidence: 151 pass"})))
        self.assertTrue(any(p.startswith("R2") for p in rg.gate({**self.GATE, "body": "Author: tool-a\nReviewer: tool-b\nEvidence: looks fine"})))
        self.assertTrue(any(p.startswith("R3") for p in rg.gate({**self.GATE, "checks": "pending"})))
        self.assertTrue(any(p.startswith("R4") for p in rg.gate({**self.GATE, "labels": ["protected-change"]})))

    def test_us_20_r17_canary_revert_treats_no_evidence_as_revert_and_prints_the_commands_without_running_them(self):
        self.assertEqual(cr.decide({"ok": True, "results": []})[0], "keep")
        verdict, reasons = cr.decide(None)
        self.assertEqual(verdict, "revert")
        self.assertIn("no probe evidence", reasons)
        buf = io.StringIO()
        with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(buf):
            cr.main(["--probes", str(Path(d) / "missing.json"), "--commit", "abc123"])
        out = json.loads(buf.getvalue())
        self.assertEqual(out["decision"], "revert")
        self.assertIn("git revert --no-edit abc123", out["commands"][0])


class DocumentsAreConsumed(unittest.TestCase):
    """US-23-R15: every document is consumed by code, and a page that names a file that does not exist fails."""
    REG = {"consumers": [], "verified": {"globs": ["**/*.md"]}, "ignore_references_from": [], "human_action_patterns": [], "human_action_exempt": [], "human_action_baseline": {}}

    def tree(self, files):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        root = Path(d)
        (root / "doctrine").mkdir()
        (root / "doctrine" / "doc-consumers.json").write_text(json.dumps(self.REG), encoding="utf-8")
        for rel, text in files.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text, encoding="utf-8")
        for args in (["init", "-q"], ["add", "-A"]):
            self.assertEqual(subprocess.run(["git", *args], cwd=root, capture_output=True, text=True).returncode, 0)
        return root

    def test_us_23_r15_an_orphan_document_fails_and_a_code_reference_consumes_it(self):
        orphan = self.tree({"notes/plan.md": "# plan\nread by nobody\n"})
        self.assertEqual(da.evaluate(orphan)["orphans"], ["notes/plan.md"])
        self.assertTrue(any("notes/plan.md" in b for b in da.check(orphan)))
        used = self.tree({"notes/plan.md": "# plan\n", "tool.py": "open('notes/plan.md')\n"})
        self.assertEqual(da.check(used), [])
        self.assertEqual(da.evaluate(used)["consumed"]["notes/plan.md"][0], "path")

    def test_us_23_r15_a_page_that_names_a_file_that_does_not_exist_fails(self):
        bad = self.tree({"docs/how.md": "# how\nIt is run by `tools/ghost.py` and `tools/real.py`.\n", "tools/real.py": "pass\n"})
        self.assertTrue(any("tools/ghost.py" in p for p in da.evaluate(bad)["problems"]))
        good = self.tree({"docs/how.md": "# how\nIt is run by `tools/real.py`.\n", "tools/real.py": "pass\n"})
        self.assertEqual(da.evaluate(good)["problems"], [])
        self.assertEqual(da.evaluate(good)["consumed"]["docs/how.md"][0], "verified")


if __name__ == "__main__":
    unittest.main()

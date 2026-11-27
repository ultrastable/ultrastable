"""CLOSED-LOOP-AXIOM as code: the repository is clean, and each way of opening a loop fails the check."""
import unittest
from _repo import ROOT, copy_repo, edit
from foundation import closedloop


class ClosedLoop(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(closedloop.check(ROOT), [])

    def test_instruction_file_without_axiom_fails(self):
        r = copy_repo(); p = r / "agents/roles/staff.md"; p.write_text(p.read_text().replace("CLOSED-LOOP-AXIOM", "x"))
        self.assertTrue(any("staff.md" in b and "lacks" in b for b in closedloop.check(r)))

    def test_executor_prompt_carries_it(self):
        from foundation import executor
        self.assertIn("CLOSED-LOOP-AXIOM", executor.build_prompt({"number": 1, "title": "t"}, ""))

    def test_lint_flags_human_dependency(self):
        for s in ("Please review this change.", "Owner to decide the plan.", "Left as a handoff card.", "Let me know how it goes."):
            self.assertTrue(closedloop.lint(s), s)
        self.assertEqual(closedloop.lint("The merge lane merges on green."), [])

    def test_unconsumed_artifact_fails(self):
        """US-12-R16: an output with no code consumer fails the check."""
        r = copy_repo(); (r / "docs/ops/new-note.md").write_text("A note for people.\n")
        self.assertTrue(any("new-note.md" in b and "no code consumer" in b for b in closedloop.check(r)))

    def test_gate_loop_is_an_open_end(self):
        r = copy_repo(); edit(r / "instances/ultrastable/loop-registry.json", lambda d: d["loops"][0].update(closes_by="gate:NEEDS-YOU.md"))
        self.assertTrue(any("only 'system'" in b for b in closedloop.check(r)))

    def test_human_codeowner_fails(self):
        r = copy_repo(); (r / ".github/CODEOWNERS").write_text("* @someone\n")
        self.assertTrue(any("CODEOWNERS" in b for b in closedloop.check(r)))


if __name__ == "__main__":
    unittest.main()

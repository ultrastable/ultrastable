# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Kernel 9.1.0 as code: clauses have enforcers, budgets hold, the repertoire vetoes irreversible classes, the hook blocks protected paths."""
import json, subprocess, unittest
from _repo import ROOT, copy_repo, edit
from foundation import kernel9


class Kernel9(unittest.TestCase):
    def test_check_passes(self):
        self.assertEqual(kernel9.check(ROOT), [])

    def test_missing_enforcer_clause_and_veto_fail(self):
        r = copy_repo(); edit(r / "doctrine/kernel9.json", lambda d: d["clauses"][0].update(enforcer="nope/missing.py"))
        self.assertTrue(any("nope/missing.py" in p for p in kernel9.check(r)))
        r = copy_repo(); edit(r / "doctrine/kernel9.json", lambda d: d["clauses"].append({"id": "Z9", "source": "s", "enforcer": "AGENTS.md", "metric": "m"}))
        self.assertTrue(any("Z9" in p for p in kernel9.check(r)))
        r = copy_repo(); edit(r / "doctrine/step-repertoire.json", lambda d: d["veto_classes"].remove("force_push"))
        self.assertTrue(any("force_push" in p for p in kernel9.check(r)))
        r = copy_repo(); edit(r / "doctrine/step-repertoire.json", lambda d: d["steps"][0].update(undo=""))
        self.assertTrue(any("not reversible" in p for p in kernel9.check(r)))

    def test_kernel_is_unitary(self):
        r = copy_repo(); t = r / "doctrine/kernel-9.1.0.md"; t.write_text(t.read_text() + "\nSee https://example.com/x\n")
        self.assertTrue(any("not self-contained" in p for p in kernel9.check(r)))
        r = copy_repo(); t = r / "doctrine/kernel-9.1.0.md"; t.write_text(t.read_text() + "\nRead doctrine/other.json\n")
        self.assertTrue(any("not self-contained" in p for p in kernel9.check(r)))
        r = copy_repo(); edit(r / "doctrine/step-repertoire.json", lambda d: d["defaults"].update(epsilon=0.9))
        self.assertTrue(any("differs" in p for p in kernel9.check(r)))

    def test_scalar_score_is_refused(self):
        r = copy_repo(); edit(r / "seed/autonomy/essential-variables.json", lambda d: d.update(fleet_score=1))
        self.assertTrue(any("fleet_score" in p for p in kernel9.check(r)))

    def test_guard_hook_blocks_protected_path(self):
        run = lambda p: subprocess.run([str(ROOT / ".claude/hooks/guard.sh")], input=json.dumps(p), text=True, capture_output=True).returncode
        self.assertEqual(run({"tool_name": "Edit", "tool_input": {"file_path": "doctrine/step-repertoire.json"}}), 2)
        self.assertEqual(run({"tool_name": "Bash", "tool_input": {"command": "git push --force origin x"}}), 2)
        self.assertEqual(run({"tool_name": "Edit", "tool_input": {"file_path": "foundation/kernel9.py"}}), 0)


if __name__ == "__main__":
    unittest.main()

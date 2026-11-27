# SPDX-License-Identifier: LicenseRef-Ultrastable
"""US-20-R07 (US-SPEC-20): the automated protected-path gate, scripts/protected_paths.py, which replaces human CODEOWNERS approval
(CLOSED-LOOP-AXIOM). It is exercised on a throwaway git repository: no network, nothing outside the temporary directory."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from _repo import ROOT

GATE = ROOT / "scripts" / "protected_paths.py"
ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}


def git(cwd, *args):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, env=ENV)
    assert r.returncode == 0, r.stderr
    return r.stdout


class ProtectedPathGate(unittest.TestCase):
    def setUp(self):
        self._d = tempfile.TemporaryDirectory()
        self.repo = Path(self._d.name)
        git(self.repo, "init", "-q", "-b", "main")
        for rel, text in {"tools/selfhost_check.py": "# guard\n", "AGENTS.md": "rules\n", ".github/CODEOWNERS": "/SCOPE.md   @someone\n", "core/a.js": "1\n"}.items():
            self.write(rel, text)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "base")
        git(self.repo, "checkout", "-qb", "work")

    def tearDown(self):
        self._d.cleanup()

    def write(self, rel, text):
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def commit(self):
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-qm", "work")

    def gate(self, body=""):
        r = subprocess.run(["python3", str(GATE), "main"], cwd=self.repo, capture_output=True, text=True, env={**ENV, "PR_BODY": body})
        return r.returncode, r.stdout

    def test_us_20_r07_a_protected_change_without_a_protected_change_line_fails(self):
        self.write("AGENTS.md", "rules changed\n")
        self.commit()
        rc, out = self.gate("Item: #1\n")
        self.assertEqual(rc, 1)
        self.assertIn("without a Protected-change: line", out)

    def test_us_20_r07_a_protected_change_with_the_line_passes_and_reports_how_many_files(self):
        self.write("AGENTS.md", "rules changed\n")
        self.commit()
        rc, out = self.gate("Protected-change: tightening the rule after a trial\n")
        self.assertEqual(rc, 0, out)
        self.assertIn("1 protected file(s) changed", out)

    def test_us_20_r07_deleting_a_guard_file_fails_even_with_the_reason_line(self):
        os.remove(self.repo / "tools" / "selfhost_check.py")
        self.commit()
        rc, out = self.gate("Protected-change: removing the record check\n")
        self.assertEqual(rc, 1)
        self.assertIn("tools/selfhost_check.py: a guard is deleted", out)

    def test_us_20_r07_adding_a_human_approver_to_codeowners_fails(self):
        self.write(".github/CODEOWNERS", "/SCOPE.md   @someone\n/docs/   @another-person\n")
        self.commit()
        rc, out = self.gate("Protected-change: add an approver\n")
        self.assertEqual(rc, 1)
        self.assertIn("a human approver was added to CODEOWNERS", out)

    def test_an_unprotected_change_passes_with_no_reason_line(self):
        self.write("core/a.js", "2\n")
        self.commit()
        rc, out = self.gate("")
        self.assertEqual(rc, 0, out)
        self.assertIn("0 protected file(s) changed", out)


if __name__ == "__main__":
    unittest.main()

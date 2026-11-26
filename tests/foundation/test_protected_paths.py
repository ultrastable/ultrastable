# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-20-R07, T20-4: the automated protected-path gate (scripts/protected_paths.py) on a throwaway repository."""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts/protected_paths.py"


def git(d, *a):
    return subprocess.run(["git", "-C", str(d), "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *a], capture_output=True, text=True, check=True).stdout


class Gate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.d = Path(self.tmp.name)
        git(d, "init", "-q", "-b", "main")
        for p in ("workers/tools/spec_truth.py", "scripts/spec_truth.py", "tools/selfhost_check.py", "SCOPE.md", "src/app.js", ".github/CODEOWNERS"):
            (d / p).parent.mkdir(parents=True, exist_ok=True); (d / p).write_text("# guard\n")
        git(d, "add", "-A"); git(d, "commit", "-q", "-m", "base"); git(d, "checkout", "-q", "-b", "change")

    def tearDown(self):
        self.tmp.cleanup()

    def gate(self, body=""):
        git(self.d, "add", "-A"); git(self.d, "commit", "-q", "-m", "change")
        r = subprocess.run([sys.executable, str(SCRIPT), "main"], cwd=self.d, capture_output=True, text=True, env={**os.environ, "PR_BODY": body})
        return r.returncode, r.stdout

    def test_an_unprotected_change_passes_without_a_reason(self):
        (self.d / "src/app.js").write_text("// changed\n")
        code, out = self.gate()
        self.assertEqual(code, 0, out); self.assertIn("0 protected file(s)", out)

    def test_a_protected_change_needs_the_protected_change_line(self):
        (self.d / "SCOPE.md").write_text("# changed\n")
        code, out = self.gate("Item: #1\n")
        self.assertEqual(code, 1); self.assertIn("without a Protected-change: line", out)

    def test_a_protected_change_with_its_reason_passes_with_no_person_in_the_path(self):
        (self.d / "SCOPE.md").write_text("# changed\n")
        code, out = self.gate("Item: #1\nProtected-change: tightening the scope wording\n")
        self.assertEqual(code, 0, out); self.assertIn("1 protected file(s)", out)

    def test_deleting_a_guard_fails_even_with_a_reason_under_either_path(self):
        for guard in ("workers/tools/spec_truth.py", "scripts/spec_truth.py", "tools/selfhost_check.py"):
            with self.subTest(guard=guard):
                (self.d / guard).unlink()
                code, out = self.gate("Protected-change: cleanup\n")
                self.assertEqual(code, 1); self.assertIn(f"{guard}: a guard is deleted", out)

    def test_adding_a_human_approver_fails(self):
        (self.d / ".github/CODEOWNERS").write_text("# guard\n/SCOPE.md someone-who-must-approve\n".replace("someone-who-must-approve", chr(64) + "someone"))
        code, out = self.gate("Protected-change: n/a\n")
        self.assertEqual(code, 1); self.assertIn("a human approver was added", out)


if __name__ == "__main__":
    unittest.main()

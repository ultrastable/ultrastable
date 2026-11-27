# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-20-R07, T20-4: the automated protected-path gate (scripts/protected_paths.py) on a throwaway repository."""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts/protected_paths.py"


def git(d, *a):
    return subprocess.run(["git", "-C", str(d), "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *a], capture_output=True, text=True, check=True).stdout


class Repo(unittest.TestCase):
    """A throwaway repository on branch `change` off `main`, and the gate run against it."""

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


class Gate(Repo):
    def test_an_unprotected_change_passes_without_a_reason(self):
        (self.d / "src/app.js").write_text("// changed\n")
        code, out = self.gate()
        self.assertEqual(code, 0, out); self.assertIn("0 protected file(s)", out)

    def test_a_protected_change_needs_the_protected_change_line(self):
        (self.d / "SCOPE.md").write_text("# changed\n")
        code, out = self.gate("Item: #1\n")
        self.assertEqual(code, 1); self.assertIn("without a Protected-change: line", out)

    def test_the_owner_owned_registries_need_the_protected_change_line(self):
        """KERNEL-9 E1/S2: the EV registry, step repertoire, partitions and kernel pin are out of the fast loop's reach."""
        for i, rel in enumerate(("seed/autonomy/essential-variables.json", "doctrine/step-repertoire.json", "doctrine/partitions.json", "doctrine/kernel9.json", "doctrine/kernel.lock", "doctrine/kernel-9.2.0.md")):
            (self.d / rel).parent.mkdir(parents=True, exist_ok=True); (self.d / rel).write_text("{}\n" if rel.endswith("json") else "x\n")
            code, out = self.gate("Item: #1\n")
            self.assertEqual(code, 1, rel); self.assertIn("without a Protected-change: line", out, rel)

    def test_a_protected_change_with_its_reason_passes_with_no_person_in_the_path(self):
        (self.d / "SCOPE.md").write_text("# changed\n")
        code, out = self.gate("Item: #1\nProtected-change: tightening the scope wording\n")
        self.assertEqual(code, 0, out); self.assertIn("1 protected file(s)", out)

    def test_deleting_a_guard_fails_even_with_a_reason_under_either_path(self):
        for guard in ("workers/tools/spec_truth.py", "scripts/spec_truth.py", "tools/selfhost_check.py"):
            with self.subTest(guard=guard):
                (self.d / guard).unlink()
                code, out = self.gate("Protected-change: cleanup of a guard that looks unused\n")
                self.assertEqual(code, 1); self.assertIn(f"{guard}: a guard is deleted", out)
                self.assertNotIn("Protected-change: reason", out, "the reason is valid, so only the deletion fails")

    def test_adding_a_human_approver_fails(self):
        (self.d / ".github/CODEOWNERS").write_text("# guard\n/SCOPE.md someone-who-must-approve\n".replace("someone-who-must-approve", chr(64) + "someone"))
        code, out = self.gate("Protected-change: add an owner for the scope file\n")
        self.assertEqual(code, 1); self.assertIn("a human approver was added", out)
        self.assertNotIn("Protected-change: reason", out, "the reason is valid, so only the approver fails")


class Reason(Repo):
    """US-20-R07, T20-4: the Protected-change line must give a reason of at least twelve characters on its own line.
    A blank field never takes the next line as its value (the record check's rule, US-20-R02)."""

    def protected_change(self, body):
        self.n = getattr(self, "n", 0) + 1  # a fresh change each call, so every subtest has something to commit
        (self.d / "SCOPE.md").write_text(f"# changed {self.n}\n")
        return self.gate(body)

    def test_us_20_r07_a_blank_reason_does_not_take_the_next_line_lf(self):
        code, out = self.protected_change("Protected-change:\nSpec: US-20-R07\n")
        self.assertEqual(code, 1, out); self.assertIn("Protected-change: reason", out)

    def test_us_20_r07_a_blank_reason_does_not_take_the_next_line_crlf(self):
        code, out = self.protected_change("Protected-change:\r\nSpec: US-20-R07\r\n")
        self.assertEqual(code, 1, out); self.assertIn("Protected-change: reason", out)

    def test_us_20_r07_a_reason_of_spaces_and_tabs_is_blank(self):
        code, out = self.protected_change("Protected-change: \t \r\nSpec: US-20-R07\r\n")
        self.assertEqual(code, 1, out); self.assertIn("Protected-change: reason", out)

    def test_us_20_r07_a_short_reason_fails(self):
        for reason in ("x", "n/a", "cleanup", "elevenchars"):
            with self.subTest(reason=reason):
                code, out = self.protected_change(f"Protected-change: {reason}\n")
                self.assertEqual(code, 1, out); self.assertIn("Protected-change: reason", out)

    def test_us_20_r07_a_placeholder_reason_fails_whatever_its_length(self):
        for reason in ("<give the reason for this change>", "[reason for the protected change]", "TODO", "..."):
            with self.subTest(reason=reason):
                code, out = self.protected_change(f"Protected-change: {reason}\n")
                self.assertEqual(code, 1, out); self.assertIn("Protected-change: reason", out)

    def test_us_20_r07_a_twelve_character_reason_passes_on_lf_and_crlf(self):
        for body in ("Protected-change: twelve chars\n", "Item: #1\r\nProtected-change: twelve chars \r\nSpec: US-20-R07\r\n"):
            with self.subTest(body=body):
                code, out = self.protected_change(body)
                self.assertEqual(code, 0, out); self.assertIn("1 protected file(s)", out)

    def test_us_20_r07_a_body_with_no_line_still_names_the_missing_line(self):
        code, out = self.protected_change("Item: #1\n")
        self.assertEqual(code, 1, out); self.assertIn("without a Protected-change: line", out)


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""No tracked text file carries merge-conflict markers. Found 2026-11-21: README.md and platform/adapters/README.md had kept both sides of a
conflict since #832, and the generators kept rewriting inside the markers."""
import subprocess, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ConflictMarkers(unittest.TestCase):
    def test_no_conflict_markers(self):
        r = subprocess.run(["git", "-C", str(ROOT), "grep", "-l", "-E", "^(<<<<<<< |>>>>>>> )", "--", "*.md", "*.js", "*.mjs", "*.py", "*.json", "*.yml"], capture_output=True, text=True)
        self.assertIn(r.returncode, (0, 1), r.stderr)
        self.assertEqual(r.stdout.split(), [], "files with merge-conflict markers")

    def test_nested_markers_from_main_are_flattened(self):
        """MARKERS-ON-MAIN-1: a hunk whose side holds a committed hunk resolves innermost first; written text that differs stays a conflict."""
        import re
        src = (ROOT / "scripts/resolve_generated.py").read_text(encoding="utf-8")
        ns = {"re": re}
        exec(src[src.index("CLAIM = re.compile"):src.index("def soft(path):")], ns)
        c = lambda n: f"| x <!-- claim:n -->{n}<!-- /claim --> |\n"
        nested = "a\n<<<<<<< HEAD\n" + c(1) + "=======\n<<<<<<< HEAD\n" + c(2) + "=======\n" + c(3) + ">>>>>>> origin/main\n>>>>>>> origin/main\nb\n"
        out, hard = ns["flatten_text"](nested)
        self.assertEqual((out, hard), ("a\n" + c(3) + "b\n", 0))
        out, hard = ns["flatten_text"]("<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> origin/main\n")
        self.assertEqual(hard, 1); self.assertIn("<<<<<<< HEAD", out)


if __name__ == "__main__":
    unittest.main()


class ClaimBlindMerge(unittest.TestCase):
    """CLAIM-BLIND-MERGE-1: a PR that rewrites prose next to a claim value main keeps bumping merges cleanly, with main's value; a prose clash still conflicts."""

    def _repo(self, main_edit):
        import tempfile
        d = Path(tempfile.mkdtemp())
        g = lambda *a: subprocess.run(["git", "-C", str(d), *a], capture_output=True, text=True)
        g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t")
        (d / "README.md").write_text("Intro\nStatus <!-- claim:d -->775<!-- /claim --> deploys.\nEnd\n"); g("add", "."); g("commit", "-qm", "b"); g("branch", "-M", "main")
        g("checkout", "-qb", "pr"); (d / "README.md").write_text("Intro\nNew prose, <!-- claim:d -->775<!-- /claim --> recorded deploys.\nEnd\n"); g("commit", "-qam", "o")
        g("checkout", "-q", "main"); (d / "README.md").write_text(main_edit); g("commit", "-qam", "t"); g("update-ref", "refs/remotes/origin/main", "main")
        g("checkout", "-q", "pr"); g("merge", "-q", "origin/main")
        r = subprocess.run(["python3", str(ROOT / "scripts/resolve_generated.py")], cwd=d, capture_output=True, text=True)
        return r, (d / "README.md").read_text()

    def test_claim_only_change_on_main_merges_with_mains_value(self):
        r, text = self._repo("Intro\nStatus <!-- claim:d -->800<!-- /claim --> deploys.\nEnd\n")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("New prose, <!-- claim:d -->800<!-- /claim --> recorded deploys.", text)

    def test_prose_clash_still_conflicts(self):
        r, _ = self._repo("Intro\nStatus changed <!-- claim:d -->800<!-- /claim --> deploys.\nEnd\n")
        self.assertEqual(r.returncode, 1, r.stdout)

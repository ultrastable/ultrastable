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

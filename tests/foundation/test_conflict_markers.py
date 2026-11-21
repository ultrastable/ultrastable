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


if __name__ == "__main__":
    unittest.main()

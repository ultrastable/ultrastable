# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
SCRIPT = KIT / "scripts" / "repoconform.py"


class RepoConform(unittest.TestCase):
    def test_seed_conforms(self):
        r = subprocess.run([sys.executable, str(SCRIPT), "--check", str(KIT)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_empty_repo_fails(self):
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, str(SCRIPT), "--check", d], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertIn("AGENTS.md missing", r.stdout)


if __name__ == "__main__":
    unittest.main()

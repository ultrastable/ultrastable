# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import subprocess, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Drills(unittest.TestCase):
    def test_check_passes(self):
        r = subprocess.run([sys.executable, "scripts/coupling.py", "--check"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()

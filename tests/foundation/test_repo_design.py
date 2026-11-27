# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""REPO-DESIGN-1: every answer in doctrine/repo-design.json is still true."""
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RepoDesign(unittest.TestCase):
    def test_every_probe_holds(self):
        for q in json.loads((ROOT / "doctrine/repo-design.json").read_text())["questions"]:
            kind, _, arg = q["probe"].partition(":")
            with self.subTest(q["id"]):
                if kind == "file":
                    self.assertTrue((ROOT / arg).is_file(), arg)
                elif kind == "grep":
                    path, pat = arg.split("::", 1)
                    self.assertRegex((ROOT / path).read_text(), re.compile(pat))
                elif kind == "cmd":
                    r = subprocess.run(arg.split(), cwd=ROOT, capture_output=True, text=True)
                    self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
                else:
                    self.fail("unknown probe kind " + kind)


if __name__ == "__main__":
    unittest.main()

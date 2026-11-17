# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CLAIMS-1 in the seed: every tenant ships the checker, a registry and the rule."""
import subprocess, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class SeedClaims(unittest.TestCase):
    def test_check_passes(self):
        r = subprocess.run([sys.executable, "scripts/claims.py", "--check"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_rule_is_in_the_agent_file(self):
        self.assertIn("CLAIMS-1", (ROOT / "agents/AGENTS.md").read_text(encoding="utf-8"))

    def test_checker_is_the_platform_copy(self):
        ref = ROOT.parent / "foundation/claims.py"
        if ref.is_file():  # in the platform repository the seed copy must not drift from the reference
            self.assertEqual(ref.read_text(encoding="utf-8"), (ROOT / "scripts/claims.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""IDEA-BANK-1: every front-door idea boots through the seed, the bank stays diverse, and the generated file is current."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_idea_bank as B  # noqa: E402


class IdeaBank(unittest.TestCase):
    def test_check_passes(self):
        r = subprocess.run([sys.executable, "scripts/build_idea_bank.py", "--check"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_gate_refuses_an_idea_without_a_loop_or_budget(self):
        i = json.loads(B.BANK.read_text())["ideas"][0]
        self.assertTrue(B.boot(i)[0])
        self.assertFalse(B.boot(dict(i, loop=""))[0])
        self.assertFalse(B.boot(dict(i, budget=0))[0])

    def test_diversity_rule_bites(self):
        bank = json.loads(B.BANK.read_text())
        bank["ideas"] = [dict(i, domain="same") for i in bank["ideas"]][:4]
        self.assertTrue(any("domains" in e for e in B.validate(bank)))


    def test_depth_rule_bites(self):
        bank = json.loads(B.BANK.read_text())
        bank["ideas"] = [dict(bank["ideas"][0], depth={})]
        self.assertTrue(any("depth" in e for e in B.validate(bank)))


if __name__ == "__main__":
    unittest.main()

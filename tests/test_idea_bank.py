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

    def test_commerce_is_refused(self):
        bank = json.loads(B.BANK.read_text())
        bank["ideas"] = [dict(bank["ideas"][0], domain="e-commerce")]
        self.assertTrue(any("refused" in e for e in B.validate(bank)))

    def test_data_required(self):
        bank = json.loads(B.BANK.read_text())
        bank["ideas"] = [dict(bank["ideas"][0], data=[])]
        self.assertTrue(any("data" in e for e in B.validate(bank)))

    def test_breadth_rule_refuses_a_single_field_idea_and_grow_is_shown_the_owner_edits(self):
        bank = json.loads((ROOT / "doctrine/idea-bank.json").read_text())
        self.assertTrue(bank["owner_edits"])
        seen = []
        B.grow(json.loads(json.dumps(bank)), complete=lambda p: seen.append(p) or None)
        self.assertIn(bank["owner_edits"][-1]["after"], seen[0])
        bank["ideas"][0]["text"] = "A ledger for a field of study"
        self.assertTrue(any("BREADTH-1" in e for e in B.validate(bank)))

    def test_grow_admits_only_through_the_gates(self):
        bank = json.loads(B.BANK.read_text())
        good = dict(bank["ideas"][0], id="new-one", domain="health", data=[{"name": "own", "note": "own records"}])
        self.assertEqual(B.grow(json.loads(json.dumps(bank)), complete=lambda p: good), (True, "new-one"))
        bad = dict(good, domain="e-commerce")
        self.assertFalse(B.grow(json.loads(json.dumps(bank)), complete=lambda p: bad)[0])


if __name__ == "__main__":
    unittest.main()

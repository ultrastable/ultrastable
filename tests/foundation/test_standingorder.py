# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CODE-ONLY-ORDER: decisions live in code the system consumes; no report hands a decision to the owner."""
import json, shutil, unittest
from pathlib import Path
from foundation import standingorder as so
import _repo
scratch = _repo.scratch

REPO = Path(__file__).resolve().parents[2]


class StandingOrder(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(so.check(REPO), [])

    def test_lint_flags_decision_handed_to_owner(self):
        for t in ("Your call on which to ship.", "Do you want me to deploy it?", "Awaiting your decision.", "Let me know if that works."):
            self.assertTrue(so.lint(t), t)

    def test_lint_passes_decided_report(self):
        self.assertEqual(so.lint("Decided: ship A. Deployed and verified live at /health."), [])

    def test_ledger_row_without_code_consumer_fails(self):
        tmp = scratch()
        if True:
            (tmp / "doctrine").mkdir(); (tmp / "notes.md").write_text("x")
            shutil.copy(REPO / so.PATH, tmp / so.PATH)
            (tmp / "doctrine/decision-ledger.json").write_text(json.dumps({"rows": [
                {"id": "d1", "kind": "decision", "probe": "file:notes.md"}]}))
            d = so.load(tmp)
            self.assertEqual(so.consumerless(tmp, d), ["d1"])
            self.assertTrue(so.ledger_failures(tmp, d))

    def test_ledger_row_deferring_a_deploy_to_the_owner_fails(self):
        """DEPLOY-PREAPPROVED-1: the What Works deploy was recorded as 'deploy after owner go-ahead' and held although deploys were pre-approved."""
        for t in ("What Works tenant: grades computed, deploy after owner go-ahead", "Added to topology once the owner confirms the production deploy.",
                  "The deploy is held for a manual go-ahead."):
            self.assertTrue(so.lint(t), t)
        tmp = scratch()
        (tmp / "doctrine").mkdir(); (tmp / "x.py").write_text("x")
        shutil.copy(REPO / so.PATH, tmp / so.PATH)
        (tmp / "doctrine/decision-ledger.json").write_text(json.dumps({"rows": [
            {"id": "d2", "kind": "decision", "title": "Ship the tenant once Rowan approves", "body": "", "probe": "file:x.py"},
            {"id": "d3", "kind": "decision", "title": "Ship the tenant", "body": "Deployed and probed live.", "probe": "file:x.py"}]}))
        d = so.load(tmp)
        self.assertEqual(so.ledger_handoffs(tmp, d), ["d2"])
        self.assertTrue(any("d2" in f for f in so.ledger_handoff_failures(tmp, d)))

    def test_seed_copy_matches(self):
        self.assertEqual((REPO / so.PATH).read_text(), (REPO / "seed/doctrine/standing-order.json").read_text())


if __name__ == "__main__":
    unittest.main()

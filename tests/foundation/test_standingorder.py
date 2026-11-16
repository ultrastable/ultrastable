# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""CODE-ONLY-ORDER: decisions live in code the system consumes; no report hands a decision to the owner."""
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import standingorder as so

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
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "doctrine").mkdir(); (tmp / "notes.md").write_text("x")
            shutil.copy(REPO / so.PATH, tmp / so.PATH)
            (tmp / "doctrine/decision-ledger.json").write_text(json.dumps({"rows": [
                {"id": "d1", "kind": "decision", "probe": "file:notes.md"}]}))
            d = so.load(tmp)
            self.assertEqual(so.consumerless(tmp, d), ["d1"])
            self.assertTrue(so.ledger_failures(tmp, d))
        finally:
            shutil.rmtree(tmp)

    def test_seed_copy_matches(self):
        self.assertEqual((REPO / so.PATH).read_text(), (REPO / "seed/doctrine/standing-order.json").read_text())


if __name__ == "__main__":
    unittest.main()

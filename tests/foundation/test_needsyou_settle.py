# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""GATE-SETTLE-1: an owner gate closes on its own evidence; one without evidence stays."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import needsyou  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


class Settle(unittest.TestCase):
    def test_evidence_closes_the_gate(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); (d / "doctrine").mkdir()
            data = d / "n.json"
            data.write_text(json.dumps({"items": [{"id": "a", "resolved_when": "actions-running"}, {"id": "b", "resolved_when": "env:X|Y"}, {"id": "c"}], "done_for_you": []}))
            (d / "doctrine/point-and-click.json").write_text(json.dumps({"connect_link": {"deep_link_baseline": ["a", "c"]}}))
            self.assertEqual(needsyou.settle(d, {}, data), [])
            self.assertEqual(needsyou.settle(d, {"GITHUB_ACTIONS": "true", "Y": "v"}, data), ["a", "b"])
            self.assertEqual([i["id"] for i in json.loads(data.read_text())["items"]], ["c"])
            self.assertEqual(json.loads((d / "doctrine/point-and-click.json").read_text())["connect_link"]["deep_link_baseline"], ["c"])

    def test_wired(self):
        self.assertIn("foundation needsyou --settle", (REPO / ".github/workflows/watchdog.yml").read_text())
        self.assertNotIn("actions-billing", (REPO / "foundation/data/needs-you.json").read_text(), "Actions runs; the payment gate is closed")


if __name__ == "__main__":
    unittest.main()

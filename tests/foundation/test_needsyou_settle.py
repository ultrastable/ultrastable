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

    def test_live_page_evidence(self):
        """GATE-SETTLE-2: a credential the Worker sealed itself is seen on its live connect page; an unreadable page is not evidence."""
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); data = d / "n.json"
            data.write_text(json.dumps({"items": [
                {"id": "gh", "title": "Connect GitHub", "resolved_when": ["env:LANE_PAT", "http:https://x.test/connect/github ~ GitHub is connected"]},
                {"id": "bsky", "title": "Bluesky", "resolved_when": ["http:https://x.test/connect/bluesky ~ Bluesky is connected"]},
                {"id": "bad", "title": "Plain http", "resolved_when": ["http:http://x.test/a ~ ok"]}], "done_for_you": []}))
            pages = {"https://x.test/connect/github": "<h1>GitHub is connected</h1>", "https://x.test/connect/bluesky": "<h1>Connect Bluesky</h1>"}
            fetch = lambda url, text: text in pages.get(url, "")
            self.assertEqual(needsyou.settle(d, {}, data, fetch), ["gh"])
            j = json.loads(data.read_text())
            self.assertEqual([i["id"] for i in j["items"]], ["bsky", "bad"])
            self.assertTrue(j["done_for_you"][0].startswith("Connect GitHub: settled "))

    def test_live_items_have_evidence(self):
        """Every connect-flow gate names live evidence, so the fleet closes it without a person editing data."""
        for i in json.loads((REPO / "foundation/data/needs-you.json").read_text(encoding="utf-8"))["items"]:
            if i.get("connect_kind") == "connect-flow":
                self.assertTrue(any(str(w).startswith("http:https://") for w in (i.get("resolved_when") if isinstance(i.get("resolved_when"), list) else [i.get("resolved_when", "")])), i["id"])

    def test_wired(self):
        self.assertIn("foundation needsyou --settle", (REPO / ".github/workflows/watchdog.yml").read_text())
        self.assertNotIn("actions-billing", (REPO / "foundation/data/needs-you.json").read_text(), "Actions runs; the payment gate is closed")


if __name__ == "__main__":
    unittest.main()

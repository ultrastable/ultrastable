# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import needs_code_bridge as B


class Bridge(unittest.TestCase):
    ITEMS = [{"id": "RM-1", "title": "RM-1: serve the card", "owner_role": "operations", "done_check": "site/agentic.js serves it", "blocker": "needs-code: edit site/agentic.js"},
             {"id": "OW-1", "title": "sign", "blocker": "owner-only: sign"}, {"id": "IP-1", "title": "in pr", "blocker": "in-pr: https://x/pull/1"}]

    def test_only_needs_code_items_become_records_and_never_twice(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(B.bridge(self.ITEMS, root=d), ["NC-RM-1"])
            rec = json.loads((Path(d) / "docs/issues/NC-RM-1.json").read_text())
            self.assertIn("**Status:** open", rec["body"]); self.assertIn("site/agentic.js serves it", rec["body"]); self.assertIn("needs-code", rec["labels"])
            self.assertEqual(B.bridge(self.ITEMS, root=d), [], "idempotent: an existing record is never rewritten")

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(B.bridge(self.ITEMS, root=d, dry=True), ["NC-RM-1"]); self.assertFalse((Path(d) / "docs").exists())

    def test_an_unreachable_api_is_not_a_failure(self):
        self.assertEqual(B.main(["--api", "http://127.0.0.1:9/none", "--dry-run"]), 0)


if __name__ == "__main__":
    unittest.main()


class Probe(unittest.TestCase):
    def test_the_record_carries_a_probe_the_system_can_run(self):
        rec = B.record(Bridge.ITEMS[0])
        self.assertIn("**Done check:** cmd:python3 scripts/needs_code_bridge.py --probe RM-1", rec["body"])   # BRIDGE-PROBE-1: passes the pins check

    def test_parked_means_open_and_an_unreadable_api_is_unmeasured(self):
        self.assertTrue(B.still_parked(Bridge.ITEMS, "RM-1"))
        self.assertFalse(B.still_parked(Bridge.ITEMS, "IP-1"))
        self.assertEqual(B.main(["--api", "http://127.0.0.1:9/none", "--probe", "RM-1"]), 1)

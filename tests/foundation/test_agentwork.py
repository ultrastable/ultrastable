# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AGENT-WORK-1: caps and kill switch fence the agent; unknown facts become queue items; the kill probe proves the stop."""
import json, sys, shutil, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _repo  # noqa: E402
from foundation import agentwork

REPO = Path(__file__).resolve().parents[2]


class AgentWork(unittest.TestCase):
    def setUp(self):
        self.d = Path(_repo.scratch()); (self.d / "doctrine").mkdir(); (self.d / "ops").mkdir(); (self.d / "docs/issues").mkdir(parents=True)
        shutil.copy(REPO / agentwork.CFG, self.d / agentwork.CFG)

    def test_within_caps_goes(self):
        self.assertTrue(agentwork.gate(self.d, {}, lambda *a: (0, "1"), repo="o/r")["go"])

    def test_kill_switch_variable_and_file_stop_it(self):
        self.assertFalse(agentwork.gate(self.d, {"AGENT_KILL": "1"}, lambda *a: (0, "0"))["go"])
        self.assertFalse(agentwork.gate(self.d, {"HALT": "1"}, lambda *a: (0, "0"))["go"])
        (self.d / "ops/agent-kill").write_text("x"); self.assertFalse(agentwork.gate(self.d, {}, lambda *a: (0, "0"))["go"])

    def test_caps_stop_it_and_unreadable_input_fails_closed(self):
        self.assertFalse(agentwork.gate(self.d, {}, lambda *a: (0, "3"), repo="o/r")["go"])
        self.assertFalse(agentwork.gate(self.d, {}, lambda *a: (1, "err"), repo="o/r")["go"])
        (self.d / "ops/agent-cost.jsonl").write_text(json.dumps({"at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "usd": 5}) + "\n")
        self.assertIn("spend", agentwork.gate(self.d, {}, lambda *a: (0, "0"), repo="o/r")["why"])

    def test_probe_kill_and_check(self):
        self.assertEqual(agentwork.main(["--probe-kill"]), 0); self.assertEqual(agentwork.check(REPO), [])


if __name__ == "__main__":
    unittest.main()

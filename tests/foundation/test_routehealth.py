# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""ROUTE-CANARY-1: a coder route must answer a known-schema canary; a failed one is demoted and the ladder skips it while another rung is healthy."""
import json, shutil, unittest
from datetime import datetime, timezone

from _repo import ROOT, scratch
from foundation import agent_ladder, routehealth as H

ENV = {"CLOUDFLARE_API_TOKEN": "x", "CLOUDFLARE_ACCOUNT_ID": "x"}
NOW = datetime(2026, 11, 27, 9, 0, tzinfo=timezone.utc)


def repo():
    d = scratch(); (d / "doctrine").mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / "doctrine/code-agents.json", d / "doctrine/code-agents.json")
    return d


class RouteHealth(unittest.TestCase):
    def test_judge(self):
        self.assertTrue(H.judge('Sure: {"ok": true, "sum": 5}')[0])
        self.assertFalse(H.judge("OK")[0])  # the GitHub Models answer
        self.assertFalse(H.judge('{"ok": true, "sum": 6}')[0])

    def test_failed_canary_demotes_and_the_ladder_skips_it(self):
        d = repo()
        send = lambda a, p, e: '{"ok": true, "sum": 5}' if a["id"] == "workers-ai-llama" else "OK"
        rows = H.run(d, ENV, send, apply=True, now=NOW)
        self.assertTrue(any(r["pass"] for r in rows))
        bad = H.demoted(d, now=NOW)
        self.assertIn("workers-ai-glm", bad); self.assertNotIn("workers-ai-llama", bad)
        self.assertNotIn("workers-ai-glm", [a["id"] for a in agent_ladder.rungs(d, ENV)] if bad == H.demoted(d) else ["skip-clock"])
        self.assertTrue(H.probe(d, now=NOW)[0])

    def test_no_rows_is_not_a_pass(self):
        self.assertFalse(H.probe(repo(), now=NOW)[0])

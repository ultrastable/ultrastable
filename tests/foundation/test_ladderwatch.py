# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""LADDER-LIVE-1: a dead code-agent ladder fails the check; a dead-ladder failure never shelves an item."""
import json, tempfile, unittest
from datetime import datetime, timezone
from pathlib import Path
from foundation import ladderwatch, dispose

NOW = datetime(2026, 11, 26, 6, 0, tzinfo=timezone.utc)


def item(d, i, dead):
    reason = "every code agent rung failed: workers-ai-glm: HTTPError: HTTP Error 401: Unauthorized" if dead else "a test failed"
    body = f"**Status:** closed\n**Disposition:** shelved (executor-failed, 2026-11-26T05:00:00Z, DISPOSE-1)\n**Evidence:** last reason: {reason}\n"
    (d / f"Q-{i}.json").write_text(json.dumps({"id": f"Q-{i}", "body": body}))


class Ladder(unittest.TestCase):
    def run_with(self, dead, live):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t) / "docs" / "issues"; d.mkdir(parents=True)
            for i in range(dead): item(d, f"d{i}", True)
            for i in range(live): item(d, f"l{i}", False)
            return ladderwatch.read(t, 24, NOW)

    def test_dead(self):
        r = self.run_with(4, 1)
        self.assertEqual(r["state"], "dead")
        self.assertIn("workers-ai-glm", r["rungs_failing"])

    def test_ok_and_unmeasured(self):
        self.assertEqual(self.run_with(1, 5)["state"], "ok")
        self.assertEqual(self.run_with(0, 0)["state"], "unmeasured")

    def test_dispose_skips_dead_ladder(self):
        c = {"owner_bound": "^$", "fail_limit": 3, "gate_default": "x", "ttl_hours": 9999}
        it = {"owner": "executor", "labels": []}
        self.assertIsNone(dispose.decide(it, 0.0, 3, c, "RuntimeError: every code agent rung failed: x"))
        self.assertEqual(dispose.decide(it, 0.0, 3, c, "a test failed")[1], "executor-failed")


if __name__ == "__main__":
    unittest.main()


class NoRouteReading(unittest.TestCase):
    def test_no_route_rows_mark_the_ladder_dead(self):
        d = Path(tempfile.mkdtemp())
        (d / "docs/issues").mkdir(parents=True)
        now = datetime(2026, 11, 27, 13, 0, tzinfo=timezone.utc)
        rows = [{"at": "2026-11-27T12:0%d:00Z" % i, "issue": f"Q-{i}", "result": "no-route",
                 "detail": "every code agent rung failed: workers-ai-glm: HTTPError: HTTP Error 502: Bad Gateway"} for i in range(3)]
        r = ladderwatch.read(d, now=now, executor_rows=rows)
        self.assertEqual((r["state"], r["no_route_runs"]), ("dead", 3))
        self.assertIn("workers-ai-glm", r["rungs_failing"])
        rows += [{"at": "2026-11-27T12:3%d:00Z" % i, "issue": "Q-ok", "result": "pr-opened"} for i in range(4)]
        self.assertEqual(ladderwatch.read(d, now=now, executor_rows=rows)["state"], "ok")

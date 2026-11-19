"""CLOCKWORK-1: a clock's status is measured from its beats; chaining is bounded and backs off; the declaration is complete."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import clock as C  # noqa: E402


class Clock(unittest.TestCase):
    def test_declaration_is_complete(self):
        self.assertEqual(C.check(), [])

    def test_status_thresholds(self):
        self.assertEqual(C.status(100, 600), "ticking")
        self.assertEqual(C.status(900, 600), "ticking")
        self.assertEqual(C.status(901, 600), "late")
        self.assertEqual(C.status(1801, 600), "stopped")
        self.assertEqual(C.status(None, 600), "stopped")
        self.assertEqual(C.status(99999, 600, idle=True), "idle")

    def test_jitter_and_measure(self):
        beats = [0, 600, 1200, 1805, 2400]
        self.assertEqual(C.jitter(beats, 600), 2.5)
        m = C.measure(beats, 600, now=2500)
        self.assertEqual(m["status"], "ticking"); self.assertEqual(m["beats_24h"], 5)
        self.assertIsNone(C.measure(beats, 600, now=2500, periodic=False)["median_jitter_s"])
        self.assertEqual(C.measure([], 600, now=1)["status"], "stopped")

    def test_chain_is_bounded_and_backs_off(self):
        self.assertEqual(C.should_chain(1, 4, 5, ["success"], 3), (True, "5 takeable item(s), 1 of 4 runs used today"))
        self.assertFalse(C.should_chain(4, 4, 5, [], 3)[0])          # daily cap
        self.assertFalse(C.should_chain(0, 4, 0, [], 3)[0])          # nothing to do
        self.assertFalse(C.should_chain(0, 4, -1, [], 3)[0])         # queue unreadable
        self.assertFalse(C.should_chain(1, 4, 5, ["failure"] * 3, 3)[0])   # three failures in a row
        self.assertTrue(C.should_chain(1, 4, 5, ["failure", "failure", "success"], 3)[0])
        self.assertFalse(C.should_chain(0, 4, 5, [], 3, budget_ok=False)[0])

    def test_an_older_unfinished_run_holds_the_spark(self):  # SPARK-BUSY-1
        rows = [{"databaseId": 3, "status": "in_progress", "createdAt": "2026-11-19T10:10:00Z"},
                {"databaseId": 2, "status": "queued", "createdAt": "2026-11-19T10:05:00Z"},
                {"databaseId": 1, "status": "completed", "createdAt": "2026-11-19T10:00:00Z"},
                {"databaseId": 0, "status": "queued", "createdAt": "2026-11-19T08:00:00Z"}]  # wedged two hours: not busy
        self.assertEqual([r["databaseId"] for r in C.older_unfinished(rows, "3")], [2])
        self.assertEqual(C.older_unfinished(rows, "2"), [])  # the oldest live run goes ahead, so two sparks never both stand down
        now = C._ts("2026-11-19T10:20:00Z")
        self.assertEqual([r["databaseId"] for r in C.older_unfinished(rows, None, now)], [3, 2])

    def test_cap_counts_attempts_not_wakeups(self):
        now = C._ts("2026-11-13T12:00:00Z")
        rows = [{"at": "2026-11-13T08:40:59Z", "host": "github-actions:workflow_run", "issue": "Q-1", "result": "pr-opened"},
                {"at": "2026-11-13T09:00:00Z", "host": "github-actions:workflow_run", "issue": "Q-2", "result": "failed"},
                {"at": "2026-11-13T09:10:00Z", "host": "github-actions:workflow_run", "result": "idle"},            # a wake-up with nothing to take
                {"at": "2026-11-13T09:20:00Z", "host": "claude-session", "issue": 34, "result": "verified-no-change"},  # another host's work
                {"at": "2026-11-11T09:00:00Z", "host": "github-actions:schedule", "issue": "Q-0", "result": "failed"},  # older than a day
                {"at": "not a time", "host": "github-actions:schedule", "issue": "Q-9", "result": "failed"}]
        self.assertEqual(C.attempts_last_24h(rows, now), 2)
        self.assertTrue(C.should_chain(C.attempts_last_24h(rows, now), 4, 5, ["success"] * 20, 3)[0])  # 20 gated wake-ups no longer fill the cap

    def test_d1_window_covers_a_full_day_of_beats(self):
        import unittest.mock as m
        seen = {}
        def fake(path, body, token, acct):
            seen["sql"] = body["sql"]; return {"result": [{"results": []}]}
        c = C.load()["clocks"][0]
        with m.patch.object(C, "_cf", fake):
            C.d1_beats(c, "t", "a")
        self.assertIn("LIMIT 156", seen["sql"])   # 144 beats a day plus a margin, not a truncated 60

    def test_executor_workflow_runs_the_chain_step(self):
        t = (C.REPO / ".github/workflows/executor.yml").read_text(encoding="utf-8")
        self.assertIn("foundation clock --chain --apply", t)
        self.assertIn("github.token", t)


class PublicMinutes(unittest.TestCase):
    def test_public_repo_lifts_the_cap(self):
        from foundation import clock as c
        cfg = {"max_runs_per_day": 4, "max_runs_per_day_public": 48}
        self.assertEqual(c.daily_cap(cfg, private=False), (48, "public"))
        self.assertEqual(c.daily_cap(cfg, private=True), (4, "private"))
        self.assertEqual(c.daily_cap({"max_runs_per_day": 4}, private=False)[0], 4)

if __name__ == "__main__":
    unittest.main()

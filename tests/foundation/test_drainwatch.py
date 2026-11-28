"""DRAIN-FLEET-1 and CHECKS-SESSION-1: fleet counts are exact and unreadable repos are never 0; the session checks route reads every step."""
import datetime as dt, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import drainwatch as D, checksrun as C  # noqa: E402


class Timely(unittest.TestCase):
    """TIMELY-1: a system resolves its own issues and merges its own pull requests in time; lateness is a reading, and an unreadable repository is never on time."""
    NOW = dt.datetime(2026, 11, 28, 12, tzinfo=dt.timezone.utc)

    @staticmethod
    def issue(n, created, *labels):
        return {"number": n, "created_at": created, "labels": [{"name": x} for x in labels]}

    @staticmethod
    def pr(n, created, draft=False, *labels):
        return {"number": n, "created_at": created, "draft": draft, "labels": [{"name": x} for x in labels]}

    def test_overdue_is_past_the_sla_for_issues_and_past_a_day_for_a_ready_pull_request(self):
        i, pr = self.issue, self.pr
        raw = {"o/a": {"issues": [i(1, "2026-11-28T08:00:00Z", "p2"),                 # 4 h of 72: on time
                                  i(2, "2026-11-25T08:00:00Z", "p2", "queue"),         # 76 h of 72: a mirrored queue item is aged too
                                  i(3, "2026-11-20T00:00:00Z", "hold"),                # a declared wait is not overdue
                                  i(4, "2026-11-27T00:00:00Z"),                        # no priority: the p3 limit, 36 h of 168
                                  i(5, "2026-11-27T00:00:00Z", "p0"),                  # 36 h of 4
                                  {"number": 9, "pull_request": {}, "created_at": "2026-01-01T00:00:00Z", "labels": []}],
                         "pulls": [pr(10, "2026-11-27T00:00:00Z"),                     # 36 h of 24
                                   pr(11, "2026-11-27T00:00:00Z", True),               # a draft is a session's work in progress
                                   pr(12, "2026-11-27T00:00:00Z", False, "needs-pat"), # waits on a credential with its default in effect
                                   pr(13, "2026-11-28T06:00:00Z")]},                   # 6 h
               "o/b": {"issues": None, "pulls": []}}
        o = D.overdue(raw, self.NOW)
        self.assertEqual([(x["kind"], x["number"], x["limit_h"]) for x in o["rows"]], [("issue", 2, 72), ("issue", 5, 4), ("pr", 10, 24)])
        self.assertEqual(o["unmeasured"], ["o/b"])

    def test_nothing_overdue_and_everything_read_is_timely(self):
        o = D.overdue({"o/a": {"issues": [self.issue(1, "2026-11-28T08:00:00Z", "p1")], "pulls": []}}, self.NOW)
        self.assertEqual((o["rows"], o["unmeasured"]), ([], []))

    def test_the_timely_command_exits_one_on_a_late_item_or_an_unreadable_repository(self):
        late = {"o/a": {"issues": [self.issue(2, "2026-01-01T00:00:00Z", "p2")], "pulls": []}}  # main() reads the real clock: this one is late on any day
        orig = D.read
        try:
            D.read = lambda *a, **k: late
            self.assertEqual(D.main(["--timely"]), 1)
            D.read = lambda *a, **k: {"o/a": {"issues": [], "pulls": []}}
            self.assertEqual(D.main(["--timely"]), 0)
            D.read = lambda *a, **k: {"o/a": {"issues": None, "pulls": []}}
            self.assertEqual(D.main(["--timely"]), 1)
        finally:
            D.read = orig


class Drain(unittest.TestCase):
    def test_counts_exclude_prs_from_issues_and_flag_unmeasured(self):
        s = D.summarize({"o/a": {"issues": [{"n": 1}, {"pull_request": {}}], "pulls": [{"n": 2}]}, "o/b": {"issues": None, "pulls": []}})
        self.assertEqual(s["repos"]["o/a"], {"open_issues": 1, "open_prs": 1})
        self.assertEqual(s["unmeasured"], ["o/b"])
        self.assertFalse(s["drained"])
        self.assertTrue(D.summarize({"o/a": {"issues": [], "pulls": []}})["drained"])

    def test_fleet_is_every_declared_repo(self):
        self.assertIn("ultrastable/ultrastable", D.repos())
        self.assertGreaterEqual(len(D.repos()), 6)


class ChecksRun(unittest.TestCase):
    def test_every_run_step_is_read_and_expressions_resolve(self):
        st = C.steps()
        self.assertGreater(len(st), 10)
        self.assertNotIn("${{", C.resolve("git diff origin/${{ github.base_ref || 'main' }}"))

    def test_failed_step_is_reported(self):
        class P:
            def __init__(s, rc): s.returncode, s.stdout, s.stderr = rc, "", "boom"
        r = C.run(runner=lambda sc, cwd, env: P(1 if "lint_workflows" in sc else 0))
        self.assertEqual(len(r["failed"]), 1)

    def test_a_step_that_times_out_is_a_failed_step_not_a_crash(self):
        import subprocess

        class P:
            returncode, stdout, stderr = 0, "", ""

        def runner(sc, cwd, env):
            if "lint_workflows" in sc:
                raise subprocess.TimeoutExpired(["bash"], 600, output=b"half done")
            return P()
        r = C.run(runner=runner)
        self.assertEqual(len(r["failed"]), 1)
        bad = [x for x in r["results"] if not x["ok"]][0]
        self.assertIn("timed out after 600 s", bad["tail"])


if __name__ == "__main__":
    unittest.main()

"""DRAIN-FLEET-1 and CHECKS-SESSION-1: fleet counts are exact and unreadable repos are never 0; the session checks route reads every step."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import drainwatch as D, checksrun as C  # noqa: E402


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

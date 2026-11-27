# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import io, json, os, unittest
from unittest import mock

from _repo import scratch
from test_regulator import make_repo, REPO
from foundation.regulator import Store, RepoModel, ConclusionCache, EssentialVariable, Registry, affected_tests, cli
from foundation.regulator.ledger_hook import safe_record


class FailureModes(unittest.TestCase):
    def test_evidence_outside_repo_is_refused(self):
        d = make_repo(REPO)
        outside = scratch() / "secret.txt"; outside.write_text("x")
        with self.assertRaises(ValueError):
            ConclusionCache(Store(), d).put("q", "a", [os.path.relpath(outside, d)])

    def test_unreadable_file_does_not_abort_index(self):
        d = make_repo(REPO)
        os.symlink(os.path.join(d, "missing_target.py"), os.path.join(d, "broken.py"))
        r = RepoModel(Store(), d).update()
        self.assertEqual(r["parsed"], 8)

    def test_dot_slash_paths_still_use_the_impact_set(self):
        m = RepoModel(Store(), make_repo(REPO)); m.update()
        self.assertEqual(affected_tests(m, ["./core/util.py"])[1], "impact_set")

    def test_exhausted_menu_does_not_flood_escalations(self):
        s = Store(); r = Registry(s, [EssentialVariable("x", hi=1)])
        r.record("global", "x", 5)
        fired = [len(r.step()) for _ in range(9)]
        self.assertEqual(sum(fired), 5)  # the five menu steps, then one open call_human and silence

    def test_hook_swallows_bad_input(self):
        s = Store()
        for raw in ["", "not json", "[1,2]", '{"tool_name": 5}', "null"]:
            safe_record(s, raw)
        self.assertEqual(safe_record(s, json.dumps({"tool_name": "Read", "tool_response": "abc"})), True)

    def test_cli_usage_errors_are_clean_and_db_is_closed(self):
        for argv in (["impact"], ["ask"], ["tell", "only-one"]):
            with mock.patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit) as c:
                cli.main(argv + ["--db", str(scratch() / "l.sqlite")])
            self.assertEqual(c.exception.code, 2)


if __name__ == "__main__":
    unittest.main()


class ConcurrentWriters(unittest.TestCase):
    def test_two_processes_writing_one_ledger_lose_no_rows(self):
        import subprocess, sys
        db = str(scratch() / "c.sqlite")
        Store(db).close()
        code = ("import sys; from foundation.regulator import Store; s=Store(sys.argv[1])\n"
                "for i in range(100): s.log_tokens(sys.argv[2], 'm', 'read', 1, 1)\ns.close()")
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        ps = [subprocess.Popen([sys.executable, "-c", code, db, t], cwd=root) for t in ("a", "b", "c")]
        self.assertEqual([p.wait() for p in ps], [0, 0, 0])
        s = Store(db)
        self.assertEqual(s.db.execute("select count(*) from token_log").fetchone()[0], 300)
        s.close()

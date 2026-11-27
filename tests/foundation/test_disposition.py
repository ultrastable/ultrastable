# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import contextlib, io, sqlite3, unittest
from pathlib import Path

from foundation import disposition, executor

REPO = Path(__file__).resolve().parents[2]


class Disposition(unittest.TestCase):
    def test_every_result_maps_and_kinds_are_the_kernel_five(self):
        self.assertEqual(disposition.KINDS, ("done", "flagged", "blocked_by_gate", "deferred_budget", "failed"))
        self.assertTrue(set(v for v in disposition.MAP.values() if v) <= set(disposition.KINDS))

    def test_done_needs_a_verifier(self):
        rs = [{"result": "pr-merged", "at": "2026-11-28T00:00:00Z", "issue": 1}]
        self.assertTrue(any("without a verifier" in b for b in disposition.check(rs=rs)))
        rs[0]["merge_commit"] = "abc"
        self.assertEqual(disposition.check(rs=rs), [])

    def test_unknown_result_fails(self):
        self.assertTrue(disposition.check(rs=[{"result": "made-it-up"}]))

    def test_out_of_time_failure_is_deferred(self):
        self.assertEqual(disposition.classify({"result": "failed", "out_of_time": "5 s"})[0], "deferred_budget")
        self.assertEqual(disposition.classify({"result": "flagged"})[0], "flagged")

    def test_record_refuses_a_self_verified_done(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            executor.main(["--record", "--issue", "9", "--result", "verified-no-change"])

    def test_migration_refuses_done_without_verifier(self):
        db = sqlite3.connect(":memory:")
        db.executescript((REPO / "seed/worker/migrations/0035_disposition.sql").read_text().replace("(unixepoch())", "0"))
        db.execute("INSERT INTO disposition(item,tick,kind,evidence_uri,verifier) VALUES('a',1,'done','r2://x','ci:1')")
        db.execute("INSERT INTO disposition(item,tick,kind,evidence_uri) VALUES('b',1,'flagged','r2://y')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO disposition(item,tick,kind,evidence_uri) VALUES('c',1,'done','r2://z')")
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO disposition(item,tick,kind,evidence_uri,verifier) VALUES('d',1,'yes','r2://z','v')")

    def test_recall_keeps_failures_and_skips_outages(self):
        rs = [{"issue": "Q-1", "result": "failed", "detail": "test_x broke", "at": "a"},
              {"issue": "Q-1", "result": "no-route", "detail": "502", "at": "b"},
              {"issue": "Q-1", "result": "pr-closed", "pr": "https://x/pull/9", "at": "c"},
              {"issue": "Q-2", "result": "failed", "detail": "other", "at": "d"}]
        got = disposition.recall("Q-1", rs)
        self.assertEqual(len(got), 2)
        self.assertIn("test_x broke", got[0]); self.assertIn("pull/9", got[1])
        self.assertEqual(disposition.recall_rate(rs), 1.0)

    def test_repo_passes(self):
        self.assertEqual(disposition.check(REPO), [])


if __name__ == "__main__":
    unittest.main()

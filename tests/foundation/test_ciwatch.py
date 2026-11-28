# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CIWATCH-1: a red default-branch run is rerun once when transient, otherwise filed as a queue item; green runs are recorded; unreadable repos are unmeasured."""
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _repo  # noqa: E402
from foundation import ciwatch

REPO = Path(__file__).resolve().parents[2]


def fake(runs, logs):
    def gh(*a):
        s = " ".join(a)
        if s.endswith(".default_branch"): return 0, "main\n"
        if "actions/runs?" in s: return 0, json.dumps(runs)
        if "--log-failed" in s: return 0, logs
        if "rerun" in s: return 0, "ok"
        return 1, "unexpected " + s
    return gh


def r(i, name, concl): return {"id": i, "name": name, "conclusion": concl, "created_at": "t", "html_url": "u", "head_sha": "s"}


class CiWatch(unittest.TestCase):
    def setUp(self):
        self.d = Path(_repo.scratch()); (self.d / "doctrine").mkdir(); (self.d / "docs/issues").mkdir(parents=True)
        cfg = ciwatch.load(REPO); cfg["repos"] = ["o/r"]; (self.d / ciwatch.CFG).write_text(json.dumps(cfg))

    def test_transient_failure_is_rerun_not_filed(self):
        rows = ciwatch.scan(self.d, True, fake([r(1, "ci", "failure")], "HTTP 503 Service Unavailable"))
        self.assertEqual(rows[0]["result"], "rerun"); self.assertEqual(list((self.d / "docs/issues").iterdir()), [])

    def test_real_failure_files_one_item_with_probe_and_is_idempotent(self):
        g = fake([r(1, "ci", "failure"), r(2, "ci", "success")], "AssertionError: boom")
        ciwatch.scan(self.d, True, g); ciwatch.scan(self.d, True, g)
        files = list((self.d / "docs/issues").iterdir()); self.assertEqual(len(files), 1)
        j = json.loads(files[0].read_text()); self.assertEqual(j["id"], "Q-CIFAIL-r-ci"); self.assertIn("cmd:python3 -m foundation ciwatch --probe o/r ci", j["body"]); self.assertIn("boom", j["body"])

    def test_green_recorded_and_unreadable_is_unmeasured(self):
        self.assertEqual(ciwatch.scan(self.d, True, fake([r(1, "ci", "success")], ""))[0]["result"], "green")
        self.assertEqual(ciwatch.scan(self.d, False, lambda *a: (1, "nope"))[0]["result"], "unmeasured")
        self.assertEqual(len((self.d / ciwatch.LEDGER).read_text().splitlines()), 1)

    def test_every_registered_tenant_is_watched_without_a_typed_entry(self):
        (self.d / "doctrine/tenant-repos.json").write_text(json.dumps({"tenants": {"a": {"repo": "o/a"}, "b": {"repo": "o/r"}}}))
        self.assertEqual(ciwatch.watched(self.d), ["o/r", "o/a"])

    def test_a_queue_issue_open_past_the_limit_files_one_item_and_a_fresh_one_does_not(self):
        import datetime as dt
        now = dt.datetime(2026, 11, 28, tzinfo=dt.timezone.utc)
        def gh(*a):
            return (0, json.dumps([{"number": 3, "title": "old", "created_at": "2026-11-20T00:00:00Z", "comments": 1}, {"number": 9, "title": "new", "created_at": "2026-11-27T00:00:00Z", "comments": 0}])) if "issues?state=open" in " ".join(a) else (1, "unexpected")
        rows = ciwatch.aged(self.d, True, gh, now); ciwatch.aged(self.d, True, gh, now)
        self.assertEqual((rows[0]["result"], rows[0]["issues"]), ("filed", [3]))
        files = list((self.d / "docs/issues").iterdir()); self.assertEqual(len(files), 1)
        j = json.loads(files[0].read_text()); self.assertEqual(j["id"], "Q-AGED-r-aged-queue"); self.assertIn("--probe-aged o/r", j["body"]); self.assertNotIn("#9", j["body"])
        self.assertEqual(ciwatch.aged(self.d, False, lambda *a: (1, "nope"), now)[0]["result"], "unmeasured")
        self.assertEqual(ciwatch.probe_aged("o/r", self.d, gh), 1)

    def test_probe(self):
        self.assertEqual(ciwatch.probe("o/r", "ci", REPO, fake([r(1, "ci", "failure")], "")), 1)
        self.assertEqual(ciwatch.probe("o/r", "ci", REPO, fake([r(1, "ci", "success")], "")), 0)

    def test_a_cancelled_run_does_not_hide_a_failure(self):  # PROBE-CONCLUSIVE-1
        self.assertEqual(ciwatch.probe("o/r", "ci", REPO, fake([r(3, "ci", "cancelled"), r(2, "ci", "skipped"), r(1, "ci", "failure")], "")), 1)
        self.assertEqual(ciwatch.probe("o/r", "ci", REPO, fake([r(3, "ci", "cancelled"), r(1, "ci", "success")], "")), 0)


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import datetime as dt, json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import mergeaudit as m

NOW = dt.datetime(2026, 11, 18, 2, 0, tzinfo=dt.timezone.utc)
PRS = [{"number": 619, "merged_at": "2026-11-18T01:50:03Z", "head": {"sha": "bad"}, "title": "t"},
       {"number": 620, "merged_at": "2026-11-18T01:55:00Z", "head": {"sha": "good"}, "title": "u"},
       {"number": 5, "merged_at": "2026-11-01T00:00:00Z", "head": {"sha": "old"}, "title": "old"}, {"number": 6, "merged_at": None, "head": {"sha": "x"}, "title": "closed"}]
STATE = {"bad": '["failure"]', "good": '["success"]', "old": '[]'}

def run(*a):
    if "pulls?" in a[1]: return 0, json.dumps(PRS)
    return 0, STATE[a[1].split("/commits/")[1].split("/")[0]]

class MergeAudit(unittest.TestCase):
    def test_failed_merge_is_filed_once_and_green_one_is_not(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "docs/issues").mkdir(parents=True)
            r = m.scan(d, apply=True, run=run, now=NOW)
            self.assertEqual([(x["pr"], x["checks"], x["filed"]) for x in r], [(619, "failure", True)])
            self.assertTrue((Path(d) / "docs/issues/Q-CIFAIL-mergeaudit-619.json").is_file())
            self.assertTrue(m.scan(d, apply=True, run=run, now=NOW)[0]["known"])
    def test_missing_run_counts_and_probe_needs_a_later_green_merge(self):
        STATE["bad"] = "[]"
        self.assertEqual(m.gate("bad", run), "missing"); STATE["bad"] = '["failure"]'
        self.assertTrue(m.probe(619, run, NOW)); self.assertFalse(m.probe(620, run, NOW))
    def test_gate_reads_the_checks_run_and_unreadable_is_not_green(self):
        # Q-RECUR-7f3c1db956: the gate reads the full `checks` run on the head commit, not mergeable_state (moved here from a duplicate tests/test_mergeaudit.py that called GitHub live)
        self.assertEqual(m.gate("good", run), "success")
        self.assertEqual(m.gate("bad", run), "failure")
        with self.assertRaises(RuntimeError):
            m.gate("x", lambda *a: (1, "rate limited"))
if __name__ == "__main__": unittest.main()

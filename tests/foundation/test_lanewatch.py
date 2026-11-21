"""LANE-WATCH-1: a green mergeable PR past the threshold is reported with its cause; others are not."""
import unittest
from datetime import datetime, timezone
from foundation import lanewatch

NOW = datetime(2026, 11, 12, 15, 0, tzinfo=timezone.utc)
OK = [{"conclusion": "SUCCESS"}]


def pr(n, **k):
    return {"number": n, "isDraft": False, "mergeable": "MERGEABLE", "labels": [], "updatedAt": "2026-11-12T14:00:00Z", "statusCheckRollup": OK, **k}


class LaneWatch(unittest.TestCase):
    def test_green_old_pr_is_stuck(self):
        self.assertEqual([s["number"] for s in lanewatch.classify([pr(1)], NOW)], [1])

    def test_young_red_draft_conflicting_are_not_stuck(self):
        prs = [pr(2, updatedAt="2026-11-12T14:50:00Z"), pr(3, statusCheckRollup=[{"conclusion": "FAILURE"}]), pr(4, isDraft=True), pr(5, mergeable="CONFLICTING"), pr(6, statusCheckRollup=[])]
        self.assertEqual(lanewatch.classify(prs, NOW), [])

    def test_workflow_pr_cause_is_the_credential_gate(self):
        s = lanewatch.classify([pr(7, labels=[{"name": "needs-pat"}])], NOW)[0]
        self.assertIn("LANE_PAT", s["cause"])


if __name__ == "__main__":
    unittest.main()


class LatencyProbe(unittest.TestCase):
    def test_median_over_target_breaches(self):
        from foundation import lanewatch
        prs = [{"createdAt": "2026-11-21T10:00:00Z", "mergedAt": "2026-11-21T10:0%d:00Z" % m} for m in (5, 6, 7)]
        self.assertTrue(lanewatch.latency(prs)["breach"])
        prs = [{"createdAt": "2026-11-21T10:00:00Z", "mergedAt": "2026-11-21T10:0%d:00Z" % m} for m in (1, 2, 2)]
        self.assertFalse(lanewatch.latency(prs)["breach"])

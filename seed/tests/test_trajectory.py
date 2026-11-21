# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# TRAJECTORY-1 in the seed: time-series reading of a system's own history; hotspots, neglect, drift; observed rates feeding the simulator.
import sys, unittest
from pathlib import Path
SEED = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED / "scripts"))
import trajectory as t, yearsim as y

D = 30


def s(**at):
    v = [0] * D
    for i, x in at.items():
        v[int(i[1:])] = x
    return v


class T(unittest.TestCase):
    def test_hotspot_rising_share(self):
        hot = [0] * 23 + [30] * 7
        calm = [10] * D
        r = t.analyze({"a": hot, "b": calm}, {}, {}, {"opened": [0] * D, "closed": [0] * D}, D)
        self.assertIn(("hotspot", "a"), [(f["kind"], f["id"]) for f in r["findings"]])

    def test_neglect_needs_steady_history_then_quiet(self):
        went_quiet = [10] * 10 + [0] * 20
        busy = [10] * D
        r = t.analyze({"old": went_quiet, "busy": busy}, {}, {}, {"opened": [0] * D, "closed": [0] * D}, D)
        self.assertIn(("neglected", "old"), [(f["kind"], f["id"]) for f in r["findings"]])
        once = [0] * 5 + [50] + [0] * 24  # touched once: not steady activity
        r = t.analyze({"once": once, "busy": busy}, {}, {}, {"opened": [0] * D, "closed": [0] * D}, D)
        self.assertNotIn(("neglected", "once"), [(f["kind"], f["id"]) for f in r["findings"]])

    def test_record_areas_never_hotspots(self):
        r = t.analyze({"ops": [0] * 23 + [500] * 7, "x": [10] * D}, {}, {}, {"opened": [0] * D, "closed": [0] * D}, D)
        self.assertEqual([f for f in r["findings"] if f["id"] == "ops"], [])

    def test_loop_gone_quiet(self):
        r = t.analyze({"x": [10] * D}, {"beat": [3] * 10 + [0] * 20}, {}, {"opened": [0] * D, "closed": [0] * D}, D)
        self.assertIn("loop:beat", [f["id"] for f in r["findings"]])

    def test_backlog_drift(self):
        r = t.analyze({"x": [10] * D}, {}, {}, {"opened": [2] * D, "closed": [0] * D}, D)
        self.assertIn("issues", [f["id"] for f in r["findings"]])

    def test_observed_rate_and_trend(self):
        rising = [0] * 8 + [1, 1, 2, 2]
        o = t.observed_rate(rising)
        self.assertGreater(o["trend"], 0)
        self.assertIsNone(t.observed_rate([1, 1]))  # too little history to call a rate

    def test_observed_replaces_assumed_rate(self):
        c = {"faults": [{"id": "m", "rate_per_year": 1, "rate_from": "conflict_merges", "basis": "assumed: x"}, {"id": "n", "rate_per_year": 5, "basis": "assumed: y"}]}
        out, used = y.apply_observed(c, {"conflict_merges": {"rate_year": 100, "recent_year": 150, "trend": 0.5, "events": 9, "days": 12}})
        self.assertEqual(used, ["m"])
        self.assertEqual(out["faults"][0]["rate_per_year"], 150)
        self.assertTrue(out["faults"][0]["basis"].startswith("observed:"))
        self.assertEqual(out["faults"][1]["rate_per_year"], 5)
        _, none = y.apply_observed(c, {"conflict_merges": {"rate_year": 100, "recent_year": 150, "trend": 0, "events": 1, "days": 12}})
        self.assertEqual(none, [])  # one event is not a rate

    def test_growing_rate_brings_more_faults(self):
        import random
        base = {"days": 730, "faults": [{"id": "f", "rate_per_year": 20, "duration_days": [1, 1]}], "scheduled": []}
        r = {"f": y.R("recovers", 0.9, True, True, "e")}
        flat = len(y.events(base, r, random.Random(1), None))
        grow = len(y.events({**base, "faults": [{**base["faults"][0], "growth": 1.0}]}, r, random.Random(1), None))
        self.assertGreater(grow, flat)


if __name__ == "__main__":
    unittest.main()

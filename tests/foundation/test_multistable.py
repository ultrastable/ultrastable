# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""MULTISTABLE-1: one trial per step-function at a time (Ashby's journal, the multistable system). Ultrastable is the foundation for any autonomous system."""
import json, shutil, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # removed when the test ends
from foundation import ultrastability as u

REPO = Path(__file__).resolve().parents[2]
GOOD = {"criticality.cost": 0.5, "criticality.verified_share": 1.0, "claims.drift": 0, "criticality.k": 2.0}
STEP = {"kind": "param", "file": "doctrine/spinoff.json", "path": "budget.max_live", "delta": -1, "min": 1, "max": 10}


class Disperse(unittest.TestCase):
    def test_one_newcomer_per_function_oldest_first(self):
        d = [{"key": "a:uptime", "step": STEP}, {"key": "b:uptime", "step": STEP}, {"key": "c:spend", "step": {**STEP, "path": "budget.other"}}]
        rows = [{"ev": "step", "var": "a:uptime", "at": "2026-11-02T00:00:00Z"}, {"ev": "step", "var": "b:uptime", "at": "2026-11-01T00:00:00Z"}]
        out = {x["key"]: held for x, held in u.disperse(d, {}, rows)}
        self.assertIsNone(out["b:uptime"])  # waited longest, goes first
        self.assertEqual(out["a:uptime"], "b:uptime")
        self.assertIsNone(out["c:spend"])  # an independent part still adapts in the same tick

    def test_function_under_trial_holds_newcomers(self):
        vmap = {"a:uptime": {"ladder": [STEP]}}
        rows = [{"ev": "step", "kind": "param", "var": "a:uptime", "idx": 0, "id": "s1", "at": "2026-11-01T00:00:00Z"}]
        busy = u.busy_functions(rows, vmap)
        self.assertEqual(busy, {u.function_key(STEP): "s1"})
        out = u.disperse([{"key": "b:uptime", "step": STEP}], busy, rows)
        self.assertEqual(out[0][1], "pending s1")
        self.assertEqual(u.busy_functions(rows + [{"ev": "verdict", "step_id": "s1"}], vmap), {})  # settled: free again


class Tick(unittest.TestCase):
    def setUp(self):
        self.d = Path(scratch())
        (self.d / "doctrine").mkdir()
        (self.d / "docs/issues").mkdir(parents=True)
        for f in ("doctrine/ultrastability.json", "doctrine/clocks.json", "doctrine/spinoff.json", "doctrine/priorities.json"):
            shutil.copy(REPO / f, self.d / f)
        doc = json.loads((self.d / "doctrine/ultrastability.json").read_text())
        doc["patience_ticks"], doc["settle_ticks"] = 2, 3
        (self.d / "doctrine/ultrastability.json").write_text(json.dumps(doc))
        (self.d / "ops/spinoff").mkdir(parents=True)
        (self.d / "ops/spinoff/ledger.jsonl").write_text("".join(json.dumps({"slug": s, "url": f"https://{s}.example", "event": "launch"}) + "\n" for s in ("demo", "demo2")))

    def test_two_tenants_down_share_one_step_function(self):
        for _ in range(2):
            r = u.tick(self.d, True, read=GOOD, fetch=lambda url: 0.0)
        self.assertEqual(len([s for s in r["steps"] if s["kind"] == "param"]), 1)  # before MULTISTABLE-1 both tenants changed budget.max_live in one tick
        stepped = [s["var"] for s in r["steps"] if s["kind"] == "param"]
        self.assertEqual(sorted(stepped + [h["var"] for h in r["dispersed"]]), ["demo2:uptime", "demo:uptime"])
        self.assertEqual(r["dispersed"][0]["held_by"], stepped[0])
        self.assertEqual(json.loads((self.d / "doctrine/spinoff.json").read_text())["budget"]["max_live"], 10)
        r = u.tick(self.d, True, read=GOOD, fetch=lambda url: 0.0)  # the first trial is still open: the second tenant keeps waiting
        self.assertEqual(r["dispersed"][0]["held_by"].split()[0], "pending")
        self.assertEqual(u.collisions(self.d)["value"], 0.0)

    def test_collision_reading_counts_overlapping_trials(self):
        c = json.loads((self.d / "doctrine/ultrastability.json").read_text())
        rows = [{"ev": "step", "kind": "param", "var": "demo:uptime", "idx": 0, "id": "s1", "at": "2026-11-20T00:00:00Z"},
                {"ev": "step", "kind": "param", "var": "demo2:uptime", "idx": 0, "id": "s2", "at": "2026-11-20T00:00:00Z"},
                {"ev": "verdict", "step_id": "s1", "at": "2026-11-20T01:00:00Z"}, {"ev": "verdict", "step_id": "s2", "at": "2026-11-20T01:00:00Z"},
                {"ev": "step", "kind": "param", "var": "demo:uptime", "idx": 0, "id": "s3", "at": "2026-11-21T00:00:00Z"}]
        (self.d / c["ledger"]).parent.mkdir(parents=True, exist_ok=True)
        (self.d / c["ledger"]).write_text("".join(json.dumps(r) + "\n" for r in rows))
        self.assertEqual(u.collisions(self.d), {"value": 0.667, "n": 3})

    def test_versatility(self):
        self.assertEqual(u.versatility(self.d)["value"], 1.0)
        doc = json.loads((self.d / "doctrine/spinoff.json").read_text())
        doc["score"]["min_score"] = 12  # pinned at the bound its only step moves toward: that step-function is spent
        (self.d / "doctrine/spinoff.json").write_text(json.dumps(doc))
        self.assertLess(u.versatility(self.d)["value"], 1.0)


class Noise(unittest.TestCase):
    """AJ-NOISE: the search draws near the current value when the deviation is small, and anywhere when it is large."""
    def setUp(self):
        self.d = Path(scratch())
        (self.d / "doctrine").mkdir()
        (self.d / "doctrine/k.json").write_text(json.dumps({"x": 50}))
        self.v = {"min": 0, "max": 1.0, "ladder": [{"kind": "param", "file": "doctrine/k.json", "path": "x", "delta": 1, "min": 0, "max": 100}]}

    def test_small_deviation_stays_near(self):
        self.assertEqual(u.deviation(self.v, 0.5), 0.0)
        self.assertAlmostEqual(u.deviation(self.v, 1.05), 0.05)
        for n in range(20):
            _, val = u._search(self.d, f"k{n}", self.v, [], 1.05)
            self.assertLessEqual(abs(val - 50), 5)

    def test_large_deviation_ranges_widely_and_window_falls_back(self):
        far = [abs(u._search(self.d, f"k{n}", self.v, [], 5.0)[1] - 50) for n in range(30)]
        self.assertGreater(max(far), 10)
        ep = [{"idx": 0, "after": 49, "before": 50}, {"idx": 0, "after": 51, "before": 50}]  # the window of one step is spent
        _, val = u._search(self.d, "k", self.v, ep, 1.001)
        self.assertNotIn(val, (49, 50, 51))


if __name__ == "__main__":
    unittest.main()

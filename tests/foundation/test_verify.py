"""VERIFY-1: the model checker finds seeded defects (mutation-style), and the real models pass. Ultrastable is the foundation for any autonomous system."""
import unittest
from foundation import verify as V

BANDS = [{"level": "full", "below": 0.5, "pace": 1}, {"level": "crawl", "below": None, "pace": 6}]


class Verify(unittest.TestCase):
    def test_real_models_pass(self):
        out = V.run()
        self.assertTrue(out["ok"], out["results"])
        self.assertGreaterEqual(out["coverage"]["share"], 0.7)

    def test_hard_cap_band_is_caught(self):
        r = V.governor_model(BANDS[:1] + [{"level": "stop", "below": None, "pace": None}])
        self.assertFalse(r["ok"])
        self.assertIn("essential-loops-run-in-every-band", [v["name"] for v in r["violations"]])

    def test_deadlock_and_stall_are_caught(self):
        succ = lambda s: [("step", s + 1)] if s < 3 else []
        r = V.check([0], succ, {}, goal=lambda s: False)
        kinds = {v["kind"] for v in r["violations"]}
        self.assertEqual(kinds, {"deadlock", "liveness"})
        self.assertEqual(len(r["violations"][0]["trace"]), 4)  # shortest counterexample

    def test_state_bound_is_a_failure_not_a_truncation(self):
        r = V.check([0], lambda s: [("inc", s + 1)], {}, goal=lambda s: True, max_states=50)
        self.assertFalse(r["ok"]); self.assertEqual(r["violations"][0]["name"], "max_states")

    def test_second_loop_with_no_search_stalls(self):
        r = V.check([(False, 0)], lambda s: [("revert", (False, s[1] + 1))] if s[1] < 2 else [], {}, goal=lambda s: s[0])
        self.assertFalse(r["ok"])


if __name__ == "__main__":
    unittest.main()

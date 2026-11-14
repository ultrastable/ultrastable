"""SELF-IMPROVE-1: the doctrine is complete, the ranker prefers big weighted gaps and untried levers, the verdict honours guards."""
import random, unittest
from _repo import ROOT, copy_repo
from foundation import selfimprove as si


class SelfImprove(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(si.check(ROOT), [])

    def test_missing_source_fails(self):
        r = copy_repo(); (r / "ops/cost.jsonl").unlink()
        self.assertTrue(any("cost" in b and "does not exist" in b for b in si.check(r)))

    def test_rank_prefers_gap_weight_and_untried(self):
        c = [{"loop": "a", "signal": "loop-pass-rate", "value": 0.5, "tries": 0},
             {"loop": "b", "signal": "loop-pass-rate", "value": 0.5, "tries": 9},
             {"loop": "c", "signal": "loop-pass-rate", "value": 0.99, "tries": 0},
             {"loop": "d", "signal": "loop-pass-rate", "value": 0.1, "tries": 0, "retired": True}]
        self.assertEqual([x["loop"] for x in si.rank(c)], ["a", "b"])

    def test_choose_explores_only_in_pool(self):
        r = si.rank([{"loop": str(i), "signal": "open-gaps", "value": i + 1, "tries": 0} for i in range(6)])
        picks = {si.choose(r, rng=random.Random(s))["loop"] for s in range(60)}
        self.assertTrue(picks <= {x["loop"] for x in r[:3]})

    def test_verdict_reverts_on_guard_breach(self):
        pred = {"baseline": 0.5, "target": 0.9}
        self.assertTrue(si.verdict(pred, 0.8, {"cost": 1.0}, {"cost": 1.0})["keep"])
        v = si.verdict(pred, 0.8, {"cost": 1.0}, {"cost": 0.8})
        self.assertFalse(v["keep"])
        self.assertEqual(v["guards_worse"], ["cost"])
        self.assertFalse(si.verdict(pred, 0.51, {}, {})["keep"])


if __name__ == "__main__":
    unittest.main()

"""GROWTH-1: the product manager's mix and metrics; the executor prefers growth when the recent mix is below target."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import growth as G  # noqa: E402


class Growth(unittest.TestCase):
    def test_declaration_is_complete(self):
        self.assertEqual(G.check(), [])

    def test_classification(self):
        self.assertEqual(G.classify("Fix stale dashboard data"), "fix")
        self.assertEqual(G.classify("Add a public changelog feed"), "growth")
        self.assertEqual(G.classify("Rename a variable"), "maintenance")
        self.assertEqual(G.classify("Rename a variable", [{"name": "growth"}]), "growth")

    def test_mix_share(self):
        m = G.mix(["Fix a", "Fix b", "Add feed", "Rename x"])
        self.assertEqual((m["fix"], m["growth"], m["maintenance"]), (2, 1, 1))
        self.assertEqual(m["growth_share"], 0.25)
        self.assertIsNone(G.mix([])["growth_share"])

    def test_prefer_growth_only_when_below_target(self):
        issues = [{"number": 1, "labels": [{"name": "p1"}]}, {"number": 2, "labels": [{"name": "growth"}]}]
        low = ["Fix a", "Fix b", "Fix c", "Fix d", "Add feed"]          # 20 percent growth: below the 40 percent target
        self.assertEqual([i["number"] for i in G.prefer(issues, subjects=low)], [2])
        high = ["Add feed", "Add demo", "Fix a"]                         # 67 percent: leave the order alone
        self.assertEqual([i["number"] for i in G.prefer(issues, subjects=high)], [1, 2])
        self.assertEqual([i["number"] for i in G.prefer([issues[0]], subjects=low)], [1])   # no growth item takeable: do not block

    def test_metric_breach_logic(self):
        r = {m["id"]: m for m in G.evaluate({"pageviews_7d": 10, "visitors_7d": 10**6})}
        self.assertTrue(r["pageviews_7d"]["breach"]); self.assertFalse(r["visitors_7d"]["breach"])
        self.assertIsNone(r["agent_hits_7d"]["breach"])                   # unmeasured is not a pass

    def test_executor_uses_the_preference(self):
        self.assertIn("growth.prefer", (G.REPO / "foundation/executor.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

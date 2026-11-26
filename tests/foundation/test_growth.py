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


class GrowthProducts(unittest.TestCase):
    """GROWTH-PM-1: every product has growth metrics and an owner loop; the roster's policy values agree with doctrine/growth.json."""

    def _copy(self, tmp, mutate):
        import json, shutil
        root = Path(tmp)
        for p in ("doctrine/growth.json", "seed/autonomy/policy.json", "agents/autonomy-policy.json", "instances/ultrastable/loop-registry.json"):
            (root / p).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(G.REPO / p, root / p)
        mutate(root, json)
        return G.check_products(root)

    def test_repo_is_covered(self):
        self.assertEqual(G.check_products(), [])

    def test_product_without_enough_metrics_fails(self):
        import tempfile
        def m(root, json):
            p = root / "doctrine/growth.json"; d = json.loads(p.read_text()); d["products"][0]["metrics"] = d["products"][0]["metrics"][:1]; p.write_text(json.dumps(d))
        with tempfile.TemporaryDirectory() as t:
            bad = self._copy(t, m)
        self.assertTrue(any("needs at least 2" in b for b in bad), bad)

    def test_product_without_owner_loop_fails(self):
        import tempfile
        def m(root, json):
            p = root / "doctrine/growth.json"; d = json.loads(p.read_text()); d["products"][0]["owner_loop"] = "nobody"; p.write_text(json.dumps(d))
        with tempfile.TemporaryDirectory() as t:
            bad = self._copy(t, m)
        self.assertTrue(any("not in the loop registry" in b for b in bad), bad)

    def test_policy_floor_must_match_doctrine(self):
        import tempfile
        def m(root, json):
            for p in G.POLICIES:
                q = root / p; d = json.loads(q.read_text()); d["growth"]["growth_share_floor"] = 0.1; q.write_text(json.dumps(d))
        with tempfile.TemporaryDirectory() as t:
            bad = self._copy(t, m)
        self.assertTrue(any("growth_share_floor" in b for b in bad), bad)


class HitsPublic(unittest.TestCase):
    def test_public_route_returns_counts(self):
        from foundation import growth
        body = {"pageviews_7d": 5, "visitors_7d": 3, "agent_hits_7d": 9, "pilot_page_views_7d": 1}
        self.assertEqual(growth.hits_public(fetch=lambda u: body), body)

    def test_public_route_rejects_an_error_body(self):
        from foundation import growth
        with self.assertRaises(ValueError):
            growth.hits_public(fetch=lambda u: {"error": "no analytics database"})

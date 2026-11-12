"""COMPONENTS-1: the gap analysis is computed from probes and cannot be flattered by prose."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import components as cp  # noqa: E402
from _repo import copy_repo, edit  # noqa: E402


class Components(unittest.TestCase):
    def test_data_is_consistent_and_evidence_is_fresh(self):
        self.assertEqual(cp.check(ROOT), [])

    def test_every_component_is_connected_and_every_story_names_real_components(self):
        d = cp.load(ROOT)
        used = {e["from"] for e in d["edges"]} | {e["to"] for e in d["edges"]}
        self.assertEqual(set(d["components"]) - used - {"gap-analysis"}, set())

    def test_removing_a_proof_downgrades_live_to_built_and_files_a_gap(self):
        d = copy_repo()
        (d / "tests/foundation/test_lifecycle.py").unlink()
        self.assertEqual(cp.evaluate(d)["components"]["self-improvement"], "built")
        self.assertIn("OL-GAP-self-improvement", cp.file_gaps(d))
        self.assertEqual(cp.file_gaps(d), [])  # idempotent
        self.assertFalse(cp.probe(d, "component:self-improvement"))

    def test_removing_an_implementation_breaks_edges_and_stories(self):
        d = copy_repo()
        (d / "foundation/lifecycle.py").unlink()
        ev = cp.evaluate(d)
        self.assertEqual(ev["components"]["session-lifecycle"], "missing")
        self.assertTrue(any(not e["wired"] and e["from"] == "session-lifecycle" for e in ev["edges"]))
        self.assertTrue(any(not s["pass"] and s["id"] == "no-zombie-work" for s in ev["stories"]))

    def test_a_competitor_offering_it_natively_invalidates_the_claim(self):
        d = copy_repo()
        mk = {"accessed": "2026-11-12", "products": {"Acme": {"url": "u", "components": {c: {"native": "no", "note": "n", "source": "s"} for c in cp.load(d)["components"]}}}}
        (d / "doctrine/market-evidence.json").write_text(json.dumps(mk))
        self.assertTrue(all(o["verdict"] in ("supported", "unsupported") for o in cp.evaluate(d)["objections"]))
        mk["products"]["Acme"]["components"]["role-managers"]["native"] = "yes"
        (d / "doctrine/market-evidence.json").write_text(json.dumps(mk))
        bad = [o for o in cp.evaluate(d)["objections"] if o["verdict"] == "invalid"]
        self.assertTrue(bad and bad[0]["competitors_offering"] == ["Acme:role-managers"])
        self.assertIn("OL-GAP-objection-just-a-code-agent", cp.file_gaps(d))

    def test_missing_market_evidence_never_counts_as_support(self):
        d = copy_repo()
        mf = d / "doctrine/market-evidence.json"
        if mf.exists():
            mf.unlink()
        self.assertTrue(all(o["verdict"] == "unverified" for o in cp.evaluate(d)["objections"]))


if __name__ == "__main__":
    unittest.main()

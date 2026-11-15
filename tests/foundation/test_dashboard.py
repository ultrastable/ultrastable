"""DASHBOARD-1: the public dashboard preview is computed from the repository and the pilot model is data."""
import json, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "scripts"))
import build_dashboard as bd  # noqa: E402


class Dashboard(unittest.TestCase):
    def test_current_and_every_panel_has_a_source(self):
        self.assertEqual(bd.check(ROOT), [])

    def test_panels_reflect_the_registries(self):
        d = bd.build(ROOT)
        loops = len(json.loads((ROOT / "instances/ultrastable/loop-registry.json").read_text(encoding="utf-8"))["loops"])
        self.assertIn(f"{loops} registered loops", [p["headline"] for p in d["tenants"]["ultrastable"]["panels"] if p["id"] == "loops"][0])
        lf = d["tenants"]["ultrastable"]["live_feed"]
        live = json.loads((ROOT / "instances/ultrastable/live-runtime.json").read_text(encoding="utf-8"))["runtimes"]
        self.assertEqual(lf["available"], bool(live), "a live feed is claimed only when a runtime is recorded")
        self.assertEqual({r["tenant"] for r in lf["runtimes"]}, {r["tenant"] for r in live})

    def test_pilot_model_decides_and_hypotheses_have_probes(self):
        pm = json.loads((ROOT / "doctrine/pilot-model.json").read_text(encoding="utf-8"))
        self.assertIn(pm["decision"], [o["id"] for o in pm["options"]])
        self.assertTrue(pm["revert"] and pm["why"])
        for h in pm["hypotheses"]:
            self.assertRegex(h["closing_probe"], r"^(file|grep):")


if __name__ == "__main__":
    unittest.main()

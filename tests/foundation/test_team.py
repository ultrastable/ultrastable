"""TEAM-1: the phased virtual team is data, wired, and gated."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import team  # noqa: E402

OPEN = lambda root, spec: (True, spec)
SHUT = lambda root, spec: (False, spec)


class Team(unittest.TestCase):
    def test_catalog_is_consistent_and_wired_in_this_repo(self):
        self.assertEqual(team.check(ROOT, g=team.gate(ROOT, run=lambda r, s: (s.startswith("cmd:") or (Path(r) / s[5:]).is_file(), s))), [])

    def test_phases_open_in_order_and_stop_at_first_failed_gate(self):
        cat = team.load(ROOT)
        self.assertEqual(team.gate(ROOT, cat, run=SHUT)["current"], 0)
        self.assertEqual(team.gate(ROOT, cat, run=OPEN)["current"], 2)

    def test_phase_two_needs_evidence_from_phase_one_roles(self):
        cat = team.load(ROOT)
        files = {f"file:docs/handoff/{r}.md" for r in cat["phases"][1]["roles"]}
        self.assertEqual(set(cat["phases"][2]["gate"]), files)

    def test_every_role_has_owner_trigger_metric_and_never_list(self):
        for rid, r in team.load(ROOT)["roles"].items():
            for f in team.REQUIRED:
                self.assertTrue(r.get(f), f"{rid}.{f}")

    def test_rendered_role_keeps_the_shared_footer(self):
        cat = team.load(ROOT)
        txt = team.render(ROOT, "agents/roles", "marketing-manager", cat["roles"]["marketing-manager"])
        self.assertIn("# Role: marketing manager", txt)
        self.assertIn("## Measure", txt)
        self.assertIn("## Each tick", txt)

    def test_recommend_scales_with_the_manifest(self):
        from foundation import manifest as mf
        m = mf.resolve(json.loads((ROOT / "instances/ultrastable/instance.json").read_text()))
        r = team.recommend(m, ROOT)
        self.assertIn("legal-ip-manager", r["phase_1"])
        m["ip"]["has_invention"] = False
        self.assertNotIn("legal-ip-manager", team.recommend(m, ROOT)["phase_1"])


if __name__ == "__main__":
    unittest.main()

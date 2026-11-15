# PROMOTE-1: strategy and promotion as a closed loop.
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import promote

REPO = Path(__file__).resolve().parents[2]


class Promote(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for p in ["doctrine/promotion.json", "outreach/facts.json", "outreach/profiles.json", "outreach/forms", "ops/promotion",
                  "outreach/applications", "LICENSING.md", "COMMERCIAL-TERMS.md", "site/wrangler.toml", "site/agentic.js",
                  "foundation/selfhost.py", "instances/ultrastable/loop-registry.json", "doctrine/competitors.json", "scripts", "foundation/promote.py", "foundation/growth.py"]:
            s, d = REPO / p, self.tmp / p
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(s, d) if s.is_dir() else shutil.copy(s, d)

    def test_repo_check_passes(self):
        self.assertEqual(promote.check(REPO), [])

    def test_fit_is_computed_from_facts_and_reenters(self):
        rows = {r["id"]: r for r in promote.plan(self.tmp)["channels"]}
        self.assertEqual(rows["nlnet"]["state"], "not-a-fit-now")
        lic = self.tmp / "LICENSING.md"
        lic.write_text(lic.read_text().replace("not open source", "open source").replace("Repositories stay private", "Repositories are public"))
        rows = {r["id"]: r for r in promote.plan(self.tmp)["channels"]}
        self.assertEqual(rows["nlnet"]["state"], "kit-ready-identity-gate")

    def test_unproven_fact_blocks_kit(self):
        f = self.tmp / "outreach/facts.json"
        d = json.loads(f.read_text()); d["facts"]["loops"]["value"] = 100000; f.write_text(json.dumps(d))
        _, errs = promote.kits(self.tmp, write=False)
        self.assertTrue(any("fact loops is not proven" in e for e in errs))

    def test_guard_and_limit(self):
        self.assertIn("digit outside a fact", promote.guard("we have 40 customers", REPO))
        f = self.tmp / "outreach/forms/yc.json"
        d = json.loads(f.read_text()); d["questions"][0]["a"] = "x" * 60; f.write_text(json.dumps(d))
        _, errs = promote.kits(self.tmp, write=False)
        self.assertTrue(any("over limit" in e for e in errs))

    def test_owner_gate_must_be_identity_bound(self):
        f = self.tmp / "doctrine/promotion.json"
        d = json.loads(f.read_text()); d["channels"][0]["gate"] = "owner-review"; f.write_text(json.dumps(d))
        self.assertTrue(any("allowed gate" in e for e in promote.check(self.tmp)))

    def test_outcome_reweights_and_items_only_for_system_channels(self):
        before = {r["id"]: r["score"] for r in promote.plan(self.tmp)["channels"]}
        promote.outcome(self.tmp, "indexnow", "listed")
        after = {r["id"]: r["score"] for r in promote.plan(self.tmp)["channels"]}
        self.assertGreater(after["indexnow"], before["indexnow"])
        ids = {i["id"] for i in promote.items(promote.plan(self.tmp))}
        self.assertEqual(ids, {"Q-PROMO-mcp-registry", "Q-PROMO-indexnow"})


if __name__ == "__main__":
    unittest.main()

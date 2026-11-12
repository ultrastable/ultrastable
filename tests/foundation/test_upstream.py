import json, shutil, tempfile, unittest
from pathlib import Path
from _repo import ROOT, copy_repo
from foundation import upstream


class Upstream(unittest.TestCase):
    def test_core_contract_current_and_kernel_clean(self):
        self.assertEqual(upstream.contract_check(), [])
        self.assertEqual(upstream.leaks(), [])

    def test_leak_detected(self):
        core = copy_repo()
        (core / "seed/agents/AGENTS.md").open("a").write("\nsee q08.org\n")
        self.assertTrue(upstream.leaks(core))
        self.assertTrue(upstream.contract_check(core))

    def adopt(self):
        out = Path(tempfile.mkdtemp())
        rep = upstream.adopt(ROOT, out, "Acme", "acme")
        return out, rep

    def test_byo_adoption_is_valid_and_idempotent(self):
        out, rep = self.adopt()
        self.assertEqual(upstream.check(ROOT, out), [])
        self.assertTrue((out / ".github/workflows/ultrastable-upgrade.yml").exists())
        self.assertEqual(upstream.drift(ROOT, out)["status"], "in-sync")
        again = upstream.adopt(ROOT, out, "Acme", "acme")
        self.assertEqual(again["created"] + again["updated"] + again["added"], [])

    def test_adoption_never_overwrites_existing_files(self):
        out = Path(tempfile.mkdtemp()); (out / "AGENTS.md").write_text("mine")
        rep = upstream.adopt(ROOT, out, "Acme", "acme")
        self.assertEqual((out / "AGENTS.md").read_text(), "mine"); self.assertIn("AGENTS.md", rep["conflicts"])

    def test_down_flow_and_up_candidates(self):
        core = copy_repo(); out = Path(tempfile.mkdtemp())
        upstream.adopt(core, out, "Acme", "acme")
        (core / "seed/agents/roles/staff.md").open("a").write("\nimproved upstream\n")
        (out / "autonomy/policy.json").open("a").write(" ")  # local edit
        (core / "seed/autonomy/policy.json").open("a").write("\n")  # core changed the same file
        upstream.build_contract  # refresh contract
        (core / upstream.CONTRACT).write_text(json.dumps(upstream.build_contract(core, "0.2.0")))
        d = upstream.drift(core, out)
        self.assertTrue(d["behind"]); self.assertEqual(d["local_edits"], ["autonomy/policy.json"])
        rep = upstream.sync(core, out, apply=True)
        self.assertIn("agents/roles/staff.md", rep["updated"]); self.assertEqual(rep["conflicts"], ["autonomy/policy.json"])
        self.assertIn("improved upstream", (out / "agents/roles/staff.md").read_text())
        self.assertEqual(upstream.check(core, out), [])
        self.assertEqual(json.loads((out / upstream.LOCK).read_text())["core"]["version"], "0.2.0")

    def test_major_mismatch_fails_contract(self):
        core = copy_repo(); out = Path(tempfile.mkdtemp()); upstream.adopt(core, out, "Acme", "acme")
        (core / upstream.CONTRACT).write_text(json.dumps(upstream.build_contract(core, "1.0.0")))
        self.assertTrue(any("major" in b for b in upstream.check(core, out)))

    def test_instance_workflows_parse(self):
        import yaml
        out, _ = self.adopt()
        for f in (out / ".github/workflows").glob("*.yml"):
            yaml.safe_load(f.read_text())


if __name__ == "__main__":
    unittest.main()

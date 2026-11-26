# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# CONSTITUTION-1: the constitution agrees with the code, binds every rule to a detector and a remediation, and the boot assembles from it.
import json, shutil, sys, tempfile, unittest
from pathlib import Path

SEED = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED / "scripts"))
sys.path.insert(0, str(SEED / "bootstrap"))
import constitution as c  # noqa: E402
import staticcontent as sc  # noqa: E402
import bootstrap as bs  # noqa: E402


def copy(dst: Path):
    shutil.copytree(SEED, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git", "org", "node_modules", "__pycache__", "config.js", "wrangler.jsonc"))


class T(unittest.TestCase):
    def test_constitution_agrees_with_code(self):
        self.assertEqual(c.check(SEED, instruction_files=["AGENTS.md", "agents/AGENTS.md"]), [])

    def test_rule_without_code_fails(self):
        with tempfile.TemporaryDirectory() as d:
            copy(Path(d))
            j = json.loads((Path(d) / c.PATH).read_text())
            j["rules"].append({"id": "orphan-rule", "rule": "x", "source": "t", "detector": [], "remediation": [{"file": "nope.py"}]})
            (Path(d) / c.PATH).write_text(json.dumps(j))
            (Path(d) / c.PROSE).write_text(c.render(j))
            e = "\n".join(c.check(Path(d)))
            self.assertIn("orphan-rule: no detector", e)
            self.assertIn("nope.py missing", e)

    def test_code_drift_fails(self):
        with tempfile.TemporaryDirectory() as d:
            copy(Path(d))
            f = Path(d) / "worker/src/tick.js"
            f.write_text(f.read_text().replace("  async reap_claims(db, ctx)", "  async reap_claims_renamed(db, ctx)"))
            self.assertTrue(any("tick_steps" in x for x in c.check(Path(d))))

    def test_stale_prose_and_unlisted_standing_rule_fail(self):
        with tempfile.TemporaryDirectory() as d:
            copy(Path(d))
            (Path(d) / c.PROSE).write_text("old")
            a = Path(d) / "AGENTS.md"
            a.write_text(a.read_text() + "\n- **Always do the new thing (NEWTHING-1, Rowan 2026-11-25).** words only.\n")
            e = "\n".join(c.check(Path(d), instruction_files=["AGENTS.md"]))
            self.assertIn("stale", e)
            self.assertIn("NEWTHING-1", e)

    def test_boot_stage_assembles(self):
        with tempfile.TemporaryDirectory() as d:
            copy(Path(d))
            boot = bs.Boot(Path(d), Path(d) / "org", apply=False)
            st, detail = boot.constitute()
            self.assertEqual(st, "ok", detail)
            a = json.loads((Path(d) / "org/constitution.json").read_text())
            self.assertIn("self-sustaining", a["ignition_stages"])
            self.assertIn("constitute", a["boot_stages"])
            self.assertEqual(len(a["rules"]), len(c.load(SEED)["rules"]))

    def test_static_content_finding_and_item(self):
        with tempfile.TemporaryDirectory() as d:
            copy(Path(d))
            r = Path(d) / sc.RULES
            j = json.loads(r.read_text()); j["urls"] = ["https://x.example/"]; r.write_text(json.dumps(j))
            led = sc.run(Path(d), apply=True, fetch=lambda u: "<p>same</p>", today="2026-01-01")
            self.assertEqual(sc.findings(Path(d), led, "2026-01-05"), [])
            led = sc.run(Path(d), apply=True, fetch=lambda u: "<p>same</p>", today="2026-02-01")
            self.assertEqual(led["pages"]["https://x.example/"]["changed"], "2026-01-01")
            self.assertEqual(len(sc.findings(Path(d), led, "2026-02-01")), 1)
            self.assertTrue((Path(d) / "docs/issues/Q-STATIC-x-example.json").is_file())
            led = sc.run(Path(d), fetch=lambda u: "<p>new</p>", today="2026-02-02")
            self.assertEqual(sc.findings(Path(d), led, "2026-02-02"), [])


if __name__ == "__main__":
    unittest.main()

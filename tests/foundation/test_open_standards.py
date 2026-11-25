"""OPEN-STANDARDS-1: the open standards the register marks supported hold in this repository and in the seed."""
import glob, json, os, tempfile, unittest
from pathlib import Path

import yaml

from foundation import schemas, supplychain

ROOT = Path(__file__).resolve().parents[2]


class OpenStandards(unittest.TestCase):
    def test_every_config_has_a_json_schema(self):
        self.assertEqual(schemas.check(ROOT), [])

    def test_catalog_is_schemastore_format(self):
        for root in (ROOT, ROOT / "seed"):
            cat = json.loads((root / "schemas/catalog.json").read_text())
            self.assertEqual(cat["$schema"], "https://json.schemastore.org/schema-catalog.json")
            self.assertEqual(cat["version"], 1)
            self.assertTrue(all({"name", "description", "fileMatch", "url"} <= set(s) for s in cat["schemas"]))

    def test_schema_drift_fails(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d)
            (r / "schemas").mkdir()
            (r / "doctrine").mkdir()
            (r / "schemas/config.json").write_text(json.dumps({"cover": ["doctrine/*.json"]}))
            (r / "doctrine/a.json").write_text(json.dumps({"x": 1, "items": [{"id": "a", "n": 2}]}))
            self.assertTrue(schemas.check(r))  # no schema yet
            schemas.engine.generate(r)
            self.assertEqual(schemas.engine.check(r), [])
            (r / "doctrine/a.json").write_text(json.dumps({"x": "one", "items": [{"id": "a", "n": 2}], "new": True}))
            self.assertTrue(any("does not match" in b for b in schemas.engine.check(r)))  # type changed
            (r / "doctrine/a.json").write_text(json.dumps({"x": 3, "items": [{"id": "b", "n": 5, "extra": 1}], "new": True}))
            self.assertEqual(schemas.engine.check(r), [])  # additions are allowed

    def test_editorconfig_present(self):
        for root in (ROOT, ROOT / "seed"):
            text = (root / ".editorconfig").read_text()
            self.assertIn("root = true", text)
            self.assertIn("end_of_line = lf", text)

    def test_devcontainer_is_valid(self):
        for root in (ROOT, ROOT / "seed"):
            d = json.loads((root / ".devcontainer/devcontainer.json").read_text())
            self.assertIn("devContainer.schema.json", d["$schema"])
            self.assertTrue(d.get("image") or d.get("build") or d.get("dockerComposeFile"))

    def test_dependabot_covers_every_ecosystem(self):
        for root, prefix in ((ROOT, ""), (ROOT / "seed", "")):
            cfg = yaml.safe_load((root / ".github/dependabot.yml").read_text())
            dirs = {(u["package-ecosystem"], u["directory"].rstrip("/") or "/") for u in cfg["updates"]}
            self.assertIn(("github-actions", "/"), dirs, root)
            for pkg in glob.glob(str(root / "**/package.json"), recursive=True):
                rel = os.path.relpath(os.path.dirname(pkg), root)
                if "node_modules" in rel or rel.startswith("seed") and root == ROOT or "/vendor" in rel:
                    continue
                self.assertIn(("npm", "/" + rel), dirs, f"{root}: {rel} has a package.json and no Dependabot entry")

    def test_supply_chain_loop_files_and_closes(self):
        cfg = json.loads((ROOT / supplychain.CFG).read_text())
        sc = {"score": 6, "checks": [{"name": "Token-Permissions", "score": 2}, {"name": "Code-Review", "score": 0}, {"name": "SAST", "score": -1}]}
        sbom = {"sbom": {"spdxVersion": "SPDX-2.3", "documentDescribes": ["SPDXRef-root"], "packages": [
            {"SPDXID": "SPDXRef-a", "name": "ok", "licenseConcluded": "MIT"},
            {"SPDXID": "SPDXRef-b", "name": "bad", "licenseConcluded": "AGPL-3.0-only"},
            {"SPDXID": "SPDXRef-c", "name": "unknown"}]}}
        pol = json.loads((ROOT / cfg["licence_policy"]).read_text())["policy"]
        rep = supplychain.summarise(sc, sbom, cfg, pol, "2026-11-25")
        ids = [i for i, _ in supplychain.failing(rep, cfg)]
        self.assertEqual(ids, ["Q-STD-SC-Token-Permissions", "Q-STD-SC-LIC-bad"])  # ignored and unscored checks file nothing
        with tempfile.TemporaryDirectory() as d:
            r = Path(d)
            (r / "doctrine").mkdir(); (r / "docs/issues").mkdir(parents=True); (r / "ops").mkdir()
            (r / supplychain.CFG).write_text(json.dumps(cfg))
            self.assertEqual(len(supplychain.file_items(r, rep, cfg)), 2)
            (r / supplychain.OUT).write_text(json.dumps(rep))
            self.assertFalse(supplychain.probe(r, "Q-STD-SC-Token-Permissions"))
            rep["scorecard"]["checks"]["Token-Permissions"] = 9
            (r / supplychain.OUT).write_text(json.dumps(rep))
            self.assertTrue(supplychain.probe(r, "Q-STD-SC-Token-Permissions"))
        self.assertEqual(supplychain.check(ROOT), [])

    def test_supply_chain_workflow_reads_both_standards(self):
        text = (ROOT / ".github/workflows/supply-chain.yml").read_text()
        self.assertIn("ossf/scorecard-action", text)
        self.assertIn("dependency-graph/sbom", text)
        self.assertIn("supplychain --ingest", text)

    def test_citation_cff_parses(self):
        c = yaml.safe_load((ROOT / "CITATION.cff").read_text())
        self.assertEqual(c["cff-version"], "1.2.0")
        self.assertTrue(c.get("title") and c.get("authors") and c.get("message"))

    def test_site_pages_carry_schema_org_jsonld(self):
        for f in ("site/worker.js", "site/research.js"):
            text = (ROOT / f).read_text()
            self.assertIn("application/ld+json", text)
            self.assertIn("schema.org", text)


if __name__ == "__main__":
    unittest.main()

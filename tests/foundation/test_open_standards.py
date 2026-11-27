# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STANDARDS-1: the open standards the register marks supported hold in this repository and in the seed."""
import glob, json, os, tempfile, unittest
from pathlib import Path

import yaml

from foundation import supplychain

ROOT = Path(__file__).resolve().parents[2]


class OpenStandards(unittest.TestCase):
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
        from foundation import deprot  # the one coverage reader every system carries, seed/scripts/deprot.py (USER-BACKEND-1)
        for root in (ROOT, ROOT / "seed"):
            self.assertIn(("github-actions", "/"), deprot.covered(root), root)
            self.assertEqual(deprot.missing(root), [], f"{root}: a manifest directory has no Dependabot entry")

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

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STANDARDS-1: Backstage catalog, CycloneDX SBOM and devcontainer are standard files generated from the registers, never typed by hand."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import stdgen  # noqa: E402


class StdGen(unittest.TestCase):
    def test_generated_files_are_current(self):
        self.assertEqual(stdgen.check(ROOT), [])

    def test_backstage_catalog_names_every_worker_store_and_tenant(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("pyyaml not installed")
        docs = list(yaml.safe_load_all((ROOT / stdgen.CATALOG).read_text()))
        topo = json.loads((ROOT / "doctrine/topology.json").read_text())
        ten = json.loads((ROOT / "doctrine/tenant-repos.json").read_text())
        names = {(d["kind"], d["metadata"]["name"]) for d in docs}
        for w in topo["workers"]:
            self.assertIn(("Component", w["id"]), names)
        for rows in topo["stores"].values():
            for s in rows:
                self.assertIn(("Resource", s["name"]), names)
        for t in ten["tenants"]:
            self.assertIn(("System", t), names)
        for d in docs:
            self.assertEqual(d["apiVersion"], "backstage.io/v1alpha1")
            for ref in d.get("spec", {}).get("dependsOn", []):
                kind, name = ref.split(":")
                self.assertIn((kind.capitalize(), name), names, ref)

    def test_cyclonedx_sbom_lists_pinned_actions_and_packages(self):
        s = json.loads((ROOT / stdgen.SBOM).read_text())
        self.assertEqual((s["bomFormat"], s["specVersion"]), ("CycloneDX", "1.6"))
        refs = [c["bom-ref"] for c in s["components"]]
        self.assertEqual(len(refs), len(set(refs)))
        self.assertTrue(any(r.startswith("pkg:github/actions/checkout@") for r in refs))
        self.assertTrue(any(r.startswith("pkg:npm/") for r in refs))
        self.assertNotIn("timestamp", s["metadata"])  # no churn: the file changes only when the supply chain does

    def test_devcontainer_matches_ci_runtimes(self):
        d = json.loads((ROOT / ".devcontainer/devcontainer.json").read_text())
        self.assertIn("3.12", d["image"])
        self.assertEqual(d["features"]["ghcr.io/devcontainers/features/node:1"]["version"], "24")


if __name__ == "__main__":
    unittest.main()

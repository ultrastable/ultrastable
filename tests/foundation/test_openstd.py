# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1: data files carry JSON Schemas, events are CloudEvents, provenance exports as W3C PROV, the service catalog is
Backstage catalog-info. Ultrastable is the foundation for any autonomous system."""
import json
import tempfile
import unittest
from pathlib import Path

from foundation import manifest, openstd, provenance

core = openstd.core


class JsonSchemaCatalog(unittest.TestCase):
    def test_repository_passes_openstd_check(self):
        self.assertEqual(openstd.check(), [])

    def test_every_doctrine_file_and_manifest_is_catalogued(self):
        self.assertEqual(openstd.uncovered(), [])

    def test_library_and_stdlib_validators_agree(self):
        schema = json.loads((openstd.REPO / "seed/schemas/instance.schema.json").read_text())
        bad = {"name": "X", "slug": "Bad Slug", "kind": "shop", "goals": []}
        lite = core.validate(schema, bad, prefer_library=False)
        full = core.validate(schema, bad)
        self.assertEqual(len(lite), len(full))
        self.assertTrue(any("slug" in e for e in lite) and any("kind" in e for e in lite))

    def test_one_schema_validates_json_yaml_and_toml(self):
        schema = {"$schema": core.DRAFT, "type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}}
        with tempfile.TemporaryDirectory() as d:
            for name, text in (("a.json", '{"name": "x"}'), ("a.toml", 'name = "x"\n'), ("a.yaml", "name: x\n")):
                p = Path(d) / name
                p.write_text(text)
                try:
                    data = core.load_data(p)
                except ImportError:
                    continue  # PyYAML absent: JSON and TOML still prove the point
                self.assertEqual(core.validate(schema, data), [], name)

    def test_inferred_schema_treats_id_keyed_maps_as_maps(self):
        data = {"tenants": {f"t{i}": {"repo": f"r{i}", "state": "own-repo"} for i in range(8)}}
        s = core.infer([data])
        self.assertIn("additionalProperties", s["properties"]["tenants"])
        data["tenants"]["new"] = {"repo": "n", "state": "planned"}
        self.assertEqual(core.validate(s, data, prefer_library=False), [])

    def test_manifest_structure_comes_from_the_schema(self):
        errs = manifest.validate({"name": "Shop", "kind": "storefront", "goals": ["g"]})
        self.assertTrue(any("kind" in e for e in errs))
        self.assertEqual(manifest.validate(json.loads((openstd.REPO / "instances/unlearn/instance.json").read_text())), [])


class CloudEventsAndProv(unittest.TestCase):
    ROW = {"id": "pv-1", "at": "2026-11-25T21:00:00Z", "tenant": "ultrastable", "kind": "decision", "summary": "s", "ref": "r",
           "affected": ["doctrine/x.json"], "origin": {"class": "agent", "actor": "a1", "channel": "thread"}, "parent": "pv-0",
           "effect": {"status": "pending"}, "public": False}

    def test_provenance_row_is_a_conforming_cloudevent(self):
        ev = provenance.to_cloudevent(self.ROW)
        self.assertEqual(core.cloudevent_errors(ev), [])
        self.assertEqual(ev["type"], "io.ultrastable.provenance.decision")
        self.assertEqual(ev["source"], "/ultrastable/agent/a1")
        self.assertEqual(ev["id"], "pv-1")

    def test_provenance_exports_as_prov_json(self):
        doc = provenance.to_prov([self.ROW])
        self.assertIn("us:pv-1", doc["activity"])
        self.assertEqual(list(doc["wasGeneratedBy"].values())[0]["prov:entity"], "us:file/doctrine/x.json")
        self.assertEqual(list(doc["wasInformedBy"].values())[0]["prov:informant"], "us:pv-0")
        self.assertEqual(doc["prefix"]["prov"], "http://www.w3.org/ns/prov#")


class BackstageAndCommits(unittest.TestCase):
    def test_catalog_info_lists_every_topology_worker(self):
        text = openstd.render_catalog_info()
        topo = json.loads((openstd.REPO / "doctrine/topology.json").read_text())
        for w in topo["workers"]:
            self.assertIn(f'name: "{w["id"]}"', text)
        self.assertIn("apiVersion: backstage.io/v1alpha1", text)

    def test_conventional_commit_subjects(self):
        self.assertTrue(core.conventional("queue: closing-probe verdicts"))
        self.assertTrue(core.conventional("feat(seed)!: drop v0 manifests"))
        self.assertFalse(core.conventional("Fix the thing"))


if __name__ == "__main__":
    unittest.main()

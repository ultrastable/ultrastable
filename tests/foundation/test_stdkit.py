# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1: one standards kit (seed/scripts/stdkit.py) for JSON Schema validation, CloudEvents, W3C PROV and
Conventional Commits. Ultrastable is the foundation for any autonomous system."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from foundation import manifest, provenance

REPO = Path(__file__).resolve().parents[2]
_s = importlib.util.spec_from_file_location("seed_stdkit", REPO / "seed/scripts/stdkit.py")
kit = importlib.util.module_from_spec(_s)
_s.loader.exec_module(kit)


class JsonSchema(unittest.TestCase):
    def test_seed_schemas_are_valid_2020_12(self):
        for p in sorted((REPO / "seed/schemas").glob("*.schema.json")):
            self.assertEqual(kit.schema_errors(json.loads(p.read_text())), [], p.name)

    def test_library_and_stdlib_validators_agree(self):
        schema = json.loads((REPO / "seed/schemas/instance.schema.json").read_text())
        bad = {"name": "X", "slug": "Bad Slug", "kind": "shop", "goals": []}
        lite = kit.validate(schema, bad, prefer_library=False)
        self.assertEqual(len(lite), len(kit.validate(schema, bad)))
        self.assertTrue(any("slug" in e for e in lite) and any("kind" in e for e in lite))

    def test_every_instance_manifest_and_the_provenance_ledger_validate(self):
        schema = json.loads((REPO / "seed/schemas/instance.schema.json").read_text())
        for p in sorted((REPO / "instances").glob("*/instance.json")):
            self.assertEqual(kit.validate(schema, json.loads(p.read_text())), [], str(p))
            self.assertEqual(manifest.validate(json.loads(p.read_text())), [], str(p))
        # STANDARDS-FIRST-1: new rows are CloudEvents envelopes and older rows stay readable, so the ledger is read the way every reader does:
        # an envelope must conform, and the row it carries (or the bare older row) must fit the row schema.
        from foundation import cloudevents
        raw = kit.load_data(REPO / "ops/provenance.jsonl")
        self.assertEqual([e for r in raw if cloudevents.is_event(r) for e in cloudevents.conforms(r)][:3], [])
        rows = [cloudevents.unwrap(r) for r in raw]
        self.assertEqual(kit.validate(json.loads((REPO / "seed/schemas/provenance-row.schema.json").read_text()), rows)[:3], [])

    def test_manifest_structure_comes_from_the_schema(self):
        errs = manifest.validate({"name": "Shop", "kind": "storefront", "goals": ["g"]})
        self.assertTrue(any("kind" in e for e in errs))
        self.assertTrue(any("goals" in e for e in manifest.validate({"name": "No goals"})))

    def test_one_schema_validates_json_and_toml(self):
        schema = {"$schema": kit.DRAFT, "type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}}
        with tempfile.TemporaryDirectory() as d:
            for name, text in (("a.json", '{"name": "x"}'), ("a.toml", 'name = "x"\n')):
                p = Path(d) / name
                p.write_text(text)
                self.assertEqual(kit.validate(schema, kit.load_data(p)), [], name)


class CloudEventsAndProv(unittest.TestCase):
    ROW = {"id": "pv-1", "at": "2026-11-25T21:00:00Z", "tenant": "ultrastable", "kind": "decision", "summary": "s", "ref": "r",
           "affected": ["doctrine/x.json"], "origin": {"class": "agent", "actor": "a1", "channel": "thread"}, "parent": "pv-0",
           "effect": {"status": "pending"}, "public": False}

    def test_provenance_row_is_a_conforming_cloudevent(self):
        ev = provenance.to_cloudevent(self.ROW)
        self.assertEqual(kit.cloudevent_errors(ev), [])
        self.assertEqual(ev["type"], "io.ultrastable.provenance.decision")
        self.assertEqual(ev["source"], "/ultrastable/agent/a1")
        self.assertEqual(ev["id"], "pv-1")

    def test_provenance_exports_as_prov_json(self):
        doc = provenance.to_prov([self.ROW])
        self.assertIn("us:pv-1", doc["activity"])
        self.assertEqual(list(doc["wasGeneratedBy"].values())[0]["prov:entity"], "us:file/doctrine/x.json")
        self.assertEqual(list(doc["wasInformedBy"].values())[0]["prov:informant"], "us:pv-0")

    def test_whole_ledger_exports_without_loss(self):
        rows = provenance.entries()[-200:]
        self.assertEqual(len(provenance.to_prov(rows).get("activity", {})), len({r["id"] for r in rows}))
        self.assertEqual([e for r in rows for e in kit.cloudevent_errors(provenance.to_cloudevent(r))], [])

    def test_conventional_commit_subjects(self):
        self.assertTrue(kit.conventional("queue: closing-probe verdicts"))
        self.assertTrue(kit.conventional("feat(seed)!: drop v0 manifests"))
        self.assertFalse(kit.conventional("Fix the thing"))


if __name__ == "__main__":
    unittest.main()

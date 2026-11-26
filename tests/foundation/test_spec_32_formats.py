# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-32 (open standards and agent-consumable surfaces), the formats the system writes and checks: JSON Schema contracts for every config, the open-standards
gate, the CloudEvents twin, Conventional Commits and SemVer, the CycloneDX SBOM, the supply-chain reading, the agent-standards register and the findability reading.
Each test is named by the requirement it proves. Every tree is a scratch directory removed when the test ends; the network is a fake; the date of a reading is a parameter.

Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_32_formats.py"""
import datetime as dt
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from _repo import ROOT, scratch, git, tiny_repo
from foundation import agentstd, cloudevents, commitlint, configschema, findable, openstd, schemas, semrel, stdgen, supplychain

_spec = importlib.util.spec_from_file_location("seed_stdkit", ROOT / "seed/scripts/stdkit.py")
kit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kit)
VEC = json.loads((ROOT / "seed/standards/cloudevents-vectors.json").read_text(encoding="utf-8"))


def w(root, rel, content):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content if isinstance(content, str) else json.dumps(content, indent=1), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------------------------------------------------------- Config contracts

class ConfigContracts(unittest.TestCase):
    CONFIG = {"name": "x", "n": 2, "items": [{"k": 1}, {"k": 2}, {"k": 3}], "opt": None}

    def tree(self):
        td = scratch()
        w(td, "doctrine/a.json", self.CONFIG)
        return td

    def test_us_32_r52_every_config_has_a_2020_12_schema_in_a_schema_store_catalog_and_validates_against_it(self):
        td = self.tree()
        self.assertEqual(configschema.check(td), ["doctrine/a.json: no schema at doctrine/schemas/a.schema.json; run `python3 -m foundation configschema --gen`",
                                                  "doctrine/schemas/catalog.json: catalog out of date; run `python3 -m foundation configschema --gen`"], "a config with no schema, and the catalog that does not list it")
        wrote = configschema.gen(td); self.assertEqual(wrote, ["doctrine/schemas/a.schema.json", "doctrine/schemas/catalog.json"])
        self.assertEqual(configschema.check(td), [])
        cat = json.loads((td / "doctrine/schemas/catalog.json").read_text())
        self.assertEqual(cat, {"$schema": "https://json.schemastore.org/schema-catalog.json", "version": 1, "schemas": [{"name": "a.json", "description": "Contract for doctrine/a.json", "fileMatch": ["doctrine/a.json"], "url": "a.schema.json"}]})
        cfg = json.loads((td / "doctrine/a.json").read_text()); cfg.pop("name"); (td / "doctrine/a.json").write_text(json.dumps(cfg))
        bad = configschema.check(td); self.assertEqual(len(bad), 1); self.assertTrue(bad[0].startswith("doctrine/a.json:") and "name" in bad[0], "a dropped key is named with its file")
        cfg["name"] = 7; (td / "doctrine/a.json").write_text(json.dumps(cfg)); self.assertTrue(any(b.startswith("doctrine/a.json:") for b in configschema.check(td)), "a wrong type fails")
        (td / "doctrine/a.json").write_text("{not json"); self.assertTrue(any("not valid JSON" in b for b in configschema.check(td)))
        (td / "doctrine/a.json").write_text(json.dumps(self.CONFIG))
        p = td / "doctrine/schemas/a.schema.json"; sc = json.loads(p.read_text())
        sc["$schema"] = "http://json-schema.org/draft-07/schema#"; p.write_text(json.dumps(sc)); self.assertTrue(any("$schema must be https://json-schema.org/draft/2020-12/schema" in b for b in configschema.check(td)))
        sc["$schema"] = configschema.DRAFT; sc["properties"]["n"] = {"type": "number", "format": "int32"}; p.write_text(json.dumps(sc))
        self.assertTrue(any("keyword 'format' is not supported by the validator" in b for b in configschema.check(td)), "a keyword no validator here runs is a check that would do nothing")
        sc["properties"].pop("n"); p.write_text(json.dumps(sc)); (td / "doctrine/schemas/catalog.json").write_text("{}")
        self.assertTrue(any("catalog out of date" in b for b in configschema.check(td)))
        covered = [c[0] for c in configschema.COVERED]; self.assertIn("doctrine/*.json", covered); self.assertIn("seed/autonomy/*.json", covered); self.assertIn("seed/standards/standards.json", covered)
        self.assertEqual(configschema.check(ROOT), [], "every config of this repository validates")

    def test_us_32_r53_generation_writes_only_a_missing_floor_and_never_overwrites_a_schema_written_by_hand(self):
        td = self.tree(); configschema.gen(td)
        sc = json.loads((td / "doctrine/schemas/a.schema.json").read_text())
        self.assertEqual(sc["$schema"], configschema.DRAFT); self.assertEqual(sc["$id"], "https://ultrastable.io/schemas/doctrine/a.schema.json"); self.assertEqual(sc["type"], "object")
        self.assertEqual(sc["required"], ["items", "n", "name", "opt"], "the top-level keys are required, sorted")
        self.assertEqual(sc["properties"]["n"], {"type": "number"}, "an integer is read as a number: a count may become a share"); self.assertEqual(sc["properties"]["opt"], {}, "a null says nothing about its type")
        self.assertEqual(sc["properties"]["items"], {"type": "array", "items": {"type": "object", "properties": {"k": {"type": "number"}}}}); self.assertEqual(sc["properties"]["$schema"], {"type": "string"})
        sc["properties"]["name"] = {"type": "string", "minLength": 3, "maxLength": 9}; (td / "doctrine/schemas/a.schema.json").write_text(json.dumps(sc))
        self.assertEqual(configschema.gen(td), [], "nothing is written when the schema exists and the catalog is current")
        self.assertEqual(json.loads((td / "doctrine/schemas/a.schema.json").read_text())["properties"]["name"]["maxLength"], 9, "a tightened schema survives")
        w(td, "doctrine/b.json", {"z": [1]}); self.assertEqual(configschema.gen(td), ["doctrine/schemas/b.schema.json", "doctrine/schemas/catalog.json"], "a new config gets its schema and the catalog gains it")
        self.assertEqual(configschema.infer([1, 2]), {"type": "array", "items": {"type": "number"}})
        self.assertEqual(configschema.infer({"a": [{"x": 1}, {"x": 2}]}), {"type": "object", "properties": {"a": {"type": "array", "items": {"type": "object"}}}, "required": ["a"]}, "fewer than three records fix no field types")
        recs = [{"x": 1, "y": "a"}, {"x": 2, "y": "b"}, {"x": 3, "y": None}, {"x": "s"}]
        self.assertEqual(configschema.infer({"a": recs})["properties"]["a"]["items"], {"type": "object", "properties": {}}, "a field whose type is not agreed, or that few records carry, is left open")
        self.assertEqual(configschema.infer({"a": {"b": {"c": 1}}})["properties"]["a"], {"type": "object", "properties": {"b": {"type": "object"}}}, "nesting stops at the second level")

    def test_us_32_r54_the_validator_runs_the_keyword_vocabulary_it_claims_and_refuses_a_schema_that_uses_another(self):
        V = lambda s, v: schemas.validate(s, v)
        self.assertEqual(V({"type": "object", "required": ["a"]}, {"a": 1}), []); self.assertEqual(V({"type": "object", "required": ["a"]}, {}), ["$: missing a"])
        self.assertEqual(V({"type": "integer"}, 2.0), []); self.assertEqual(V({"type": "integer"}, True), ["$: expected integer, found bool"]); self.assertEqual(V({"type": ["string", "null"]}, None), [])
        self.assertEqual(V({"const": 1}, 2), ["$: must be 1"]); self.assertEqual(V({"enum": ["a"]}, "b"), ["$: 'b' is not one of ['a']"])
        self.assertTrue(V({"pattern": "^a"}, "b")); self.assertTrue(V({"minLength": 2}, "a")); self.assertTrue(V({"maxLength": 1}, "ab")); self.assertTrue(V({"minimum": 2}, 1)); self.assertTrue(V({"maximum": 2}, 3))
        self.assertEqual(V({"properties": {"a": {"type": "string"}}, "additionalProperties": False}, {"a": 1, "b": 2}), ["$.a: expected string, found int", "$: unknown key 'b'"], "an error carries its JSON path")
        self.assertEqual(V({"patternProperties": {"^x-": {"type": "number"}}}, {"x-a": "s"}), ["$.x-a: expected number, found str"])
        self.assertEqual(V({"additionalProperties": {"type": "number"}}, {"a": "s"}), ["$.a: expected number, found str"])
        self.assertEqual(V({"type": "array", "items": {"type": "string"}}, ["a", 1]), ["$[1]: expected string, found int"])
        self.assertTrue(V({"minItems": 2}, [1])); self.assertTrue(V({"maxItems": 1}, [1, 2])); self.assertTrue(V({"uniqueItems": True}, [{"a": 1}, {"a": 1}]))
        self.assertEqual(V({"anyOf": [{"type": "string"}, {"type": "number"}]}, True), ["$: matches none of anyOf"]); self.assertEqual(V({"oneOf": [{"type": "number"}, {"minimum": 0}]}, 1), ["$: matches 2 of oneOf, needs exactly 1"])
        self.assertEqual(V({"allOf": [{"type": "number"}, {"minimum": 5}]}, 1), ["$: 1 is below 5"]); self.assertEqual(V({"not": {"type": "string"}}, "s"), ["$: matches a schema it must not"])
        self.assertEqual(V({"$defs": {"s": {"type": "string"}}, "properties": {"a": {"$ref": "#/$defs/s"}}}, {"a": 1}), ["$.a: expected string, found int"])
        with self.assertRaises(ValueError): V({"$ref": "https://example.org/other.json"}, 1)
        self.assertEqual(V(True, 1), []); self.assertEqual(V(False, 1), ["$: not allowed"])
        self.assertEqual(schemas.lint({"type": "object", "properties": {"a": {"type": "string", "format": "uri"}}}), ["#/properties/a: keyword 'format' is not supported by the validator"])
        self.assertEqual(schemas.lint({"type": "strng"}), ["#: unknown type 'strng'"]); self.assertEqual(schemas.lint({"title": "t", "$comment": "c", "examples": [1], "default": 1}), [], "annotations are free")
        self.assertEqual(schemas.lint({"anyOf": [{"contains": {}}]}), ["#/anyOf/0: keyword 'contains' is not supported by the validator"])

    def test_us_32_r55_the_seed_carries_one_validator_that_prefers_the_library_agrees_with_the_stdlib_subset_and_reads_four_file_formats(self):
        schema = json.loads((ROOT / "seed/schemas/instance.schema.json").read_text()); bad = {"name": "X", "slug": "Bad Slug", "kind": "shop", "goals": []}
        lite, lib = kit.validate(schema, bad, prefer_library=False), kit.validate(schema, bad)
        self.assertEqual(len(lite), len(lib)); self.assertTrue(any("slug" in e for e in lite) and any("kind" in e for e in lite)); self.assertTrue(all(re.match(r"^\$[\w.\[\]]*: ", e) for e in lite))
        self.assertEqual(kit.validate({"type": "object", "required": ["a"], "properties": {"a": {"$ref": "#/$defs/n"}}, "$defs": {"n": {"type": "integer", "minimum": 1}}}, {"a": 0}, prefer_library=False), ["$.a: below 1"])
        self.assertEqual(kit.validate({"oneOf": [{"type": "string"}, {"type": "number"}]}, True, prefer_library=False), ["$: matches 0 of oneOf alternatives"])
        for p in sorted((ROOT / "seed/schemas").glob("*.schema.json")): self.assertEqual(kit.schema_errors(json.loads(p.read_text())), [], p.name)
        self.assertEqual(kit.schema_errors({"$schema": "http://json-schema.org/draft-07/schema#"})[0], f"$schema must be {kit.DRAFT}")
        td = scratch(); w(td, "a.json", {"a": 1}); w(td, "b.jsonl", '{"a": 1}\n\n{"a": 2}\n'); w(td, "c.toml", 'a = 1\n[t]\nb = "x"\n'); w(td, "d.ini", "[a]")
        self.assertEqual(kit.load_data(td / "a.json"), {"a": 1}); self.assertEqual(kit.load_data(td / "b.jsonl"), [{"a": 1}, {"a": 2}]); self.assertEqual(kit.load_data(td / "c.toml"), {"a": 1, "t": {"b": "x"}})
        with self.assertRaisesRegex(ValueError, "unsupported data format .ini"): kit.load_data(td / "d.ini")
        self.assertEqual(kit.validate({"type": "object", "properties": {"t": {"type": "object", "required": ["b"]}}}, kit.load_data(td / "c.toml")), [], "one schema validates JSON and TOML alike")


# ---------------------------------------------------------------------------------------------------------------------------- The open-standards gate

class OpenStandardsGate(unittest.TestCase):
    def setUp(self):
        self.root = scratch()
        reg = json.loads((ROOT / openstd.REG).read_text())
        for f in reg["formats"]:
            for e in f.get("evidence", []):
                w(self.root, e, {"$schema": "x"} if e.endswith(".json") else "x")
        w(self.root, openstd.REG, reg); w(self.root, openstd.SCHEMA, (ROOT / openstd.SCHEMA).read_text()); w(self.root, openstd.CE_SCHEMA, (ROOT / openstd.CE_SCHEMA).read_text())
        w(self.root, "schemas/doctrine.schema.json", (ROOT / "schemas/doctrine.schema.json").read_text()); w(self.root, openstd.BASE, {"config": [], "ledgers": [], "extensions": []})
        subprocess.run(["git", "-C", str(self.root), "init", "-q"], check=True)
        self.add("README.md", "x")

    def add(self, rel, content):
        w(self.root, rel, content); subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)

    def reg(self, fn):
        p = self.root / openstd.REG; r = json.loads(p.read_text()); fn(r); p.write_text(json.dumps(r))

    def test_us_32_r56_the_registry_lists_each_format_class_with_its_standard_and_an_adopted_class_has_evidence_that_exists(self):
        self.assertEqual(openstd.check(self.root), [])
        r = json.loads((ROOT / openstd.REG).read_text()); ids = [f["id"] for f in r["formats"]]
        self.assertEqual(len(ids), len(set(ids))); self.assertTrue({"config-json-schema", "event-ledgers-cloudevents", "http-openapi", "agent-interface", "feeds", "releases", "supply-chain"} <= set(ids))
        self.assertTrue(all(f["status"] in ("adopted", "partial", "planned") and f["standard"] and f["spec"].startswith("https://") for f in r["formats"]))
        self.reg(lambda r: r["formats"].append(dict(r["formats"][0]))); self.assertTrue(any("duplicate format id config-json-schema" in e for e in openstd.check(self.root)))
        self.reg(lambda r: r["formats"].pop())
        self.reg(lambda r: r["formats"][2].update(evidence=["no/such/file.md"])); self.assertTrue(any("evidence path missing: no/such/file.md" in e for e in openstd.check(self.root)))
        self.reg(lambda r: r["formats"][2].pop("evidence")); self.assertTrue(any(": adopted without evidence" in e for e in openstd.check(self.root)))
        self.assertEqual(openstd.check(ROOT), [])
        self.assertEqual(subprocess.run([sys.executable, "-m", "foundation", "openstd", "--probe", "iac-wrangler"], cwd=ROOT, capture_output=True, text=True).returncode, 0)
        out = subprocess.run([sys.executable, "-m", "foundation", "openstd", "--probe", "observability"], cwd=ROOT, capture_output=True, text=True); self.assertEqual((out.returncode, out.stdout.strip()), (1, "observability: not adopted"))

    def test_us_32_r57_a_config_in_scope_declares_its_schema_a_ledger_line_is_a_cloudevent_and_a_file_type_is_registered(self):
        self.add("doctrine/new.json", {"a": 1}); self.assertTrue(any("doctrine/new.json (config file without $schema)" in e for e in openstd.check(self.root)))
        self.add("doctrine/new.json", {"$schema": "../schemas/doctrine.schema.json", "a": 1}); self.assertEqual(openstd.check(self.root), [])
        self.add("doctrine/new.json", {"$schema": "", "a": 1}); self.assertTrue(openstd.check(self.root), "an empty $schema is not a declaration")
        self.add("doctrine/new.json", ["$schema"]); self.assertTrue(openstd.check(self.root), "a config that is not an object declares nothing")
        self.add("doctrine/new.json", {"a": 1}); self.add("doctrine/schemas/catalog.json", {"schemas": [{"fileMatch": ["doctrine/new.json"], "url": "new.schema.json"}]}); self.assertEqual(openstd.check(self.root), [], "a Schema Store catalog entry is the declaration")
        self.add("ops/x.jsonl", '{"t": 1}\n'); self.assertTrue(any("ops/x.jsonl (event ledger that is not CloudEvents 1.0)" in e for e in openstd.check(self.root)))
        good = json.dumps(openstd.cloudevent("a.b", "/loop/x", {"k": 1}, subject="s")); self.add("ops/x.jsonl", good + "\n" + good + "\n"); self.assertEqual(openstd.check(self.root), [])
        self.add("ops/x.jsonl", good + "\n" + '{"t": 1}\n'); self.assertTrue(openstd.check(self.root), "the last line is read as well as the first")
        self.add("ops/x.jsonl", "\n\n"); self.assertEqual(openstd.check(self.root), [], "an empty ledger conforms")
        self.add("ops/sub/y.jsonl", '{"t": 1}\n'); self.assertTrue(any("ops/sub/y.jsonl" in e for e in openstd.check(self.root)), "a ledger in a subdirectory is in scope")
        self.add("ops/sub/y.jsonl", good + "\n"); self.add("conf/app.ini", "[a]"); self.assertTrue(any("conf/app.ini (file type with no registered standard)" in e for e in openstd.check(self.root)))
        self.assertEqual((openstd._ext("a/b.json.tmpl"), openstd._ext(".gitignore"), openstd._ext("Makefile"), openstd._ext("x.tar.gz")), ("json", "gitignore", "(none)", "gz"), "a template is judged by what it renders to")
        self.assertEqual(set(openstd.cloudevent("t", "/s")), {"specversion", "id", "source", "type", "time", "datacontenttype", "data"}); self.assertEqual(openstd.cloudevent("t", "/s")["data"], {})

    def test_us_32_r58_the_baseline_only_shrinks_a_conforming_file_leaves_it_and_a_drain_adds_the_schema_declaration(self):
        self.add("doctrine/old.json", {"a": 1}); self.add("conf/old.ini", "x")
        self.assertEqual(sorted(openstd.scan(self.root)["config"]), ["doctrine/old.json"])
        out = openstd.baseline(self.root, init=True); self.assertEqual((out["config"], out["extensions"]), (["doctrine/old.json"], ["conf/old.ini"])); self.assertEqual(openstd.check(self.root), [], "the baseline names the files that predate the rule")
        self.add("doctrine/newer.json", {"a": 1}); self.assertTrue(any("new bespoke format: doctrine/newer.json" in e for e in openstd.check(self.root)), "a new file is held to the rule at once")
        self.add("doctrine/newer.json", {"$schema": "x"}); self.add("doctrine/old.json", {"$schema": "x", "a": 1})
        self.assertTrue(any("baseline is stale: doctrine/old.json now conforms or is gone" in e for e in openstd.check(self.root)), "a conforming file must leave the baseline")
        out = openstd.baseline(self.root); self.assertEqual(out["config"], []); self.assertEqual(out["extensions"], ["conf/old.ini"], "the baseline command removes entries and never adds one")
        self.add("conf/other.ini", "x"); self.assertEqual(openstd.baseline(self.root)["extensions"], ["conf/old.ini"])
        self.add("doctrine/d.json", {"a": 1}); self.add("doctrine/e.json", {"a": 1}); openstd.baseline(self.root, init=True)
        done = openstd.drain(self.root, 1); self.assertEqual(len(done), 1)
        text = (self.root / done[0]).read_text(); self.assertTrue(text.startswith('{\n  "$schema": "../schemas/doctrine.schema.json",')); self.assertEqual(json.loads(text)["a"], 1)
        self.assertNotIn(done[0], json.loads((self.root / openstd.BASE).read_text())["config"], "a converted file leaves the baseline in the same run")
        ev = openstd.record(self.root, "openstd.drain", {"converted": done}); line = json.loads((self.root / "ops/openstd/events.jsonl").read_text().splitlines()[-1])
        self.assertEqual(line["type"], "openstd.drain"); self.assertEqual(line["source"], "/loop/openstd"); self.assertEqual(line, ev); self.assertEqual(openstd.cloudevent("t", "/s", now=dt.datetime(2026, 11, 26, 1, 2, 3, tzinfo=dt.timezone.utc))["time"], "2026-11-26T01:02:03Z")
        seed = (ROOT / "seed/scripts/openstd.py").read_text().split("\n", 3)[3]; plat = (ROOT / "foundation/openstd.py").read_text().split("\n", 3)[3]
        self.assertEqual(seed, plat, "the seed carries the same gate, byte for byte after the licence lines")


# ---------------------------------------------------------------------------------------------------------------------------- CloudEvents, the Python twin

class CloudEventsTwin(unittest.TestCase):
    def test_us_32_r63_the_python_twin_builds_the_same_envelope_passes_the_same_vectors_and_unwraps_the_same_rows(self):
        for e in VEC["valid"]:
            self.assertEqual(cloudevents.conforms(e), [], json.dumps(e))
        for v in VEC["invalid"]:
            self.assertTrue(cloudevents.conforms(v["event"]), v["why"])
        e = cloudevents.event("item", "done", "/tenants/t/loops/tick", {"ok": True}, subject="Q-1", id="abc", time="2026-11-25T00:00:00Z")
        self.assertEqual(e, {"specversion": "1.0", "id": "abc", "source": "/tenants/t/loops/tick", "type": "io.ultrastable.item.done", "subject": "Q-1", "time": "2026-11-25T00:00:00Z", "datacontenttype": "application/json", "data": {"ok": True}})
        self.assertEqual(cloudevents.event_type("Hand Off", "Verify Failed.Now"), "io.ultrastable.hand-off.verify-failed.now"); self.assertRaises(ValueError, cloudevents.event_type, "", "b")
        bare = cloudevents.event("a", "b", "/s"); self.assertRegex(bare["id"], r"^[0-9a-f]{32}$"); self.assertRegex(bare["time"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$"); self.assertNotIn("data", bare)
        self.assertNotIn("time", cloudevents.event("a", "b", "/s", time=False), "a caller with no occurrence time keeps the envelope deterministic")
        with self.assertRaisesRegex(ValueError, "not a CloudEvent: source must be a non-empty string"): cloudevents.event("a", "b", "")
        with self.assertRaisesRegex(ValueError, "extension attribute origin must be a string, number or boolean"): cloudevents.event("a", "b", "/s", extensions={"origin": {"class": "loop"}})
        self.assertIn("data and data_base64 are exclusive", cloudevents.conforms({"specversion": "1.0", "id": "1", "source": "/s", "type": "t", "data": 1, "data_base64": "eA=="}))
        old = {"state": "merged"}; self.assertIs(cloudevents.unwrap(old), old); self.assertEqual(cloudevents.unwrap(cloudevents.event("handoff", "merged", "/s", old)), old)
        foreign = {"specversion": "1.0", "id": "1", "source": "/x", "type": "com.example.thing", "data": {"a": 1}}; self.assertTrue(cloudevents.is_event(foreign)); self.assertIs(cloudevents.unwrap(foreign), foreign)
        k = kit.cloudevent("io.ultrastable.tick.done", "/ultrastable/tick", {"b": 1, "a": 2}, time="2026-11-25T21:00:00Z"); k2 = kit.cloudevent("io.ultrastable.tick.done", "/ultrastable/tick", {"a": 2, "b": 1}, time="2026-11-25T21:00:00Z")
        self.assertEqual(k["id"], k2["id"], "the id of a kit event depends on its content, not on the order of its keys"); self.assertRegex(k["id"], r"^[0-9a-f]{24}$"); self.assertEqual(kit.cloudevent_errors(k), [])
        self.assertRaises(ValueError, kit.cloudevent, "t", "/s", None, BadExt=1); self.assertEqual(kit.cloudevent_errors({"specversion": "1.0", "id": "x", "source": "/s"}), ["missing type"])
        self.assertEqual(len({openstd.cloudevent("a", "/s")["id"] for _ in range(5)}), 5, "a ledger event has a fresh id")


# ---------------------------------------------------------------------------------------------------------------------------- Commits, versions, supply chain

class CommitsAndVersions(unittest.TestCase):
    def test_us_32_r73_the_commit_titles_the_system_writes_follow_the_conventional_commits_header_and_the_list_of_exceptions_only_shrinks(self):
        for t in ("feat: allow provided config object", "feat(api)!: send an email", "docs: correct spelling", "watchdog: clock probe (X-1) [skip ci]", "chore(deps): bump actions"): self.assertIsNotNone(commitlint.parse(t), t)
        p = commitlint.parse("feat(lang)!: add Polish\n\nbody"); self.assertEqual((p["type"], p["scope"], p["breaking"], p["description"]), ("feat", "lang", "!", "add Polish"))
        for t in ("executor provenance", "REGEN-1: regenerate", "Stand alone: vendor", "fix:no space", "fix: ", ": nothing", "scout and rnd: weekly"): self.assertIsNone(commitlint.parse(t), t)
        d = scratch(); (d / "doctrine").mkdir()
        cfg = {"generators": [".github/workflows/*.yml", "scripts/*.sh"], "baseline_ceiling": 1, "baseline": []}
        wf = '      run: git commit -q -m "watchdog: clock probe [skip ci]"\n      run: python3 scripts/land_data.py "cost-guard: daily reading" ops/cost.jsonl\n      run: git commit -m "$MSG"\n      run: git commit -m "<type>: usage line"\n'
        w(d, ".github/workflows/a.yml", wf); w(d, "doctrine/commit-convention.json", cfg)
        self.assertEqual(commitlint.titles(d), [(".github/workflows/a.yml", "watchdog: clock probe [skip ci]"), (".github/workflows/a.yml", "cost-guard: daily reading")], "a title in a variable or a usage line is not a title")
        self.assertEqual(commitlint.check(d), [])
        w(d, "scripts/s.sh", 'git commit -m "REGEN-1: regenerate"\n'); bad = commitlint.check(d); self.assertEqual(len(bad), 1); self.assertIn("scripts/s.sh: commit title 'REGEN-1: regenerate' is not `<type>[(scope)]: <description>`", bad[0])
        w(d, "doctrine/commit-convention.json", {**cfg, "baseline": ["scripts/s.sh: REGEN-1: regenerate"]}); self.assertEqual(commitlint.check(d), [], "a listed title is tolerated")
        w(d, "doctrine/commit-convention.json", {**cfg, "baseline": ["scripts/s.sh: REGEN-1: regenerate", "scripts/gone.sh: old title"]}); self.assertTrue(any("baseline holds 2 titles, above its ceiling 1" in b for b in commitlint.check(d)))
        self.assertTrue(any("baseline names 'scripts/gone.sh: old title', which no generator writes any more" in b for b in commitlint.check(d)))
        w(d, "doctrine/commit-convention.json", {**cfg, "baseline": ["scripts/s.sh: fix: now fine"]}); w(d, "scripts/s.sh", 'git commit -m "fix: now fine"\n'); self.assertTrue(any("conforms now; remove it from the baseline" in b for b in commitlint.check(d)))
        e = scratch(); w(e, "doctrine/commit-convention.json", {**cfg, "baseline": []}); self.assertTrue(any("no commit title found under the generator globs; the lint is reading nothing" in b for b in commitlint.check(e)))
        real = json.loads((ROOT / commitlint.PATH).read_text()); self.assertLessEqual(len(real["baseline"]), real["baseline_ceiling"]); self.assertEqual(commitlint.check(ROOT), [])
        self.assertTrue(kit.conventional("feat(x)!: y") and kit.conventional("Merge pull request #1") and not kit.conventional("updated things")); self.assertEqual(kit.conventional_share(["feat: a", "b", "fix: c", ""]), 0.667); self.assertEqual(kit.conventional_share([]), 1.0)

    def test_us_32_r74_a_version_is_derived_from_the_commits_since_the_last_tag_and_written_as_a_keep_a_changelog_file(self):
        self.assertEqual(semrel.classify("feat: add a thing"), ("minor", "Added", "add a thing")); self.assertEqual(semrel.classify("fix(core): repair"), ("patch", "Fixed", "repair")); self.assertEqual(semrel.classify("perf: faster"), ("patch", "Changed", "faster"))
        self.assertEqual(semrel.classify("feat!: drop v1"), ("major", "Added", "drop v1")); self.assertEqual(semrel.classify("fix: x", "BREAKING CHANGE: y")[0], "major"); self.assertEqual(semrel.classify("security: patch"), ("patch", "Security", "patch"))
        self.assertEqual(semrel.classify("Update README"), ("patch", "Changed", "Update README"), "history that predates the convention is a patch-level change"); self.assertIsNone(semrel.classify("watchdog: tick [skip ci]"))
        self.assertEqual([semrel.bump("1.2.3", k) for k in ("major", "minor", "patch")], ["2.0.0", "1.3.0", "1.2.4"])
        root = tiny_repo(); git(root, "tag", "v1.2.3")
        for msg in ("fix: repair a thing", "feat: add a thing", "chore: bookkeeping [skip ci]", "Update docs"):
            (root / "f.txt").write_text(msg); git(root, "add", "."); git(root, "commit", "-q", "-m", msg)
        p = semrel.plan(root, today="2026-11-26"); self.assertEqual((p["previous"], p["version"], p["bump"], p["date"]), ("v1.2.3", "1.3.0", "minor", "2026-11-26"))
        self.assertEqual(p["sections"], {"Added": ["add a thing"], "Changed": ["Update docs"], "Fixed": ["repair a thing"]}, "a bot commit marked [skip ci] is left out")
        text = semrel.render(p); self.assertTrue(text.startswith("## [1.3.0] - 2026-11-26\n\n### Added\n\n- add a thing\n\n### Changed\n\n- Update docs\n\n### Fixed\n\n- repair a thing")); self.assertLess(text.index("### Added"), text.index("### Fixed"))
        done = semrel.apply(root); self.assertEqual(done["version"], "1.3.0"); self.assertEqual((root / "VERSION").read_text(), "1.3.0\n")
        log = (root / "CHANGELOG.md").read_text(); self.assertTrue(log.startswith("# Changelog\n\ngenerated-by: python3 -m foundation semrel --apply")); self.assertIn("## [1.3.0]", log)
        git(root, "tag", "v1.3.0"); self.assertIsNone(semrel.plan(root)["bump"]); before = (root / "CHANGELOG.md").read_text(); semrel.apply(root); self.assertEqual((root / "CHANGELOG.md").read_text(), before, "no new commit, no new section")
        (root / "g.txt").write_text("x"); git(root, "add", "."); git(root, "commit", "-q", "-m", "feat!: break it"); self.assertEqual(semrel.plan(root)["version"], "2.0.0")
        fresh = tiny_repo(); (fresh / "h.txt").write_text("x"); git(fresh, "add", "."); git(fresh, "commit", "-q", "-m", "fix: first"); self.assertEqual(semrel.plan(fresh)["version"], "0.1.0", "with no tag the first release is 0.1.0")

    def test_us_32_r75_the_sbom_is_a_cyclonedx_1_6_document_built_from_the_manifests_and_the_pinned_actions_with_no_timestamp_and_a_stable_serial(self):
        d = scratch(); sha = "3d3c42e5aac5ba805825da76410c181273ba90b1"
        w(d, "pkg/package.json", {"name": "@org/pkg", "version": "1.0.0", "dependencies": {"a": "1", "b": "2"}}); w(d, "node_modules/x/package.json", {"name": "ignored", "version": "9"}); w(d, "unnamed/package.json", {})
        w(d, ".github/workflows/a.yml", f"jobs:\n  j:\n    steps:\n      - uses: actions/checkout@{sha} # v7\n      - uses: owner/repo/sub/action@{sha}\n      - uses: loose/action@v1\n      - uses: actions/checkout@{sha}\n")
        s = stdgen.sbom(d); self.assertEqual((s["bomFormat"], s["specVersion"], s["version"]), ("CycloneDX", "1.6", 1)); self.assertNotIn("timestamp", json.dumps(s["metadata"]), "no timestamp: the file changes only when the supply chain changes")
        refs = [c["bom-ref"] for c in s["components"]]; self.assertEqual(refs, sorted(refs)); self.assertEqual(len(refs), len(set(refs)), "a package or action is listed once")
        self.assertIn("pkg:npm/%40org/pkg@1.0.0", refs); self.assertIn(f"pkg:github/actions/checkout@{sha}", refs); self.assertIn(f"pkg:github/owner/repo@{sha}", refs, "the action is named by its repository")
        self.assertFalse(any("loose" in r or "ignored" in r for r in refs), "an action not pinned to a commit is not listed, nor is a dependency directory")
        pkg = next(c for c in s["components"] if c["bom-ref"].startswith("pkg:npm/%40org")); self.assertEqual((pkg["type"], pkg["purl"], pkg["scope"]), ("library", pkg["bom-ref"], "required")); self.assertIn({"name": "ultrastable:third-party-dependencies", "value": "2"}, pkg["properties"])
        act = next(c for c in s["components"] if c["bom-ref"] == f"pkg:github/actions/checkout@{sha}"); self.assertEqual(act["type"], "application"); self.assertEqual(act["version"], sha); self.assertIn({"name": "ultrastable:tag-comment", "value": "v7"}, act["properties"])
        self.assertRegex(s["serialNumber"], r"^urn:uuid:[0-9a-f-]{36}$"); self.assertEqual(stdgen.sbom(d)["serialNumber"], s["serialNumber"]); self.assertEqual(stdgen.render_sbom(d), json.dumps(stdgen.sbom(d), indent=2) + "\n")
        w(d, "pkg/package.json", {"name": "@org/pkg", "version": "1.0.1"}); self.assertNotEqual(stdgen.sbom(d)["serialNumber"], s["serialNumber"], "the serial follows the content")
        self.assertEqual(stdgen.check(ROOT), [], "the committed catalog and SBOM match the registers")
        kinds = {e["kind"] for e in stdgen.entities(ROOT)}; self.assertTrue({"Group", "System", "Domain", "API", "Resource", "Component"} <= kinds)
        self.assertEqual(stdgen._name("a b/c@d"), "a-b-c-d"); self.assertEqual(len(stdgen._name("x" * 80)), 63)

    def test_us_32_r76_the_supply_chain_reading_files_one_item_per_failing_check_and_licence_and_each_item_closes_on_the_next_reading(self):
        cfg = {"scorecard_floor": 5, "ignore_checks": {"Code-Review": "no human review here"}, "licence_policy": "p.json", "max_age_days": 14, "max_items_per_run": 2}
        sc = {"score": 6.1, "scorecard": {"version": "v5"}, "checks": [{"name": "Token-Permissions", "score": 2}, {"name": "Code-Review", "score": 0}, {"name": "SAST", "score": -1}, {"name": "Pinned", "score": 4}, {"name": "Vuln", "score": 10}]}
        sbom = {"sbom": {"spdxVersion": "SPDX-2.3", "documentDescribes": ["SPDXRef-root"], "packages": [{"SPDXID": "SPDXRef-root", "name": "com.github.o/r", "licenseConcluded": "AGPL-3.0-only"},
               {"SPDXID": "SPDXRef-a", "name": "ok", "licenseConcluded": "MIT"}, {"SPDXID": "SPDXRef-b", "name": "weird pkg", "versionInfo": "1.0", "licenseConcluded": "GPL-3.0-only"}, {"SPDXID": "SPDXRef-c", "name": "unknown"},
               {"SPDXID": "SPDXRef-d", "name": "dual", "licenseConcluded": "MIT OR Apache-2.0"}]}}
        rep = supplychain.summarise(sc, sbom, cfg, {"shipped": ["MIT"], "tool": ["Apache-2.0"]}, "2026-11-26")
        self.assertEqual(rep["sbom"]["packages"], 5); self.assertEqual(rep["sbom"]["licences"], {"GPL-3.0-only": 1, "MIT": 1, "MIT OR Apache-2.0": 1, "NOASSERTION": 1}, "the repository itself is not counted"); self.assertEqual(rep["sbom"]["outside_policy"], [{"package": "weird pkg", "version": "1.0", "licence": "GPL-3.0-only"}])
        self.assertEqual(rep["floor"], 5); self.assertEqual(rep["scorecard"]["checks"]["SAST"], -1)
        ids = [i for i, _ in supplychain.failing(rep, cfg)]; self.assertEqual(ids, ["Q-STD-SC-Pinned", "Q-STD-SC-Token-Permissions", "Q-STD-SC-LIC-weird-pkg"], "an ignored check and an unscored one file nothing; a check at the floor passes")
        r = scratch(); (r / "docs/issues").mkdir(parents=True); w(r, supplychain.CFG, cfg)
        made = supplychain.file_items(r, rep, cfg); self.assertEqual(len(made), 2, "at most max_items_per_run items are filed in one reading"); self.assertEqual(supplychain.file_items(r, rep, cfg), [], "an existing item is never overwritten")
        item = json.loads((r / "docs/issues/Q-STD-SC-Pinned.json").read_text()); self.assertIn("**Done check:** cmd:python3 -m foundation supplychain --probe Q-STD-SC-Pinned", item["body"]); self.assertIn("**Out of scope:** lowering the floor.", item["body"]); self.assertIn("standards", item["labels"])
        self.assertFalse(supplychain.probe(r, "Q-STD-SC-Pinned"), "with no reading there is nothing to close an item")
        w(r, supplychain.OUT, rep); self.assertFalse(supplychain.probe(r, "Q-STD-SC-Pinned")); rep["scorecard"]["checks"]["Pinned"] = 9; w(r, supplychain.OUT, rep); self.assertTrue(supplychain.probe(r, "Q-STD-SC-Pinned"), "the next reading closes it")
        today = dt.date(2026, 11, 26); self.assertEqual(supplychain.check(r, today=today), [])
        self.assertTrue(any("last supply-chain reading is 15 days old (limit 14)" in b for b in supplychain.check(r, today=dt.date(2026, 12, 11)))); self.assertEqual(supplychain.check(r, today=dt.date(2026, 12, 10)), [])
        w(r, supplychain.CFG, {**cfg, "scorecard_floor": 11}); self.assertTrue(any("scorecard_floor must be an integer 0..10" in b for b in supplychain.check(r, today=today)))
        w(r, supplychain.CFG, {**cfg, "ignore_checks": {"X": ""}}); self.assertTrue(any("ignored check X needs a reason" in b for b in supplychain.check(r, today=today)))
        self.assertEqual(supplychain.check(ROOT), []); real = json.loads((ROOT / supplychain.CFG).read_text()); self.assertTrue(all(real["ignore_checks"].values()))


# ---------------------------------------------------------------------------------------------------------------------------- Agent standards and findability

class AgentStandardsAndFindability(unittest.TestCase):
    def tree(self, standards, files=None):
        d = scratch(); w(d, agentstd.PATH, {"marker": "AGENT-CONSUMPTION", "marker_text": "AGENT-CONSUMPTION: code is read by agents.", "instruction_files": ["AGENTS.md", "agents/roles/*.md"], "standards": standards})
        for rel, text in {"AGENTS.md": "x\n> AGENT-CONSUMPTION: y", "agents/roles/a.md": "role AGENT-CONSUMPTION", "src/code.js": "export const a = 1;", "tests/t.mjs": "needle", **(files or {})}.items():
            w(d, rel, text)
        return d

    def test_us_32_r77_each_agent_standard_is_implemented_with_a_passing_proof_or_declined_or_pending_with_a_trigger_and_every_instruction_file_carries_the_marker(self):
        impl = {"id": "a", "status": "implemented", "source": "https://example.org/s", "read": "2026-11-26", "code": "src/code.js", "proof": "grep:tests/t.mjs::needle"}
        pend = {"id": "b", "status": "pending", "source": "https://example.org/s", "read": "2026-11-26", "trigger": "a key exists", "probe": "file:src/code.js"}
        decl = {**pend, "id": "c", "status": "declined", "reason": "nothing to describe"}
        self.assertEqual(agentstd.check(self.tree([impl, pend, decl])), [])
        for bad, why in (({**impl, "source": "http://x"}, "needs an https source and the date it was read"), ({**impl, "read": "yesterday"}, "needs an https source"), ({**impl, "status": "maybe"}, "status must be implemented, declined or pending"),
                         ({**impl, "code": "src/none.js"}, "code file missing"), ({**impl, "proof": "grep:tests/t.mjs::absent"}, "proof probe fails"), ({**impl, "proof": "file:src/none.js"}, "proof probe fails"),
                         ({**pend, "trigger": ""}, "declined/pending needs a trigger and a passing probe"), ({**pend, "probe": "file:src/none.js"}, "declined/pending needs a trigger and a passing probe"), ({k: v for k, v in decl.items() if k != "reason"}, "declined needs a reason")):
            self.assertTrue(any(why in b for b in agentstd.check(self.tree([bad]))), why)
        self.assertTrue(any("a: duplicate id" in b for b in agentstd.check(self.tree([impl, impl]))))
        d = self.tree([impl], {"AGENTS.md": "no marker here", "agents/roles/z.md": "none either"}); gaps = agentstd.marker_gaps(d, agentstd.load(d))
        self.assertEqual(sorted(gaps), ["AGENTS.md: lacks AGENT-CONSUMPTION", "agents/roles/z.md: lacks AGENT-CONSUMPTION"]); self.assertEqual(agentstd.check(d), gaps)
        self.assertEqual(agentstd.stamp(d), ["AGENTS.md", "agents/roles/z.md"]); self.assertEqual(agentstd.check(d), []); self.assertTrue((d / "AGENTS.md").read_text().rstrip().endswith("> AGENT-CONSUMPTION: code is read by agents.")); self.assertEqual(agentstd.stamp(d), [], "stamping twice changes nothing")
        real = agentstd.load(ROOT); self.assertTrue(all(s["status"] in ("implemented", "declined", "pending") for s in real["standards"])); self.assertEqual(agentstd.check(ROOT), [])

    def test_us_32_r78_each_property_is_read_as_a_stranger_would_and_a_gap_files_one_item_that_the_same_reading_closes(self):
        GOOD = ('<title>Thing here</title><meta name="description" content="A long enough description of the page.">'
                '<link rel="canonical" href="/"><meta property="og:title" content="x"><script type="application/ld+json">{}</script><link rel="alternate" type="application/atom+xml" href="/feed.atom">')
        self.assertEqual(findable.home_gaps(GOOD), [])
        self.assertEqual(findable.home_gaps("<title>Thing here</title>"), ["meta description", "canonical link", "Open Graph title", "schema.org JSON-LD", "feed link"])
        self.assertEqual(findable.home_gaps(""), ["title", "meta description", "canonical link", "Open Graph title", "schema.org JSON-LD", "feed link"]); self.assertIn("title", findable.home_gaps("<title>ab</title>"))
        self.assertEqual(findable.robots_gaps("User-agent: *\nAllow: /\nSitemap: https://a.example/sitemap.xml\n"), [])
        self.assertEqual(findable.robots_gaps("User-agent: *\nAllow: /\n"), ["robots.txt names no sitemap"]); self.assertIn("robots.txt blocks every crawler", findable.robots_gaps("User-agent: *\nDisallow: /\nSitemap: https://a.example/s.xml\n"))
        self.assertEqual(findable.feeds(GOOD, "https://a.example/"), ["https://a.example/feed.atom"])
        pages = {"/": GOOD, "/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://a.example/sitemap.xml\n", "/sitemap.xml": "<urlset><url><loc>https://a.example/</loc></url></urlset>", "/llms.txt": "# a"}
        def get(u):
            path = "/" + u.split("/", 3)[3] if u.count("/") > 2 else "/"
            return (200, pages[path]) if path in pages else (404, "")
        self.assertEqual(findable.read("https://a.example", get), {"url": "https://a.example", "gaps": [], "feeds": ["https://a.example/feed.atom"]})
        gone = findable.read("https://a.example", lambda u: (503, "")); self.assertEqual(gone["gaps"], ["home page answered 503"])
        pages.pop("/llms.txt"); pages["/sitemap.xml"] = "<urlset/>"; del pages["/robots.txt"]
        self.assertEqual(findable.read("https://a.example", get)["gaps"], ["no robots.txt", "no sitemap.xml with urls", "no llms.txt"])
        it = findable.item("a", {"url": "https://a.example", "gaps": ["no llms.txt"]}); self.assertEqual((it["id"], it["status"]), ("Q-FIND-a", "open")); self.assertIn("python3 -m foundation findable --probe a", it["body"])
        d = scratch(); (d / "docs/issues").mkdir(parents=True); orig = findable.properties; findable.properties = lambda root=ROOT: [{"id": "a", "url": "https://a.example"}]
        try:
            self.assertEqual(findable.run(d, apply=False, get=get)["a"]["gaps"], ["no robots.txt", "no sitemap.xml with urls", "no llms.txt"]); self.assertFalse((d / "docs/issues/Q-FIND-a.json").exists(), "a reading that is not applied files nothing")
            findable.run(d, apply=True, get=get); filed = json.loads((d / "docs/issues/Q-FIND-a.json").read_text()); self.assertEqual(filed["status"], "open"); self.assertTrue((d / "ops/findable.json").exists())
            pages.update({"/robots.txt": "User-agent: *\nAllow: /\nSitemap: https://a.example/sitemap.xml\n", "/sitemap.xml": "<urlset><url><loc>https://a.example/</loc></url></urlset>", "/llms.txt": "# a"})
            findable.run(d, apply=True, get=get); closed = json.loads((d / "docs/issues/Q-FIND-a.json").read_text()); self.assertEqual(closed["status"], "done"); self.assertIn("**Status:** done", closed["body"]); self.assertIn("the daily reading found no gaps", closed["body"])
        finally:
            findable.properties = orig


if __name__ == "__main__":
    unittest.main()

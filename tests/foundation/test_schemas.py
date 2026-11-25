# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STANDARDS-FIRST-1: JSON Schema for every config (foundation/schemas.py) and the measured standards register (foundation/standards.py)."""
import copy, json, unittest
from pathlib import Path
from foundation import configschema as CS, schemas as S, standards as ST

REPO = Path(__file__).resolve().parents[2]
J = lambda rel: json.loads((REPO / rel).read_text(encoding="utf-8"))  # noqa: E731


class Validator(unittest.TestCase):
    def test_each_keyword_refuses_what_it_should(self):
        cases = [({"type": "integer"}, True), ({"type": "integer"}, 1.5), ({"type": "string", "minLength": 2}, "a"), ({"type": "string", "maxLength": 1}, "ab"),
                 ({"pattern": "^a"}, "b"), ({"enum": ["x"]}, "y"), ({"const": 1}, 2), ({"minimum": 3}, 2), ({"maximum": 3}, 4), ({"required": ["k"]}, {}),
                 ({"properties": {"k": {"type": "string"}}}, {"k": 1}), ({"additionalProperties": False, "properties": {"k": {}}}, {"z": 1}),
                 ({"patternProperties": {"^x-": {"type": "string"}}}, {"x-a": 1}), ({"items": {"type": "string"}}, [1]), ({"minItems": 1}, []), ({"maxItems": 1}, [1, 2]),
                 ({"uniqueItems": True}, [1, 1]), ({"oneOf": [{"type": "string"}, {"minLength": 1}]}, "a"), ({"anyOf": [{"type": "string"}, {"type": "null"}]}, 1),
                 ({"allOf": [{"type": "string"}, {"minLength": 2}]}, "a"), ({"not": {"type": "string"}}, "a"), ({"$defs": {"n": {"type": "integer"}}, "$ref": "#/$defs/n"}, "a"), (False, 1)]
        for schema, value in cases:
            self.assertTrue(S.validate(schema, value), (schema, value))

    def test_valid_documents_pass_and_errors_carry_the_json_path(self):
        sc = {"type": "object", "required": ["rows"], "properties": {"rows": {"type": "array", "items": {"$ref": "#/$defs/row"}}}, "$defs": {"row": {"type": "object", "required": ["id"], "additionalProperties": False, "patternProperties": {"^_": True}, "properties": {"id": {"type": "string", "pattern": "^[a-z]+$"}}}}}
        self.assertEqual(S.validate(sc, {"rows": [{"id": "a", "_doc": "x"}]}), [])
        self.assertEqual(S.validate(sc, {"rows": [{"id": "a"}, {"id": "B"}]}), ["$.rows[1].id: 'B' does not match ^[a-z]+$"])
        self.assertEqual(S.validate({"type": "integer"}, 3.0), [])
        self.assertEqual(S.validate({"type": ["string", "null"]}, None), [])

    def test_a_schema_using_a_keyword_the_validator_does_not_run_is_refused(self):
        self.assertTrue(any("'format'" in b for b in S.lint({"type": "string", "format": "uri"})))
        self.assertTrue(any("'if'" in b for b in S.lint({"properties": {"a": {"if": {}}}})))
        self.assertEqual(S.lint({"$schema": S.DIALECT, "title": "t", "type": "object", "properties": {"a": {"description": "d", "type": "string"}}}), [])


class Coverage(unittest.TestCase):
    def test_the_load_bearing_files_have_hand_tightened_contracts_in_the_one_coverage_check(self):
        """Coverage is CONFIG-SCHEMA-1's (foundation/configschema.py). This adds the manifests outside doctrine/ and contracts tighter than a generated floor."""
        self.assertEqual(CS.check(REPO), [])
        held = {rel: sch for rel, sch, _ in CS.configs(REPO)}
        for f in ("instances/ultrastable/loop-registry.json", "instances/ultrastable/progress.json", "instances/ultrastable/instance.json", "instances/unlearn/lifecycle.json",
                  "instances/unlearn/runway.json", "seed/ultrastable.json", "seed/standards/standards.json", "seed/standards/surfaces.json", "doctrine/commit-convention.json"):
            self.assertIn(f, held)
        for sch in ("doctrine/schemas/tenant-repos.schema.json", "doctrine/schemas/topology.schema.json", "doctrine/schemas/detectors.schema.json", "doctrine/schemas/registers.schema.json",
                    "doctrine/schemas/claims.schema.json", "doctrine/schemas/clocks.schema.json", "instances/schemas/loop-registry.schema.json", "instances/schemas/lifecycle.schema.json"):
            text = (REPO / sch).read_text(encoding="utf-8")
            self.assertTrue(('"enum"' in text or '"const"' in text) and '"pattern"' in text, sch)
            self.assertEqual(S.lint(J(sch)), [], sch)

    def test_the_built_in_validator_of_the_coverage_check_is_this_one(self):
        sc = {"oneOf": [{"type": "string"}, {"type": "integer"}], "$defs": {}}
        self.assertEqual(CS.validate_subset(sc, 1), [])
        self.assertTrue(CS.validate_subset(sc, 1.5))

    def test_a_detector_owned_by_a_role_that_does_not_exist_is_refused(self):
        """The defect the detectors schema caught on 2026-11-25: three detectors were owned by `product` and `design`, roles with no role file,
        so the items they filed carried a label no role takes."""
        sc, d = J("doctrine/schemas/detectors.schema.json"), copy.deepcopy(J("doctrine/detectors.json"))
        roles = {p.stem for p in (REPO / "agents/roles").glob("*.md")}
        self.assertEqual(set(sc["$defs"]["role"]["enum"]), roles)
        self.assertEqual([x["id"] for x in d["detectors"] if x["owner"] not in roles], [])
        d["detectors"][0]["owner"] = "product"
        self.assertTrue(S.validate(sc, d))

    def test_a_tenant_row_missing_what_its_state_requires_is_refused(self):
        sc, d = J("doctrine/schemas/tenant-repos.schema.json"), copy.deepcopy(J("doctrine/tenant-repos.json"))
        slug = next(k for k, v in d["tenants"].items() if v["state"] == "planned")
        del d["tenants"][slug]["description"]
        self.assertTrue(S.validate(sc, d))
        d = copy.deepcopy(J("doctrine/tenant-repos.json")); d["tenants"][slug]["state"] = "launched"
        self.assertTrue(S.validate(sc, d))
        d = copy.deepcopy(J("doctrine/tenant-repos.json")); d["tenants"][slug]["typo_key"] = 1
        self.assertTrue(any("unknown key 'typo_key'" in b for b in S.validate(sc, d)))

    def test_a_lifecycle_answer_that_is_neither_closed_open_gate_nor_inherited_is_refused(self):
        sc, d = J("instances/schemas/lifecycle.schema.json"), copy.deepcopy(J("instances/unlearn/lifecycle.json"))
        self.assertEqual(S.validate(sc, d), [])
        d["survival"]["budget"] = {"status": "done"}
        self.assertTrue(S.validate(sc, d))
        del d["survival"]["privacy"]
        self.assertTrue(any("missing privacy" in b for b in S.validate(sc, d)))


class Register(unittest.TestCase):
    def setUp(self):
        self.reg = J(ST.REG)

    def test_the_register_passes_and_every_named_standard_has_a_measured_decision(self):
        self.assertEqual(ST.audit(REPO, self.reg), [])
        ids = {e["id"]: e for e in self.reg["entries"]}
        for i in ("json-schema-config", "agents-md", "mcp", "openapi", "asyncapi", "cloudevents", "cloudevents-webhooks", "opentelemetry", "otel-genai", "openslo", "schema-org-jsonld", "w3c-prov",
                  "conventional-commits-semver", "dependabot", "slsa-provenance", "terraform-opentofu", "opa-rego", "backstage-catalog", "publiccode-yml", "citation-cff", "spdx-reuse", "security-txt",
                  "well-known", "rfc9457-problem", "openssf-scorecard", "cyclonedx-sbom", "devcontainer", "openfeature", "wcag", "feeds", "robots-sitemaps", "llms-txt", "a2a", "oidc"):
            self.assertIn(ids[i]["decision"], ("adopt-now", "adopt-later", "decline"), i)
            self.assertIn(ids[i]["adoption"], ("adopted", "partial", "homegrown", "not-applicable"), i)
            self.assertTrue(ids[i]["probes"] and ids[i]["conformance"] and ids[i]["cost"], i)

    def _one(self, **kw):
        e = {"id": "x", "name": "X", "body": "b", "status": "stable", "tracked": "1", "why": "w", "support": "supported", "sources": [], "decision": "adopt-now", "adoption": "adopted",
             "conformance": "c", "cost": "S", "probes": ["file:LICENSE"], "audited": "2026-11-25", **kw}
        return [b for b in ST.audit(REPO, {"entries": [e], "undecided_ceiling": 0}) if b.startswith("x:")]  # the scout's lines about the other rows are not this row's

    def test_a_row_whose_probe_fails_is_named(self):
        self.assertEqual(self._one(), [])
        self.assertEqual(self._one(probes=["file:no/such/file"]), ["x: probe file fails: no/such/file is missing"])
        self.assertTrue(self._one(probes=["grep:LICENSE::this text is not in the licence zzz"]))
        self.assertTrue(self._one(probes=["absent:LICENSE"]))
        self.assertTrue(self._one(homegrown=["no/such/path"]))

    def test_decisions_are_held_to_their_evidence(self):
        self.assertTrue(any("adopt-later needs" in b for b in self._one(decision="adopt-later", adoption="homegrown", homegrown=["LICENSE"], support="planned", tracked_by="Q-NOT-FILED")))
        self.assertEqual(self._one(decision="adopt-later", adoption="homegrown", homegrown=["LICENSE"], support="planned", tracked_by="Q-STD-SLSA"), [])
        self.assertTrue(any("declined row needs" in b for b in self._one(decision="decline", adoption="homegrown", homegrown=["LICENSE"], support="not_applicable", reason="r")))
        self.assertEqual(self._one(decision="decline", adoption="homegrown", homegrown=["LICENSE"], support="not_applicable", reason="r", revisit="when"), [])
        self.assertTrue(any("adopt-now means" in b for b in self._one(adoption="homegrown", homegrown=["LICENSE"])))
        self.assertTrue(any("needs `cost`" in b for b in self._one(cost="")))
        self.assertTrue(any("watch names scout source" in b for b in self._one(watch="no-such-source")))

    def test_rows_without_a_decision_only_shrink(self):
        undecided = sum(1 for e in self.reg["entries"] if "decision" not in e)
        self.assertEqual(undecided, self.reg["undecided_ceiling"])
        reg = {"entries": self.reg["entries"] + [{"id": "new", "name": "N", "body": "b", "status": "stable", "tracked": "1", "why": "w", "support": "not_applicable", "reason": "r", "sources": []}], "undecided_ceiling": self.reg["undecided_ceiling"]}
        self.assertTrue(any("carry no decision" in b for b in ST.audit(REPO, reg)))

    def test_every_watched_standard_has_its_release_feed_in_the_scout(self):
        feeds = {s["standard"]: s["id"] for s in J("doctrine/scout.json")["sources"] if "standard" in s}
        watched = {e["id"]: e["watch"] for e in self.reg["entries"] if e.get("watch")}
        self.assertEqual(feeds, watched)
        self.assertGreaterEqual(len(watched), 8)

    def test_the_closing_probe_of_an_item_needs_adopted_and_passing_probes(self):
        self.assertEqual(ST.adopted(REPO, "citation-cff"), [])
        self.assertTrue(any("not adopted" in b for b in ST.adopted(REPO, "cloudevents")))
        self.assertTrue(ST.adopted(REPO, "no-such-row"))
        for e in self.reg["entries"]:
            if "decision" in e and (e.get("tracked_by") or "").startswith("Q-STD-") and e["tracked_by"] not in ("Q-STD-SLSA", "Q-STD-OPENFEATURE"):  # those two are STANDARDS-1's, closed by `standards --probe`
                it = J(f"docs/issues/{e['tracked_by']}.json")
                self.assertIn(f"cmd:python3 -m foundation standards --adopted {e['id']}", it["body"])

    def test_live_reads_name_the_row_the_address_and_what_is_missing(self):
        pages = {"https://ultrastable.io/llms.txt": (200, "text/plain", "# Ultrastable"), "https://ultrastable.io/feed.json": (200, "application/feed+json", '{"version": "1.1"}')}
        bad = ST.live(REPO, fetch=lambda u: pages.get(u, (404, "text/plain", "")))
        self.assertTrue(any(b.startswith("feeds: https://ultrastable.io/feed.json lacks 'items'") for b in bad))
        self.assertTrue(any(b.startswith("security-txt: https://ultrastable.io/.well-known/security.txt answered 404") for b in bad))
        self.assertFalse(any(b.startswith("llms-txt:") for b in bad))

    def test_the_detectors_and_failure_mode_route_a_failing_row_into_the_queue(self):
        det = {x["id"]: x for x in J("doctrine/detectors.json")["detectors"]}
        self.assertEqual(det["standards-register"]["run"], ["python3", "-m", "foundation", "standards", "--check"])
        self.assertEqual(det["standards-live"]["run"][-1], "--live")
        self.assertIn("fm-standard-drift", {m["id"] for m in J("doctrine/registers.json")["failure_modes"]})

    def test_dependabot_covers_actions_and_every_package_manifest_directory(self):
        text = (REPO / ".github/dependabot.yml").read_text(encoding="utf-8")
        self.assertIn("package-ecosystem: github-actions", text)
        dirs = set(__import__("re").findall(r"package-ecosystem: npm\s+directory: (\S+)", text))
        self.assertIn("/seed/worker", dirs); self.assertIn("/workers", dirs)

    def test_shared_modules_carry_an_spdx_identifier(self):
        for f in ("seed/worker/src/cloudevents.js", "seed/worker/src/errors.js", "seed/worker/src/contract.js", "foundation/schemas.py", "foundation/cloudevents.py", "foundation/commitlint.py"):
            self.assertIn("SPDX-License-Identifier:", (REPO / f).read_text(encoding="utf-8").split("\n", 3)[0] + (REPO / f).read_text(encoding="utf-8").split("\n", 3)[1], f)


if __name__ == "__main__":
    unittest.main()

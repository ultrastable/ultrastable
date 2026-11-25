# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-MANIFEST-1: the manifest is valid against its schema, every surface is rendered from it, rendering twice changes nothing, and a
surface edited by hand is drift."""
import json, shutil, sys, tempfile, unittest
from pathlib import Path

SEED = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED / "scripts"))
import surfaces as S  # noqa: E402

IDENT = {"name": "River Watch", "slug": "river-watch", "summary": "Watches river gauges against flood rules and files what changed, every hour.", "repo": "acme/river-watch",
         "public_url": "https://river.example", "license": "MIT", "topics": ["rivers", "ultrastable"], "layer": "seeded-system", "parent": "ultrastable/ultrastable",
         "visibility": "public", "visibility_reason": "public by default", "status": "live", "loop": "Gauge readings are compared with the rules every hour and a breach files its own remedy.",
         "runs_as": [{"provider": "cloudflare", "kind": "worker", "name": "river-watch", "routes": ["river.example"], "how": "deployed by its own lane"}]}


def world(identity=IDENT, readme="# River Watch\n\nOwn words that stay.\n"):
    d = Path(tempfile.mkdtemp())
    (d / "standards").mkdir()
    shutil.copy(SEED / "standards/system.schema.json", d / "standards/system.schema.json")
    (d / "ultrastable.json").write_text(json.dumps({"identity": identity, "org": {}}))
    if readme is not None:
        (d / "README.md").write_text(readme)
    return d


class Schema(unittest.TestCase):
    def test_the_seeds_own_manifest_is_valid_and_its_surfaces_are_current(self):
        self.assertEqual(S.check_manifest(SEED), [])
        self.assertEqual(S.check(SEED), [])

    def test_bad_values_are_named(self):
        sch = S.schema(SEED)
        bad = {**IDENT, "summary": "x" * 351, "layer": "misc", "repo": "no-owner", "public_url": "http://plain.example/", "topics": ["Upper"], "stage": "autonomous"}
        errs = "\n".join(S.validate({"identity": bad}, sch))
        for want in ("summary: longer than 350", "layer: must be one of", "repo: does not match", "public_url: does not match", "topics[0]: does not match", "stage: not a manifest field (the stage is computed"):
            self.assertIn(want, errs)
        self.assertIn("$.identity.name: required", "\n".join(S.validate({"identity": {k: v for k, v in IDENT.items() if k != "name"}}, sch)))
        self.assertEqual(S.validate({"identity": {**IDENT, "public_url": None}}, sch), [])

    def test_one_name_one_slug(self):
        d = world()
        (d / "ultrastable.json").write_text(json.dumps({"identity": IDENT, "org": {"name": "Other"}}))
        self.assertTrue(any("one name, one slug" in e for e in S.check_manifest(d)))
        self.assertTrue(any("missing" in e for e in S.check_manifest(Path(tempfile.mkdtemp()))))


class Render(unittest.TestCase):
    def test_render_writes_every_surface_and_twice_changes_nothing(self):
        d = world()
        self.assertEqual(sorted(S.render(d)), sorted(["README.md", "publiccode.yml", "catalog-info.yaml", "CITATION.cff", S.GITHUB_PLAN]))
        self.assertEqual(S.render(d), [])
        self.assertEqual(S.check(d), [])
        r = (d / "README.md").read_text()
        self.assertTrue(r.startswith("# River Watch\n"))
        for want in ("identity:start", "**Running at [https://river.example](https://river.example/)**", "Own words that stay.", "## How this system runs",
                     "`unseeded` → `seeded` → `ticking`", "`self-sustaining`", "k = verified deploys", "https://river.example/live", "Cloudflare Worker `river-watch`, deployed by its own lane"):
            self.assertIn(want, r)
        self.assertLess(r.index("identity:start"), r.index("live:start"))
        self.assertLess(r.index("Own words"), r.index("how:start"))

    def test_a_hand_edit_or_a_changed_manifest_is_drift_and_render_heals_it(self):
        d = world()
        S.render(d)
        (d / "README.md").write_text((d / "README.md").read_text().replace("https://river.example/health", "https://old.example/health"))
        self.assertTrue(any(e.startswith("README.md: differs") for e in S.check(d)))
        S.render(d)
        (d / "ultrastable.json").write_text(json.dumps({"identity": {**IDENT, "public_url": "https://moved.example"}}))
        drift = S.check(d)
        self.assertEqual(len(drift), 5)  # one moved address is drift on every surface (README, publiccode, catalog-info, CITATION, the GitHub plan)
        S.render(d)
        self.assertEqual(S.check(d), [])
        self.assertIn("https://moved.example", (d / "publiccode.yml").read_text())

    def test_catalog_info_is_a_backstage_component_built_from_the_manifest(self):
        """STANDARDS-FIRST-1: catalog-info.yaml (Backstage descriptor format) is rendered, never typed; a changed manifest is drift until rendered."""
        d = world()
        S.render(d)
        c = (d / "catalog-info.yaml").read_text()
        for want in ("apiVersion: backstage.io/v1alpha1\nkind: Component\n", "  name: river-watch\n", '  title: "River Watch"\n', "    github.com/project-slug: acme/river-watch\n",
                     '    - url: "https://river.example"\n      title: "Live"', '    - url: "https://river.example/health"', "  lifecycle: production\n", '  owner: "group:default/acme"\n', "  system: ultrastable\n"):
            self.assertIn(want, c)
        self.assertRegex(c, r"spec:\n  type: (website|service)\n")
        self.assertNotIn("kind: System", c)
        keys = [l.split(":")[0] for l in c.splitlines() if l and not l.startswith((" ", "#", "-"))]
        self.assertEqual(keys, ["apiVersion", "kind", "metadata", "spec"])
        dp = world({**IDENT, "layer": "platform"})
        self.assertNotIn("catalog-info.yaml", S.surfaces(dp))  # the platform's catalog is generated from its registers, not from one manifest
        self.assertIn("lifecycle: experimental", S.catalog({**IDENT, "status": "planned"}, "planned"))
        m = json.loads((d / "ultrastable.json").read_text()); m["identity"]["summary"] = "A different summary, long enough for the schema to accept it."
        (d / "ultrastable.json").write_text(json.dumps(m))
        self.assertTrue(any(e.startswith("catalog-info.yaml: differs") for e in S.check(d)))

    def test_publiccode_citation_and_plans_carry_the_manifest(self):
        d = world()
        S.render(d)
        pc = (d / "publiccode.yml").read_text()
        for want in ('name: "River Watch"', 'url: "https://github.com/acme/river-watch"', 'landingURL: "https://river.example"', "developmentStatus: stable", '  license: "MIT"', "shortDescription:"):
            self.assertIn(want, pc)
        cit = (d / "CITATION.cff").read_text()
        self.assertIn('repository-code: "https://github.com/acme/river-watch"', cit)
        (d / "CITATION.cff").write_text("cff-version: 1.2.0\ntitle: \"Old\"\nauthors:\n  - name: \"Kept\"\n")
        S.render(d)
        cit = (d / "CITATION.cff").read_text()
        self.assertIn('title: "River Watch"', cit)
        self.assertIn("Kept", cit)
        p = S.plan(IDENT)
        self.assertEqual((p["github"]["description"], p["github"]["homepage"], p["github"]["topics"]), (IDENT["summary"], "https://river.example", ["rivers", "ultrastable"]))
        self.assertEqual(p["github"]["settings"]["delete_branch_on_merge"], True)
        self.assertEqual(json.loads((d / S.GITHUB_PLAN).read_text()), p["github"])
        self.assertEqual((p["wellknown"]["name"], p["wellknown"]["repo"], p["wellknown"]["url"]), ("River Watch", "https://github.com/acme/river-watch", "https://river.example"))

    def test_a_template_and_an_undeployed_system(self):
        t = S.render_readme("# t\n", {**IDENT, "layer": "template", "public_url": None, "runs_as": []}, "unmeasured")
        self.assertNotIn("live:start", t)
        u = S.render_readme("# t\n", {**IDENT, "public_url": None}, "unmeasured")
        self.assertIn("Not deployed yet", u)
        self.assertIn("`/health`", u)

    def test_the_stage_is_read_from_evidence_never_the_manifest(self):
        d = world()
        self.assertEqual(S.stage(d), "unmeasured")
        (d / "ops").mkdir()
        (d / "ops/seed-lifecycle.json").write_text(json.dumps({"stage": "deployed"}))
        self.assertEqual(S.stage(d), "deployed")
        self.assertIn("Stage at the last reading: `deployed`", S.surfaces(d)["README.md"])

    def test_the_ladders_equal_the_code_that_computes_them(self):
        import re
        js = (SEED / "worker/src/ignition.js").read_text()
        self.assertEqual(re.findall(r"'([a-z-]+)'", re.search(r"export const STAGES = \[(.*?)\]", js).group(1)), S.IGNITION)
        py = (SEED / "scripts/seedlife.py").read_text()
        self.assertEqual(re.findall(r'"([a-z]+)"', re.search(r"^STAGES = \((.*?)\)", py, re.M).group(1)), S.LIFECYCLE)


if __name__ == "__main__":
    unittest.main()

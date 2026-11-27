# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-MANIFEST-1: the manifest is valid against its schema, every surface is rendered from it, rendering twice changes nothing, and a
surface edited by hand is drift."""
import json, os, shutil, subprocess, sys, tempfile, tomllib, unittest
from pathlib import Path

SEED = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED / "scripts"))
import surfaces as S  # noqa: E402

IDENT = {"name": "River Watch", "slug": "river-watch", "summary": "Watches river gauges against flood rules and files what changed, every hour.", "repo": "acme/river-watch",
         "public_url": "https://river.example", "license": "MIT", "topics": ["rivers", "ultrastable"], "layer": "seeded-system", "parent": "ultrastable/ultrastable",
         "visibility": "public", "visibility_reason": "public by default", "status": "live", "loop": "Gauge readings are compared with the rules every hour and a breach files its own remedy.",
         "runs_as": [{"provider": "cloudflare", "kind": "worker", "name": "river-watch", "routes": ["river.example"], "how": "deployed by its own lane"}]}


# REUSE-IgnoreStart  (a licence text the tests render from, not this file's own licence)
MIT = "MIT License\n\nCopyright (c) 2026 River Watch Society\n\nPermission is hereby granted, free of charge, ...\n"
# REUSE-IgnoreEnd
RENDERED = ["CITATION.cff", "LICENSES/MIT.txt", "README.md", "REUSE.toml", S.GITHUB_PLAN, "catalog-info.yaml", "codemeta.json", "llms.txt", "publiccode.yml"]


def world(identity=IDENT, readme="# River Watch\n\nOwn words that stay.\n", license=MIT):
    d = Path(tempfile.mkdtemp())
    (d / "standards").mkdir()
    shutil.copy(SEED / "standards/system.schema.json", d / "standards/system.schema.json")
    (d / "ultrastable.json").write_text(json.dumps({"identity": identity, "org": {}}))
    if readme is not None:
        (d / "README.md").write_text(readme)
    if license is not None:
        (d / "LICENSE").write_text(license)
    return d


def yaml_keys(text: str, indent: str = "") -> list[str]:
    """The keys of a YAML mapping at one indentation (enough for the files the renderer writes, which are one key per line)."""
    return [l[len(indent):].split(":")[0] for l in text.splitlines() if l.startswith(indent) and l[len(indent):][:1].isalpha() and ":" in l]


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
        self.assertEqual(sorted(S.render(d)), sorted(RENDERED + list(S.SCAFFOLD)))
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
        self.assertEqual(len(drift), 7)  # one moved address is drift on every surface that names it (README, publiccode, catalog-info, CITATION, llms.txt, codemeta, the GitHub plan)
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


# REUSE-IgnoreStart  (a licence text the tests render from, not this file's own licence)
USL = "ULTRASTABLE LICENSE v1.0\nSPDX-License-Identifier: LicenseRef-Test-1.0\nEffective: 2026-11-11\nLicensor: Ada Lovelace (ORCID 0000-0002-1825-0097), and any successor.\n\n11. CONTRIBUTIONS\n"
# REUSE-IgnoreEnd
REF = {**IDENT, "license": "LicenseRef-Test-1.0"}


class Standards(unittest.TestCase):
    """Each rendered file follows its own published standard, and the holder is read from LICENSE, never guessed."""

    def test_a_licence_ref_is_a_license_url_in_citation_cff(self):
        d = world(REF, license=USL)
        (d / "CITATION.cff").write_text('cff-version: 1.2.0\ntitle: "Old"\nlicense: "LicenseRef-Test-1.0"\nauthors:\n  - name: "Kept"\n')
        S.render(d)
        cit = (d / "CITATION.cff").read_text()
        self.assertNotIn("license", yaml_keys(cit))
        self.assertIn('license-url: "https://github.com/acme/river-watch/blob/main/LICENSE"', cit)
        self.assertTrue({"cff-version", "message", "title", "authors"} <= set(yaml_keys(cit)), "the keys CFF 1.2.0 requires")
        self.assertIn("Kept", cit)
        m = json.loads((d / "ultrastable.json").read_text()); m["identity"]["license"] = "MIT"
        (d / "ultrastable.json").write_text(json.dumps(m))
        S.render(d)
        cit = (d / "CITATION.cff").read_text()
        self.assertIn('license: "MIT"', cit)
        self.assertNotIn("license-url", cit, "an SPDX id needs no url, and a stale one would mislead")

    def test_publiccode_has_version_0_features_and_a_named_contact(self):
        d = world(REF, license=USL)
        S.render(d)
        pc = (d / "publiccode.yml").read_text()
        for want in ('publiccodeYmlVersion: "0"\n', "  type: internal\n  contacts:\n    - name: \"Ada Lovelace\"\n", '  mainCopyrightOwner: "Ada Lovelace"', "    features:\n      - ",
                     "https://publiccodeyml.github.io/v0/"):
            self.assertIn(want, pc)
        long = json.loads(pc.split("longDescription: ", 1)[1].split("\n", 1)[0])
        self.assertGreaterEqual(len(long), 150)
        self.assertNotIn("yml.publiccode.tools", pc)
        self.assertEqual(S.short("word " * 40, 150)[-1], "…")
        self.assertLessEqual(len(S.short("word " * 40, 150)), 150)
        self.assertTrue(S.short("x" * 10 + " endsmidword" * 20, 150).rstrip("…").endswith("endsmidword"), "cut at a word, never inside one")
        thin = world({**IDENT, "layer": "admin", "loop": "", "summary": "Holds the papers, nothing more.", "public_url": None, "runs_as": []})
        self.assertTrue(any("longDescription" in e and "never padded" in e for e in S.check(thin)))
        self.assertEqual(S.long_description(S.identity(thin)).count("Holds the papers"), 1, "the summary is never said twice to reach the length")
        self.assertIsNone(S.surfaces(thin)["publiccode.yml"], "a publiccode.yml that would break its standard is held back, not padded")
        wrote = S.render(thin)
        self.assertNotIn("publiccode.yml", wrote)
        self.assertTrue({"llms.txt", "REUSE.toml", "codemeta.json", "CITATION.cff"} <= set(wrote), "one missing fact holds back only its own surface")
        self.assertEqual(S.main(["--render", "--root", str(thin)]), 1, "the command is not green while a surface waits")
        own = {**S.identity(thin), "description": "The papers of the organization, held in one private repository so that every decision has a record. "
                                                  "No code deploys from it; the loops that read it run elsewhere."}
        self.assertEqual(S.long_description(own), own["description"], "the system's own longer description is used as written")

    def test_reuse_toml_licenses_and_codemeta(self):
        d = world(REF, license=USL)
        S.render(d)
        reuse = tomllib.loads((d / "REUSE.toml").read_text())
        self.assertEqual(reuse["version"], 1)
        self.assertEqual(reuse["annotations"][0], {"path": "**", "precedence": "closest", "SPDX-FileCopyrightText": "2026 Ada Lovelace", "SPDX-License-Identifier": "LicenseRef-Test-1.0"})
        self.assertEqual((d / "LICENSES/LicenseRef-Test-1.0.txt").read_text(), USL)
        cm = json.loads((d / "codemeta.json").read_text())
        self.assertEqual((cm["@context"], cm["@type"], cm["codeRepository"], cm["license"]),
                         ("https://w3id.org/codemeta/3.0", "SoftwareSourceCode", "https://github.com/acme/river-watch", "https://github.com/acme/river-watch/blob/main/LICENSE"))
        self.assertEqual(cm["author"], [{"@type": "Person", "@id": "https://orcid.org/0000-0002-1825-0097", "name": "Ada Lovelace"}])
        self.assertEqual(json.loads(S.codemeta(IDENT, S.holder(world())))["license"], "https://spdx.org/licenses/MIT.html")
        self.assertEqual(S.holder(world())["name"], "River Watch Society")

    def test_a_holder_nobody_wrote_down_fails_plainly(self):
        d = world(license="Some licence text with no holder in it.\n")
        errs = S.check(d)
        self.assertTrue(any("names the copyright holder" in e and "never guessed" in e for e in errs), errs)
        wrote = S.render(d)
        for held in S.HOLDER_FILES:
            self.assertFalse((d / held).exists(), f"{held} names the holder, so it waits for one")
        self.assertTrue({"README.md", "llms.txt", "LICENSES/MIT.txt", "catalog-info.yaml"} <= set(wrote), "the surfaces that need no holder are still rendered")
        self.assertNotIn("[REUSE.toml]", (d / "llms.txt").read_text(), "llms.txt does not link a file this render held back")
        self.assertTrue(any("never guessed" in e for e in S.check(d)), "drift stays red while the holder is missing")
        self.assertEqual(S.main(["--render", "--root", str(d)]), 1)
        (d / "ultrastable.json").write_text(json.dumps({"identity": {**IDENT, "layer": "misc"}}))
        with self.assertRaises(S.Unrenderable):
            S.render(d)
        self.assertEqual(S.main(["--render", "--root", str(d)]), 1, "an invalid manifest is reported plainly, never raised past the caller")
        self.assertTrue(any(e.startswith("LICENSE: missing") for e in S.check(world(license=None))))
        (d / "CITATION.cff").write_text('cff-version: 1.2.0\nauthors:\n  - given-names: "Grace"\n    family-names: "Hopper"\n  - name: "Second"\n')
        self.assertEqual(S.holder(d)["name"], "Grace Hopper", "the first author of CITATION.cff is the next place the holder is read from")

    def test_llms_txt_lists_what_exists(self):
        d = world()
        (d / "AGENTS.md").write_text("# agents\n")
        S.render(d)
        t = (d / "llms.txt").read_text()
        self.assertTrue(t.startswith("# River Watch\n\n> Watches river gauges"))
        for want in ("## Live", "- [Health report](https://river.example/health)", "(https://river.example/llms.txt)", "- [AGENTS.md](AGENTS.md)", "- [codemeta.json](codemeta.json)", "- [CHANGELOG.md](CHANGELOG.md)"):
            self.assertIn(want, t)
        self.assertNotIn("bootstrap/bootstrap.py", t, "a file the repository does not have is not listed")

    def test_scaffold_files_are_written_once_and_never_overwritten(self):
        d = world()
        (d / "CONTRIBUTING.md").write_text("mine\n")
        wrote = S.render(d)
        self.assertNotIn("CONTRIBUTING.md", wrote)
        self.assertEqual((d / "CONTRIBUTING.md").read_text(), "mine\n")
        self.assertIn("## [Unreleased]", (d / "CHANGELOG.md").read_text())
        sec = (d / "SECURITY.md").read_text()
        self.assertIn("https://github.com/acme/river-watch/security/advisories/new", sec)
        self.assertNotIn("security.txt", sec, "a route the Worker does not serve is never named")
        (d / "worker/src").mkdir(parents=True)
        (d / "worker/src/visibility.js").write_text("export const PUBLIC_READS = Object.freeze(['/health', '/.well-known/security.txt']);\n")
        self.assertIn("https://river.example/.well-known/security.txt", S.scaffold(d)["SECURITY.md"])
        self.assertTrue(S.served(SEED, "/.well-known/ultrastable.json"))
        self.assertEqual(S.served(SEED, "/.well-known/security.txt"), "'/.well-known/security.txt'" in (SEED / "worker/src/visibility.js").read_text())
        (d / "CHANGELOG.md").write_text("# Changelog\n\n## [Unreleased]\n\n- a loop added this\n")
        self.assertEqual(S.render(d), [])
        self.assertIn("a loop added this", (d / "CHANGELOG.md").read_text())
        self.assertNotIn("CHANGELOG.md", S.surfaces(d), "people and loops append to the scaffold; it is never compared with a render")
        self.assertIn("Conventional Commits 1.0.0", S.scaffold(world(REF, license=USL))["CONTRIBUTING.md"])
        self.assertIn("section 11", S.scaffold(world(REF, license=USL))["CONTRIBUTING.md"])

    def test_deploy_button_and_the_platform_layer(self):
        d = world()
        (d / "wrangler.jsonc").write_text("{}\n")
        S.render(d)
        self.assertIn("(https://deploy.workers.cloudflare.com/?url=https://github.com/acme/river-watch)", (d / "README.md").read_text())
        self.assertNotIn("deploy.workers.cloudflare.com", S.surfaces(world())["README.md"], "no root Wrangler configuration, no button")
        p = world({**REF, "layer": "platform"}, license=USL)
        self.assertFalse({"README.md", "catalog-info.yaml", S.GITHUB_PLAN} & set(S.surfaces(p)), "each of those has its own generator on the platform")
        (p / "CITATION.cff").write_text('cff-version: 1.2.0\nmessage: "Cite it."\ntitle: "Own"\nabstract: "The platform\'s own words."\n'
                                        'authors:\n  - name: "Kept"\nlicense: "LicenseRef-Test-1.0"\n')
        S.render(p)
        cit = (p / "CITATION.cff").read_text()
        self.assertIn('abstract: "The platform\'s own words."', cit)
        self.assertIn('title: "Own"', cit)
        self.assertNotIn("license", yaml_keys(cit), "a LicenseRef is a license-url on the platform too")
        self.assertIn("license-url", yaml_keys(cit))
        self.assertEqual(S.check(p), [])


TEMPLATE_README = ("# ultrastable/seed\n\n<!-- identity:start (x) -->\nold\n<!-- identity:end -->\n\n<!-- example:start (x) -->\n## A running example\n<!-- example:end -->\n\n"
                   "The seed's own words.\n")


# The template's identity, written out so the tests read the same in the template and in every system born from it (whose own manifest is its own)
TEMPLATE = {**IDENT, "name": "Ultrastable seed", "slug": "seed", "repo": "ultrastable/seed", "public_url": None, "license": "LicenseRef-Test-1.0", "layer": "template",
            "topics": ["template", "ultrastable"], "status": "live", "runs_as": [],
            "summary": "The code-only kernel a new autonomous system starts from: bootstrapper, tick Worker, roles, agent instructions and loops."}


def template_copy():
    d = world(TEMPLATE, readme=TEMPLATE_README, license=USL)
    (d / "CITATION.cff").write_text('cff-version: 1.2.0\ntitle: "Ultrastable seed"\nrepository-code: "https://github.com/ultrastable/seed"\n')
    (d / "CHANGELOG.md").write_text("# Changelog\n\n## [Unreleased]\n\n- the kit's own history\n")
    return d


class Birth(unittest.TestCase):
    """IDENTITY-AT-BIRTH-1: a copy of the template takes its own identity once, and a copy that still claims the template is drift."""

    def test_adopt_writes_the_identity_once_and_is_idempotent(self):
        d = template_copy()
        wrote = S.adopt(d, "ada/tool-library", name="Tool Library", summary="Lends tools to neighbours and keeps track of who has what, every day.")
        self.assertTrue({"ultrastable.json", "README.md", "CITATION.cff", "CHANGELOG.md", "llms.txt", "codemeta.json"} <= set(wrote), wrote)
        i = S.identity(d)
        self.assertEqual((i["name"], i["repo"], i["layer"], i["parent"], i["license"], i["status"]),
                         ("Tool Library", "ada/tool-library", "seeded-system", "ultrastable/ultrastable", "LicenseRef-Test-1.0", "planned"))
        r = (d / "README.md").read_text()
        self.assertTrue(r.startswith("# Tool Library\n"))
        self.assertNotIn("example:start", r)
        self.assertIn("The seed's own words.", r)
        self.assertNotIn("ultrastable/seed", (d / "CITATION.cff").read_text())
        self.assertNotIn("the kit's own history", (d / "CHANGELOG.md").read_text())
        self.assertIn("# Tool Library", (d / "llms.txt").read_text())
        self.assertEqual(S.check(d), [])
        self.assertEqual(S.adopt(d, "ada/tool-library", name="Tool Library"), [], "a second adoption changes nothing")
        m = json.loads((d / "ultrastable.json").read_text()); m["identity"]["summary"] = "The owner's own words about this system, kept through every later adoption."
        (d / "ultrastable.json").write_text(json.dumps(m))
        S.render(d)
        self.assertIn("ultrastable.json", S.adopt(d, "ada/tool-library", public_url="https://tools.example"))
        i = S.identity(d)
        self.assertEqual((i["summary"][:15], i["public_url"], i["status"]), ("The owner's own", "https://tools.example", "live"))

    def test_a_name_taken_from_the_repository_gives_way_to_the_owners(self):
        d = template_copy()
        S.adopt(d, "ada/tool-library")
        self.assertEqual(S.identity(d)["name"], "tool-library")
        self.assertTrue((d / "README.md").read_text().startswith("# tool-library\n"))
        S.adopt(d, "ada/tool-library", name="Tool Library", summary="Lends tools to neighbours and keeps track of who has what.")
        self.assertEqual((S.identity(d)["name"], S.identity(d)["summary"][:5]), ("Tool Library", "Lends"))
        self.assertTrue((d / "README.md").read_text().startswith("# Tool Library\n"))
        S.adopt(d, "ada/tool-library", name="Another Name")
        self.assertEqual(S.identity(d)["name"], "Tool Library", "a name the owner gave is never replaced")

    def test_a_copy_that_still_claims_the_template_is_drift(self):
        d = template_copy()
        S.render(d)
        (d / "IDEA.md").write_text((SEED / "tests/fixtures/IDEA.example.md").read_text())
        self.assertEqual(S.birth(d), [], "the template's own example idea sits beside the template identity")
        (d / "IDEA.md").write_text("---\norg_name: Tool Library\n---\n# Idea\n\nLends tools.\n")
        self.assertTrue(any("still names the template" in e for e in S.check(d)))
        S.adopt(d, "ada/tool-library", name="Tool Library")
        self.assertEqual(S.check(d), [])

    def test_the_repository_is_read_not_guessed(self):
        d = template_copy()
        self.assertEqual(S.own_repo(d, env={})[0], None)
        self.assertEqual(S.own_repo(d, env={"GITHUB_REPOSITORY": "ada/x"})[0], None, "a GITHUB_REPOSITORY for another checkout is never taken")
        self.assertEqual(S.own_repo(d, env={"GITHUB_REPOSITORY": "ada/x", "GITHUB_WORKSPACE": str(d)}), ("ada/x", "GITHUB_REPOSITORY"))
        (d / "IDEA.md").write_text("---\norg_name: X\nrepo: ada/from-idea\n---\n")
        self.assertEqual(S.own_repo(d, env={}), ("ada/from-idea", "IDEA.md"))
        (d / "IDEA.md").unlink()
        git = lambda *a, cwd=d: subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True, check=True)  # noqa: E731
        git("init", "-q")
        git("remote", "add", "origin", "https://github.com/ada/from-remote.git")
        self.assertEqual(S.own_repo(d, env={}), ("ada/from-remote", "git remote origin"))
        (d / "sub").mkdir()
        self.assertEqual(S.own_repo(d / "sub", env={})[0], None, "a folder inside another repository is not that repository")
        with self.assertRaises(ValueError):
            S.adopt(d, "not-a-repo")
        before = (d / "README.md").read_text()
        m = json.loads((d / "ultrastable.json").read_text()); m["identity"]["loop"] = "x" * 401  # kept by adopt, and longer than the schema allows
        (d / "ultrastable.json").write_text(json.dumps(m))
        with self.assertRaises(S.Unrenderable):
            S.adopt(d, "ada/x")
        self.assertEqual(((d / "README.md").read_text(), S.identity(d)["repo"]), (before, "ultrastable/seed"), "nothing is written when the manifest would not be valid")
        m["identity"]["loop"] = "A short loop."
        (d / "ultrastable.json").write_text(json.dumps(m))
        self.assertEqual(S.main(["--adopt", "--root", str(d), "--repo", "ultrastable/seed"]), 0)
        self.assertEqual(S.identity(d)["repo"], "ultrastable/seed", "the template itself keeps the template identity")


if __name__ == "__main__":
    unittest.main()

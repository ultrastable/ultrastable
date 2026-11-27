# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REPO-CONFORM-2: every conformance file is read by a named validator against its standard, a rendered file equals its render, and an
unreadable repository or file is unmeasured, never ok."""
import contextlib
import http.client
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
SCRIPT = KIT / "scripts" / "repoconform.py"
sys.path.insert(0, str(KIT / "scripts"))
import repoconform as rc  # noqa: E402

JUNK = {"AGENTS.md": "#", "llms.txt": "# ", "LICENSE": "SPDX-License-Identifier:", "REUSE.toml": "SPDX-License-Identifier = [", "README.md": "#",
        "SECURITY.md": "#", "CONTRIBUTING.md": "we do not use Conventional Commits", "CHANGELOG.md": "## [Unreleased]\n## [banana]\n## [banana]\n### Stuff\n",
        "CITATION.cff": "cff-version:", "publiccode.yml": "publiccodeYmlVersion", "catalog-info.yaml": "apiVersion: backstage.io/",
        "ultrastable.json": '"identity" {{{', ".editorconfig": "root = false", ".github/dependabot.yml": "# version: 2 is not set",
        ".devcontainer/devcontainer.json": "{ nope"}
PUBLICCODE_T = """publiccodeYmlVersion: "0"
name: Demo
url: "https://github.com/o/demo"
platforms: [web]
developmentStatus: stable
softwareType: standalone/web
legal:
  license: MIT
maintenance:
  type: internal
  contacts:
    - name: "A Person"
localisation:
  localisationReady: false
  availableLanguages:
    - en
description:
  en:
    shortDescription: "A demo system."
    longDescription: >
      %s
    features:
      - "Reads its own health"
"""
PUBLICCODE = PUBLICCODE_T % ("A long description that wraps over lines. " * 5)


def repo(files: dict) -> Path:
    d = Path(tempfile.mkdtemp())
    for k, v in files.items():
        (d / k).parent.mkdir(parents=True, exist_ok=True)
        (d / k).write_text(v, encoding="utf-8")
    return d


def check(validator: str, text: str, root=None, row=None):
    return rc.VALIDATORS[validator](root or repo({}), text, row or {})


class RepoConform(unittest.TestCase):
    def test_seed_conforms(self):
        r = subprocess.run([sys.executable, str(SCRIPT), "--check", str(KIT)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_empty_repo_fails(self):
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, str(SCRIPT), "--check", d], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertIn("AGENTS.md fail: missing", r.stdout)

    def test_junk_repo_fails_every_row(self):
        rows = {r["path"]: r for r in rc.read(repo(JUNK))}
        self.assertEqual([p for p in JUNK if rows[p]["ok"]], [])
        for path, why in {"AGENTS.md": "not an H1", "llms.txt": "not an H1", "LICENSE": "no SPDX-License-Identifier", "REUSE.toml": "not valid TOML",
                          "CONTRIBUTING.md": "no H1", "CHANGELOG.md": "'## [banana]' is not", "CITATION.cff": 'not "1.2.0"',
                          "publiccode.yml": "not one YAML mapping", "catalog-info.yaml": "kind is missing", "ultrastable.json": "not valid JSON",
                          ".editorconfig": "root = true", ".github/dependabot.yml": "not one YAML mapping", ".devcontainer/devcontainer.json": "JSON with comments"}.items():
            self.assertIn(why, rows[path]["why"], path)
        self.assertEqual(rows["(rendered surfaces)"]["state"], "unmeasured")

    def test_every_row_names_a_validator_the_schema_allows(self):
        enum = json.loads((KIT / "autonomy/schemas/repo-conformance.schema.json").read_text())["properties"]["files"]["items"]["properties"]["validator"]["enum"]
        self.assertEqual(set(enum), set(rc.VALIDATORS))
        self.assertTrue(all(f["validator"] in rc.VALIDATORS for f in rc.rules()["files"]))

    def test_catalog_apiversion_quoted_or_not_passes_and_every_document_is_read(self):
        ent = '---\napiVersion: {}\nkind: Component\nmetadata:\n  name: demo.web_1\nspec:\n  type: service\n'
        self.assertEqual(check("catalog_info", "# generated\n" + ent.format('"backstage.io/v1alpha1"') + ent.format("backstage.io/v1beta1")), [])
        bad = check("catalog_info", ent.format("backstage.io/v1alpha1") + "---\napiVersion: v1\nkind: Pod\nmetadata:\n  name: -x\n")
        self.assertEqual(len(bad), 3, bad)

    def test_licenseref_needs_its_license_file(self):
        lic, reuse = "SPDX-License-Identifier: LicenseRef-X-1.0\n", 'version = 1\n[[annotations]]\npath = ["**"]\nSPDX-License-Identifier = "LicenseRef-X-1.0 OR (MIT WITH Classpath-exception-2.0)"\n'
        root = repo({})
        self.assertIn("no LICENSES/LicenseRef-X-1.0", check("license", lic, root)[0])
        self.assertEqual(len(check("reuse_toml", reuse, root)), 3)
        root = repo({"LICENSES/LicenseRef-X-1.0.txt": "text", "LICENSES/MIT.txt": "text", "LICENSES/Classpath-exception-2.0.txt": "text"})
        self.assertEqual(check("license", lic, root) + check("reuse_toml", reuse, root), [])
        self.assertIn("version is not the integer 1", check("reuse_toml", reuse.replace("version = 1", "version = true"), root)[0])

    def test_cff_licenseref_belongs_in_license_url(self):
        base = 'cff-version: 1.2.0\nmessage: "Cite it."\ntitle: "Demo"\nauthors:\n  - name: "Demo org"\n'
        self.assertIn("goes in license-url", check("cff", base + 'license: "LicenseRef-X-1.0"\n')[0])
        self.assertEqual(check("cff", base + "license-url: https://github.com/o/demo/blob/main/LICENSE\n"), [])
        self.assertEqual(check("cff", base + "license:\n  - Apache-2.0\n  - MIT\n"), [])

    def test_publiccode_follows_the_v0_mandatory_keys(self):
        self.assertEqual(check("publiccode", PUBLICCODE), [])
        bad = check("publiccode", PUBLICCODE.replace('"0"', '"0.4"').replace("  contacts:\n    - name: \"A Person\"\n", ""))
        self.assertTrue(any("reference parser" in b for b in bad) and any("maintenance.contacts" in b for b in bad), bad)
        self.assertTrue(any("longDescription" in b for b in check("publiccode", PUBLICCODE_T % "Too short.")))

    def test_agents_md_commands_resolve_and_the_chain_stays_small(self):
        root = repo({"scripts/ok.py": "", "worker/package.json": '{"scripts": {"test": "node t.js"}}', "foundation/__main__.py": "", "foundation/x.py": ""})
        good = "# Agents\n\n## Build and test\n\n- `python3 scripts/ok.py --check`\n- `cd worker && npm test`\n- `python3 -m foundation x --check`\n- `python3 -m unittest discover tests`\n"
        self.assertEqual(check("agents_md", good, root), [])
        bad = check("agents_md", "---\nx: 1\n---\n" + good.replace("ok.py", "gone.py").replace("npm test", "npm run nope").replace("foundation x", "foundation y"), root)
        self.assertEqual(len(bad), 5, bad)
        self.assertIn("commands section", check("agents_md", "# Agents\n\nNothing to run.\n", root)[0])
        self.assertIn("byte-order mark", check("agents_md", "\ufeff" + good, root)[0])
        self.assertEqual(check("agents_md", "# T\n\n## This repository\n\n- Test: read the profile.\n", root), [])
        (root / "AGENTS.md").write_text("x" * 20000)
        (root / "sub").mkdir()
        (root / "sub/AGENTS.md").write_text("y" * 20000)
        (root / "agents").mkdir()
        (root / "agents/AGENTS.md").write_text("z" * 150000)
        row = {"options": {"max_chain_bytes": 32768, "chain_exempt_dirs": ["agents"]}}
        self.assertEqual([b for b in check("agents_md", good, root, row) if "add up to" in b], ["the AGENTS.md files from the root to sub add up to 40000 bytes, over the 32768 a coding agent reads"])

    def test_structural_validators_accept_valid_files(self):
        self.assertEqual(check("devcontainer", '{\n // a comment\n "image": "mcr.microsoft.com/devcontainers/python:3", /* x */\n "features": {},\n}\n'), [])
        self.assertIn("exactly one", check("devcontainer", '{"image": "a", "build": {"dockerfile": "D"}}')[0])
        self.assertEqual(check("editorconfig", "root = TRUE\n\n[*]\nindent_style = Space\ncharset = unset\nmy_tool_key = anything\n[*.py]\nindent_size = 4\n"), [])
        self.assertIn("indent_style = tabs", check("editorconfig", "root = true\n[*]\nindent_style = tabs\n")[0])
        log = "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-11-20\n### Added\n- x\n\n## [1.0.0-rc.1] - 2026-11-10 [YANKED]\n\n## [0.9.0] - 2026-11-01\n"
        self.assertEqual(check("changelog", log), [])
        self.assertIn("not older than", check("changelog", log.replace("0.9.0", "1.1.0"))[0])
        self.assertEqual(check("llms_txt", "# Demo\n\n> What it is.\n\nAny prose.\n\n- a plain list\n\n## Docs\n\n- [Site](https://demo.example): the site\n"), [])
        self.assertIn("not in the repository", check("llms_txt", "# Demo\n\n> What it is.\n\n## Docs\n\n- [Gone](gone.md)\n")[0])
        self.assertEqual(check("security", "# Security\n\nReport privately to security@example.org.\n"), [])

    def test_llms_txt_links_resolve_in_the_repository_and_site_paths_are_left_to_the_site(self):
        root, head = repo({"README.md": "# R\n\nbody\n"}), "# Demo\n\n> What it is.\n\n## Docs\n\n"
        self.assertEqual(check("llms_txt", head + "- [Health](/health): the last tick\n- [Readme](README.md#top)\n- [Abs](/etc/passwd)\n", root), [])
        self.assertIn("docs/gone.md", check("llms_txt", head + "- [Gone](docs/gone.md#a)\n", root)[0])

    def test_contributing_needs_the_link_or_an_example_and_changelog_one_unreleased(self):
        self.assertIn("does not link Conventional Commits 1.0.0", check("contributing", "# Contributing\n\nWe do not use Conventional Commits.\n")[0])
        self.assertEqual(check("contributing", "# Contributing\n\nSee https://www.conventionalcommits.org/en/v1.0.0/.\n"), [])
        self.assertEqual(check("contributing", "# Contributing\n\nTitles look like `fix(worker): retry merge on 502`.\n"), [])
        self.assertIn('a second "## [Unreleased]"', check("changelog", "# Changelog\n\n## [Unreleased]\n\n## [Unreleased]\n")[0])

    def test_dependabot_covers_every_manifest_with_directories_and_skips_vendor(self):
        yml = "version: 2\nupdates:\n  - package-ecosystem: npm\n    directories:\n      - \"/packages/*\"\n    schedule: {interval: weekly}\n"
        root = repo({".github/dependabot.yml": yml, "packages/a/package.json": "{}", "vendor/ultrastable/package.json": "{}", "py/pyproject.toml": ""})
        self.assertEqual(check("dependabot", yml, root), ["no entry for pip at /py"])

    def test_yaml_reader_takes_block_scalars_and_nested_items(self):
        doc = rc.yaml_docs("a: |\n  one\n  # kept\nb:\n- x: 1\n  y: [2, 'three']\n- plain text\nc: \"q # not a comment\" # a comment\n")[0]
        self.assertEqual(doc, {"a": "one\n# kept\n", "b": [{"x": 1, "y": [2, "three"]}, "plain text"], "c": "q # not a comment"})
        with self.assertRaises(rc.YamlError):
            rc.yaml_docs("a: 1\na: 2\n")
        with self.assertRaises(rc.Unmeasured):
            rc.yaml_docs("a: &anchor 1\n")

    def test_generated_files_must_equal_their_render(self):
        if not (KIT / "ultrastable.json").is_file():
            self.skipTest("the kit carries no manifest")
        d = Path(tempfile.mkdtemp())
        for f in ("ultrastable.json", "LICENSE", "README.md", "CITATION.cff"):
            if (KIT / f).is_file():
                (d / f).write_text((KIT / f).read_text())
        (d / "standards").mkdir()
        (d / "standards/system.schema.json").write_text((KIT / "standards/system.schema.json").read_text())
        rows = {r["path"]: r for r in rc.read(d)}
        self.assertTrue(any(r["validator"] == "render" for r in rows.values()), rows)
        (d / "publiccode.yml").write_text("hand typed\n")
        self.assertIn("differs from what ultrastable.json renders", rc.read(d, only="publiccode.yml")[0]["why"])

    def test_one_rendered_file_is_unmeasured_when_the_manifest_cannot_render(self):
        d = repo({"publiccode.yml": PUBLICCODE, "ultrastable.json": "{ not json"})
        self.assertEqual(check("publiccode", PUBLICCODE, d), [])
        [row] = rc.read(d, only="publiccode.yml")
        self.assertEqual((row["state"], row["ok"]), ("unmeasured", False), row)
        self.assertEqual([(r["path"], r["state"]) for r in rc.read(d, only="codemeta.json")], [("codemeta.json", "unmeasured")])
        self.assertEqual([r["path"] for r in rc.read(d, only="SECURITY.md")], ["SECURITY.md"])


class Remote(unittest.TestCase):
    def fake(self, files: dict, fail=()):
        def get(url, raw=False):
            if url.endswith("/repos/o/r"):
                return b'{"default_branch": "main"}'
            if "/git/trees/" in url:
                return json.dumps({"tree": [{"path": p, "type": "blob"} for p in files]}).encode()
            p = url.split("/contents/", 1)[1].split("?", 1)[0]
            if p in fail:
                raise OSError("HTTP 403")
            return files[p].encode()
        return get

    def test_unreadable_repository_and_file_are_unmeasured(self):
        def deny(url, raw=False):
            raise OSError("HTTP 404")
        self.assertEqual(rc.remote("o/private", deny)["state"], "unmeasured")
        res = rc.remote("o/r", self.fake({"SECURITY.md": "# Security\n\nsecurity@example.org\n", "README.md": "# R\n\nbody\n"}, fail={"SECURITY.md"}))
        rows = {r["path"]: r for r in res["files"]}
        self.assertEqual((rows["SECURITY.md"]["state"], rows["README.md"]["state"], rows["AGENTS.md"]["why"]), ("unmeasured", "ok", "missing"))
        self.assertFalse(res["ok"])

    def test_fleet_reads_every_live_row_and_skips_retired_ones(self):
        m = repo({"fleet.json": json.dumps({"repos": {"o/r": {"state": "live"}, "o/old": {"state": "retired"}}})})
        res = {r["repo"]: r for r in rc.fleet(m / "fleet.json", self.fake(JUNK))}
        self.assertEqual((res["o/r"]["state"], res["o/old"]["state"]), ("fail", "skipped"))

    def test_remote_read_of_the_kit_equals_the_local_read(self):
        """Every file the renderer writes is fetched in a remote read, so no rendered path is compared as an empty placeholder."""
        tree = []
        for d, dirs, names in os.walk(KIT):
            dirs[:] = [x for x in dirs if x not in {".git", "node_modules", "__pycache__"}]
            tree += [(Path(d) / n).relative_to(KIT).as_posix() for n in names]

        def get(url, raw=False):
            if url.endswith("/repos/o/kit"):
                return b'{"default_branch": "main"}'
            if "/git/trees/" in url:
                return json.dumps({"tree": [{"path": p, "type": "blob"} for p in tree]}).encode()
            return (KIT / rc.urllib.parse.unquote(url.split("/contents/", 1)[1].split("?", 1)[0])).read_bytes()
        local = {r["path"]: (r["state"], r["why"]) for r in rc.read(KIT)}
        res = rc.remote("o/kit", get)
        self.assertEqual({r["path"]: (r["state"], r["why"]) for r in res["files"]}, local)
        if (KIT / "codemeta.json").is_file():
            self.assertIn("codemeta.json", local)

    def test_a_truncated_response_is_unmeasured_and_the_fleet_reads_on(self):
        files = {"SECURITY.md": "# Security\n\nsecurity@example.org\n", "README.md": "# R\n\nbody\n"}
        base = self.fake(files)

        def cut(url, raw=False):
            if url.endswith("/contents/SECURITY.md?ref=main"):
                raise http.client.IncompleteRead(b"# Sec", 40)
            return base(url, raw)
        self.assertEqual({r["path"]: r for r in rc.remote("o/r", cut)["files"]}["SECURITY.md"]["state"], "unmeasured")

        def broken(url, raw=False):
            if "/repos/o/bad" in url:
                raise RuntimeError("the checker tripped")
            return base(url.replace("/repos/o/ok", "/repos/o/r"), raw)
        m = repo({"fleet.json": json.dumps({"repos": {"o/bad": {"state": "live"}, "o/ok": {"state": "live"}}})})
        res = {r["repo"]: r for r in rc.fleet(m / "fleet.json", broken)}
        self.assertEqual(res["o/bad"]["state"], "unmeasured")
        self.assertIn("RuntimeError", res["o/bad"]["why"])
        self.assertEqual(res["o/ok"]["state"], "fail")

    def run_fleet(self, files):
        m = repo({"fleet.json": json.dumps({"repos": {"o/r": {"state": "live"}, "o/old": {"state": "retired"}}})})
        out, real = io.StringIO(), rc._get
        rc._get = self.fake(files)
        try:
            with contextlib.redirect_stdout(out):
                code = rc.main(["x", "--fleet", str(m / "fleet.json")])
        finally:
            rc._get = real
        return code, out.getvalue().strip().splitlines()

    def test_fleet_summary_is_the_last_line_and_moves_with_the_fleet(self):
        code, lines = self.run_fleet(JUNK)
        self.assertEqual(code, 1)
        self.assertLess(lines.index("repoconform: o/old skipped: retired in the fleet map; nothing runs from it"), lines.index("repoconform: o/r fail"))
        self.assertTrue(lines[-1].startswith("repoconform: fleet 0/1 repositories conform; o/r 0/"), lines[-1])
        self.assertIn("SECURITY.md", lines[-1])
        _, fixed = self.run_fleet({**JUNK, "SECURITY.md": "# Security\n\nReport privately to security@example.org.\n"})
        self.assertNotEqual(fixed[-1], lines[-1])
        self.assertIn("o/r 1/", fixed[-1])
        self.assertNotIn("SECURITY.md", fixed[-1])


if __name__ == "__main__":
    unittest.main()

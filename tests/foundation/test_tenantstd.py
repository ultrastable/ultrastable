# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TENANT-STANDARD-1: one standard for a tenant repository, one scaffold that writes it, one check that reads it; the README says where it runs."""
import json, shutil, subprocess, sys, unittest
from pathlib import Path
from foundation import tenantstd as T
from _repo import scratch

REPO = Path(__file__).resolve().parents[2]
STD = json.loads((REPO / T.STD_CORE).read_text())


def planned(slug="base-rates"):
    """A new tenant's repository as tenant-repos.yml makes it: the split of its manifest folder, then the scaffold."""
    d = scratch()
    for f in (REPO / "instances" / slug).iterdir():
        shutil.copy(f, d / f.name)
    T.scaffold(d, slug, REPO, STD)
    return d


class Core(unittest.TestCase):
    def test_the_registry_and_the_scaffold_meet_the_standard(self):
        self.assertEqual(T.check_core(REPO, STD), [])

    def test_a_tenant_without_the_base_files_or_with_typed_files_fails(self):
        d = scratch()
        for f in [T.STD_CORE, T.REG, "LICENSE"] + list(STD["vendor"]["base"]):
            (d / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / f, d / f)
        shutil.copytree(REPO / STD["scaffold"]["dir"], d / STD["scaffold"]["dir"])
        reg = json.loads((d / T.REG).read_text())
        reg["tenants"] = {"x": {"repo": "ultrastable/x", "state": "planned", "vendor": {"seed/worker/src/contract.js": "worker/vendor/contract.js"}, "write": {"AGENTS.md": "typed"}}}
        (d / T.REG).write_text(json.dumps(reg))
        bad = T.check_core(d, STD)
        self.assertTrue(any("does not carry foundation/tenantstd.py" in b for b in bad), bad)
        self.assertTrue(any("outside vendor/ultrastable/" in b for b in bad))
        self.assertTrue(any("hand-typed `write`" in b for b in bad))
        (d / STD["scaffold"]["dir"] / "worker/index.js.tmpl").unlink()
        self.assertTrue(any("no template" in b for b in T.check_core(d, STD)))

    def test_every_workflow_template_passes_the_same_lint(self):
        for f in STD["scaffold"]["files"]:
            if f["path"].startswith(".github/workflows/"):
                self.assertEqual(T.lint_workflow((REPO / STD["scaffold"]["dir"] / (f["path"] + ".tmpl")).read_text(), STD), [], f["path"])
        self.assertTrue(any("not pinned" in b for b in T.lint_workflow("# budget: x\n# trigger: x\n# free-alternative: x\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n", STD)))


class Scaffold(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = planned()

    def test_a_scaffolded_tenant_meets_the_standard_with_the_core_tool_and_its_own_vendored_copy(self):
        self.assertEqual(T.check_tenant(self.d, STD, REPO), [])
        r = subprocess.run([sys.executable, "vendor/ultrastable/tools/tenantstd.py", "--check", "--tenant", "."], cwd=self.d, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_its_generated_worker_tests_pass(self):
        r = subprocess.run("node --test --no-warnings worker/*.test.mjs", shell=True, cwd=self.d, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-1000:])
        self.assertIn("# fail 0", r.stdout)

    def test_no_placeholder_is_left_and_a_second_run_changes_nothing(self):
        for p in self.d.rglob("*"):
            if p.is_file() and "vendor" not in p.parts:
                self.assertIsNone(T.PLACE.search(p.read_text()), p)
        self.assertEqual(T.scaffold(self.d, "base-rates", REPO, STD), [])

    def test_a_planned_tenant_says_not_deployed_and_links_no_host(self):
        readme = (self.d / "README.md").read_text()
        block = T.BLOCKS["live"].search(readme).group(0)
        self.assertIn("Not deployed yet", block)
        self.assertNotIn("base-rates.ultrastable.org", readme)
        self.assertIn("https://ultrastable.io", block)
        self.assertEqual(block, T.live_block("base-rates", REPO))  # the one format: foundation/livelinks.py
        (self.d / "README.md").write_text(readme.replace("Not deployed yet.", "Not deployed yet. See https://base-rates.ultrastable.org/"))
        self.assertTrue(any("dead link" in b for b in T.check_tenant(self.d, STD, REPO)))
        (self.d / "README.md").write_text(readme)

    def test_each_declared_cadence_reaches_the_worker(self):
        for slug, hours in (("did-it-work", 24), ("open-questions", 168)):
            d = planned(slug)
            self.assertIn(f"export const BEAT_HOURS = {hours};", (d / "worker/contract.js").read_text())
            self.assertEqual(T.check_tenant(d, STD, REPO), [])


class LiveBlock(unittest.TestCase):
    def test_a_deployed_tenant_links_its_url_from_the_registry_and_a_wrong_or_missing_url_fails(self):
        self.assertEqual(T.deployment("unlearn", REPO), (True, "https://unlearn.ultrastable.org"))
        self.assertEqual(T.deployment("base-rates", REPO), (False, ""))
        d = scratch()
        (d / "instance.json").write_text(json.dumps({"slug": "unlearn", "name": "Unlearn"}))
        block, ident = T.live_block("unlearn", REPO), T.identity("unlearn", d, STD, REPO)
        self.assertEqual(ident["public_url"], "https://unlearn.ultrastable.org")
        self.assertEqual(ident["runs_as"]["worker"], "ultrastable-unlearn")
        for need in ("(https://unlearn.ultrastable.org/)", "`ultrastable-unlearn`", "https://unlearn.ultrastable.org/health", "https://unlearn.ultrastable.org/claims.json", "https://ultrastable.io/directory"):
            self.assertIn(need, block)
        (d / "README.md").write_text("# Unlearn\n\n" + block + "\n")
        self.assertEqual(T.live_problems(d, "unlearn", STD, REPO, ident), [])
        self.assertEqual(T.live_problems(d, "unlearn", STD, None, ident), [], "the tenant-side reading, with no registries")
        (d / "README.md").write_text("# Unlearn\n\n" + block.replace("unlearn.ultrastable.org", "unlearn.example.org") + "\n")
        self.assertTrue(any("the registry says unlearn runs at https://unlearn.ultrastable.org" in b for b in T.live_problems(d, "unlearn", STD, REPO)))
        self.assertTrue(any("ultrastable.json says public_url is https://unlearn.ultrastable.org" in b for b in T.live_problems(d, "unlearn", STD, None, ident)))
        (d / "README.md").write_text("# Unlearn\n\nNo block.\n")
        self.assertTrue(any("no Live block" in b for b in T.live_problems(d, "unlearn", STD, REPO)))

    def test_one_identity_object_is_the_scaffolds_input_and_every_file_reads_it(self):
        d = planned()
        ident = json.loads((d / "ultrastable.json").read_text())["identity"]
        self.assertEqual(sorted(ident), sorted(STD["identity"]["keys"] + ["planned_url", "layer"]))
        self.assertIsNone(ident["public_url"])
        self.assertEqual(json.loads((d / "package.json").read_text())["description"], ident["summary"])
        self.assertIn('import MANIFEST from "../ultrastable.json"', (d / "worker/contract.js").read_text())
        self.assertIn(f'"name": "{ident["runs_as"]["worker"]}"', (d / "wrangler.jsonc").read_text())
        e = scratch()
        for f in (REPO / "instances/base-rates").iterdir():
            shutil.copy(f, e / f.name)
        T.scaffold(e, "base-rates", REPO, STD, {**ident, "name": "Renamed Rates", "summary": "A different summary for the test."})
        self.assertIn("# Renamed Rates", (e / "README.md").read_text())
        self.assertEqual(json.loads((e / "package.json").read_text())["description"], "A different summary for the test.")
        self.assertTrue(any("differs from what the registries say" in b for b in T.check_tenant(e, STD, REPO)))
        ident2 = json.loads((d / "ultrastable.json").read_text()); ident2["identity"]["slug"] = "other"
        (d / "ultrastable.json").write_text(json.dumps(ident2))
        self.assertTrue(any("says slug 'other'" in b for b in T.check_tenant(d, STD, None)))

    def test_the_block_goes_under_the_title_and_the_tenants_own_words_are_kept(self):
        d = planned()
        (d / "README.md").write_text("# Mine\n\nMy own words.\n")
        (d / "AGENTS.md").write_text("# Mine\n\n- my rule\n")
        T.scaffold(d, "base-rates", REPO, STD)
        readme = (d / "README.md").read_text()
        self.assertTrue(readme.startswith("# Mine\n\n<!-- live:start"))
        self.assertIn("My own words.", readme)
        self.assertIn("- my rule", (d / "AGENTS.md").read_text())
        self.assertIn(STD["bootstrap_url"], (d / "AGENTS.md").read_text())


class Reading(unittest.TestCase):
    def test_what_the_check_catches(self):
        d = planned()
        (d / "vendor/ultrastable/contract.js").write_text((d / "vendor/ultrastable/contract.js").read_text() + "// edited\n")
        (d / "worker/vendor").mkdir()
        (d / "LICENSE").unlink()
        (d / "AGENTS.md").write_text((d / "AGENTS.md").read_text() + "<<<<<<< HEAD\n")
        pkg = json.loads((d / "package.json").read_text()); pkg["dependencies"] = {"x": "1"}
        (d / "package.json").write_text(json.dumps(pkg))
        rw = json.loads((d / "runway.json").read_text()); rw["risks"][0]["probe"] = "test:a test nobody wrote"
        (d / "runway.json").write_text(json.dumps(rw))
        wf = d / ".github/workflows/extra.yml"
        wf.write_text("name: extra\non: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@v4\n")
        bad = "\n".join(T.check_tenant(d, STD, REPO))
        for need in ("edited by hand", "second vendor directory", "license: LICENSE is missing", "unresolved merge marker", "has dependencies", "names a test that is not in worker", "workflow extra.yml: no `# budget:`", "not pinned to a full commit sha"):
            self.assertIn(need, bad)

    def test_live_reads_each_registered_repository_and_an_unreadable_one_fails(self):
        good = planned()
        def clone(repo, dest):
            if repo.endswith("/base-rates"):
                shutil.copytree(good, dest)
                return True
            return False
        res = T.live(REPO, STD, clone)
        self.assertEqual(res["base-rates"], [])
        self.assertIn("could not be read", res["unlearn"][0])
        self.assertNotIn("practical-solutions", res)  # exempt with a reason, measured not enforced


if __name__ == "__main__":
    unittest.main()

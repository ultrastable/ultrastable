# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TENANT-STANDARD-1: one standard for a tenant repository, one scaffold that writes it, one check that reads it; the README says where it runs."""
import json, shutil, subprocess, sys, unittest
from pathlib import Path
from foundation import tenantstd as T
from _repo import scratch

REPO = Path(__file__).resolve().parents[2]
STD = json.loads((REPO / T.STD_CORE).read_text())


PLANNED = "did-it-work"  # a tenant the registry holds as planned (nothing deployed), so the fixture does not move when another tenant goes live


def planned(slug=PLANNED):
    """A new tenant's repository as tenant-repos.yml makes it: the split of its manifest folder, then the scaffold."""
    d = scratch()
    for f in (REPO / "instances" / slug).iterdir():
        shutil.copy(f, d / f.name)
    T.scaffold(d, slug, REPO, STD)
    return d


def core_copy(registry=None):
    """A scratch core holding the files check_core reads (the standard, the registry, every source it or a tenant's vendor map names, the
    scaffold and the queue items the exceptions name), so a test can change the registry without touching the repository."""
    d = scratch()
    reg = json.loads((REPO / T.REG).read_text())
    if registry:
        registry(reg)
    srcs = {T.STD_CORE, "LICENSE", STD["conformance"]["register"], *STD["vendor"]["base"], *STD["scaffold"]["copy"], *STD["scaffold"]["copy_if_missing"]}
    srcs |= {src for t in reg["tenants"].values() for src in (t.get("vendor") or {}) if (REPO / src).is_file()}
    srcs |= {f"{T.ISSUES}{e['item']}.json" for v in STD["exceptions"].values() if isinstance(v, (dict, list)) for e in (v if isinstance(v, list) else [v])
             if isinstance(e, dict) and e.get("item") and (REPO / T.ISSUES / f"{e['item']}.json").is_file()}
    for f in srcs:
        (d / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / f, d / f)
    shutil.copytree(REPO / STD["scaffold"]["dir"], d / STD["scaffold"]["dir"])
    (d / T.ISSUES).mkdir(parents=True, exist_ok=True)
    (d / T.REG).write_text(json.dumps(reg))
    return d


class Core(unittest.TestCase):
    def test_the_registry_and_the_scaffold_meet_the_standard(self):
        self.assertEqual(T.check_core(REPO, STD), [])

    def test_tests_that_npm_test_never_runs_fail(self):
        d = planned()
        (d / "github").mkdir(exist_ok=True)
        (d / "github/x.test.mjs").write_text("")
        pk = json.loads((d / "package.json").read_text())
        pk.setdefault("scripts", {})["test"] = "node --test worker/*.test.mjs"
        (d / "package.json").write_text(json.dumps(pk))
        self.assertTrue(any("TEST-COVERAGE-1" in b for b in T.check_tenant(d, STD, REPO)))
        pk["scripts"]["test"] += " github/*.test.mjs"
        (d / "package.json").write_text(json.dumps(pk))
        self.assertFalse(any("TEST-COVERAGE-1" in b for b in T.check_tenant(d, STD, REPO)))

    def test_an_exception_whose_item_is_not_in_the_queue_fails(self):
        std = json.loads(json.dumps(STD))
        std["exceptions"] = {"_doc": "x", "base-rates": {"conformance": "pending", "until": "9999-12-31", "item": "Q-NOWHERE-base-rates",
                                                         "why": "a reason that is long enough to read as one, forty characters"}}
        d = core_copy()
        self.assertTrue(any("names Q-NOWHERE-base-rates, which is not a queue item" in b for b in T.check_core(d, std)))
        (d / T.ISSUES / "Q-NOWHERE-base-rates.json").write_text(json.dumps({"id": "Q-NOWHERE-base-rates"}))
        self.assertFalse(any("Q-NOWHERE-base-rates" in b for b in T.check_core(d, std)))

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
        self.assertEqual(T.scaffold(self.d, PLANNED, REPO, STD), [])

    def test_a_planned_tenant_says_not_deployed_and_links_no_host(self):
        readme = (self.d / "README.md").read_text()
        block = T.BLOCKS["live"].search(readme).group(0)
        self.assertIn("Not deployed yet", block)
        self.assertNotIn(f"{PLANNED}.ultrastable.org", readme)
        self.assertIn("https://ultrastable.io", block)
        self.assertEqual(block, T.live_block(PLANNED, REPO))  # the one format: foundation/livelinks.py
        (self.d / "README.md").write_text(readme.replace("Not deployed yet.", f"Not deployed yet. See https://{PLANNED}.ultrastable.org/"))
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
        self.assertEqual(T.deployment(PLANNED, REPO), (False, ""))
        d = scratch()
        (d / "instance.json").write_text(json.dumps({"slug": "unlearn", "name": "Unlearn"}))
        block, ident = T.live_block("unlearn", REPO), T.identity("unlearn", d, STD, REPO)
        self.assertEqual(ident["public_url"], "https://unlearn.ultrastable.org")
        self.assertEqual(ident["runs_as"][0]["name"], "ultrastable-unlearn")
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
        self.assertEqual(sorted(ident), sorted(STD["identity"]["keys"] + ["layer", "parent", "visibility", "visibility_reason", "status", "loop"]))
        self.assertTrue(ident["loop"].startswith("A daily beat searches open evaluation and trial registries"), ident["loop"])  # IDEA.md's `- Loop:` line
        self.assertIsNone(ident["public_url"]); self.assertEqual(ident["runs_as"], []); self.assertEqual(ident["status"], "planned")
        self.assertEqual(json.loads((d / "package.json").read_text())["description"], ident["summary"])
        self.assertIn('import MANIFEST from "../ultrastable.json"', (d / "worker/contract.js").read_text())
        self.assertIn(f'"name": "ultrastable-{PLANNED}"', (d / "wrangler.jsonc").read_text())
        e = scratch()
        for f in (REPO / "instances" / PLANNED).iterdir():
            shutil.copy(f, e / f.name)
        T.scaffold(e, PLANNED, REPO, STD, {**ident, "name": "Renamed Rates", "summary": "A different summary for the test."})
        self.assertIn("# Renamed Rates", (e / "README.md").read_text())
        self.assertEqual(json.loads((e / "package.json").read_text())["description"], "A different summary for the test.")
        self.assertEqual(T.scaffold(e, PLANNED, REPO, STD), [], "the identity the repository carries is the input of the next run")
        bad_id = {**ident, "public_url": "https://x.example.org", "runs_as": [{"provider": "github", "kind": "pages", "name": PLANNED}, {"provider": "cloudflare", "kind": "worker", "name": "other-worker"}]}
        (e / "ultrastable.json").write_text(json.dumps({"identity": bad_id}))
        got = "\n".join(T.check_tenant(e, STD, REPO))
        self.assertIn("the registries say not deployed", got); self.assertIn("runs_as names other-worker", got)  # the Worker entry, not the Pages one listed first
        ident2 = json.loads((d / "ultrastable.json").read_text()); ident2["identity"]["slug"] = "other"
        (d / "ultrastable.json").write_text(json.dumps(ident2))
        self.assertTrue(any("says slug 'other'" in b for b in T.check_tenant(d, STD, None)))

    def test_the_block_goes_under_the_title_and_the_tenants_own_words_are_kept(self):
        d = planned()
        (d / "README.md").write_text("# Mine\n\nMy own words.\n")
        (d / "AGENTS.md").write_text("# Mine\n\n- my rule\n")
        T.scaffold(d, PLANNED, REPO, STD)
        readme = (d / "README.md").read_text()
        self.assertTrue(readme.startswith("# Mine\n\n<!-- identity:start"))  # title, the one-line identity, then the Live block (surfaces.py layout)
        self.assertRegex(readme, r"^# Mine\n\n<!-- identity:start[^\n]*\n[^\n]*\n<!-- identity:end -->\n\n<!-- live:start")
        self.assertIn("My own words.", readme)
        self.assertIn("- my rule", (d / "AGENTS.md").read_text())
        self.assertIn(STD["bootstrap_url"], (d / "AGENTS.md").read_text())


BASE_RATES_OLD = {"identity": {  # ultrastable/base-rates' ultrastable.json as it stands, in the older tenant-standard shape
    "name": "Base Rates", "slug": "base-rates",
    "summary": "Before you decide, see what usually happens: graded base rates for life, work and policy choices, and your own forecasting record.",
    "repo": "ultrastable/base-rates", "public_url": "https://base-rates.ultrastable.org", "planned_url": "https://base-rates.ultrastable.org",
    "license": "LicenseRef-Ultrastable-USL-1.0", "topics": ["autonomous-system", "github-actions", "github-pages", "ultrastable"], "layer": "tenant",
    "runs_as": {"platform": "github", "worker": None, "deployed": True, "deployed_from": "main", "deployed_by": "ultrastable/base-rates loop.yml (GitHub Actions to GitHub Pages)"}}}
DID_IT_WORK_OLD = {"identity": {**BASE_RATES_OLD["identity"], "name": "Did It Work?", "slug": "did-it-work", "repo": "ultrastable/did-it-work", "public_url": None,
                                "runs_as": {"platform": "cloudflare-workers", "worker": "ultrastable-did-it-work", "deployed": False}}}  # nothing deployed
UNLEARN_OLD = {"identity": {**BASE_RATES_OLD["identity"], "name": "Unlearn", "slug": "unlearn", "repo": "ultrastable/unlearn", "public_url": "https://unlearn.ultrastable.org",
                            "runs_as": {"platform": "cloudflare-workers", "worker": "ultrastable-unlearn", "deployed": True}}}
KIT = T._module(REPO / "seed/scripts/surfaces.py", "test_tenantstd_surfaces")


without_exception = lambda slug: {**STD, "exceptions": {k: v for k, v in STD["exceptions"].items() if k != slug}}  # noqa: E731


class Normalize(unittest.TestCase):
    """The older tenant-standard manifests become schema-valid; where they run comes from doctrine/topology.json, not from the old object."""

    def test_a_real_tenant_manifest_is_rewritten_valid_and_a_second_run_changes_nothing(self):
        d = scratch()
        (d / "ultrastable.json").write_text(json.dumps(BASE_RATES_OLD, indent=1))
        self.assertTrue(KIT.check_manifest(d), "the older shape fails the schema")
        with __import__("contextlib").redirect_stdout(__import__("io").StringIO()) as out:
            self.assertEqual(T.main(["--normalize", str(d)]), 0)
        self.assertIn("rewritten in the schema's shape", out.getvalue())
        self.assertEqual(KIT.check_manifest(d), [])
        i = json.loads((d / "ultrastable.json").read_text())["identity"]
        self.assertNotIn("planned_url", i)
        self.assertEqual([(r["provider"], r["kind"], r["name"]) for r in i["runs_as"]], [("cloudflare", "worker", "ultrastable-base-rates"), ("github", "pages", "base-rates")])
        self.assertEqual(i["runs_as"][0]["routes"], ["base-rates.ultrastable.org"])  # doctrine/topology.json's live route, the Pages one is the second
        self.assertEqual((i["public_url"], i["status"], i["visibility"]), ("https://base-rates.ultrastable.org", "live", "public"))
        self.assertEqual([i[k] for k in ("name", "summary", "topics")], [BASE_RATES_OLD["identity"][k] for k in ("name", "summary", "topics")])
        before = (d / "ultrastable.json").read_text()
        self.assertFalse(T.normalize_file(d, REPO))
        self.assertEqual((d / "ultrastable.json").read_text(), before)

    def test_nothing_deployed_is_planned_and_a_manifest_in_shape_is_left_alone(self):
        topo, rstd = json.loads((REPO / "doctrine/topology.json").read_text()), json.loads((REPO / "github/repo-standard.json").read_text())
        i = T.normalize_identity(DID_IT_WORK_OLD["identity"], topo, rstd)
        self.assertEqual((i["runs_as"], i["status"], i["public_url"]), ([], "planned", None))
        self.assertEqual(KIT.validate({"identity": i}, KIT.schema(REPO / "seed")), [])
        shaped = {**i, "runs_as": [{"provider": "cloudflare", "kind": "worker", "name": "ultrastable-x"}]}
        self.assertEqual(T.normalize_identity(shaped, topo, rstd), shaped)
        ops = T.normalize_identity({**DID_IT_WORK_OLD["identity"], "repo": "ultrastable/ops"}, topo, rstd)
        self.assertEqual((ops["visibility"], ops["visibility_reason"]), ("private", rstd["visibility"]["private"]["ops"]))  # github/repo-standard.json

    def test_with_no_registry_a_tenants_own_copy_keeps_the_manifests_statement(self):
        i = T.normalize_identity(UNLEARN_OLD["identity"])
        self.assertEqual([(r["provider"], r["name"]) for r in i["runs_as"]], [("cloudflare", "ultrastable-unlearn")])
        self.assertEqual((i["public_url"], i["status"]), ("https://unlearn.ultrastable.org", "live"))

    def test_the_scaffold_puts_an_older_manifest_in_shape_before_it_renders(self):
        d = scratch()
        for f in (REPO / "instances/unlearn").iterdir():
            if f.is_file():
                shutil.copy(f, d / f.name)
        (d / "ultrastable.json").write_text(json.dumps(UNLEARN_OLD))
        T.scaffold(d, "unlearn", REPO, STD)
        self.assertEqual(KIT.check_manifest(d), [])
        self.assertEqual(json.loads((d / "ultrastable.json").read_text())["identity"]["runs_as"][0]["routes"], ["unlearn.ultrastable.org"])
        bad = [b for b in T.check_tenant(d, without_exception("unlearn"), REPO) if b.split(":")[0] in ("conform", "live", "identity")]
        self.assertEqual(bad, [])  # every conformance file is in place, and its Live block is the one the registries render


    def test_a_second_run_reports_nothing_even_while_the_registries_and_the_manifest_disagree(self):
        d = scratch()  # base-rates: topology runs its Worker live while its registry row may still say planned (check_tenant names that)
        for f in (REPO / "instances/base-rates").iterdir():
            if f.is_file():
                shutil.copy(f, d / f.name)
        (d / "ultrastable.json").write_text(json.dumps(BASE_RATES_OLD))
        T.scaffold(d, "base-rates", REPO, STD)
        before = {p: p.read_bytes() for p in d.rglob("*") if p.is_file()}
        self.assertEqual(T.scaffold(d, "base-rates", REPO, STD), [])
        self.assertEqual({p: p.read_bytes() for p in d.rglob("*") if p.is_file()}, before)
        self.assertEqual(json.loads((d / "ultrastable.json").read_text())["identity"]["parent"], STD["core_repo"])


class Conformance(unittest.TestCase):
    """REPO-CONFORM-2 through the one register: the scaffold writes the full set, the check runs the register's reader, a dated exception holds."""

    @classmethod
    def setUpClass(cls):
        cls.d, cls.std = planned(), without_exception(PLANNED)

    def test_a_scaffolded_tenant_carries_and_passes_every_file_of_the_register(self):
        for f in json.loads((REPO / STD["conformance"]["register"]).read_text())["files"]:
            self.assertTrue((self.d / f["path"]).is_file(), f["path"])
        self.assertEqual(T.check_tenant(self.d, self.std, REPO), [])
        r = subprocess.run([sys.executable, "vendor/ultrastable/tools/repoconform.py", "--check", "."], cwd=self.d, capture_output=True, text=True,
                           env={**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertEqual(list(self.d.rglob("__pycache__")), [], "no bytecode is left in vendor/ for vendor-sync to commit")

    def test_a_missing_or_stale_file_fails_and_a_dated_exception_holds_it_and_says_so(self):
        d = planned()
        (d / "llms.txt").unlink()
        (d / "publiccode.yml").write_text((d / "publiccode.yml").read_text().replace("Did It Work?", "Typed By Hand"))
        bad = "\n".join(T.check_tenant(d, self.std, REPO))
        self.assertIn("conform: llms.txt fail: missing", bad)
        self.assertIn("conform: publiccode.yml fail:", bad)
        held, std = [], json.loads(json.dumps(STD))
        std["exceptions"][PLANNED]["until"] = "9999-12-31"
        self.assertEqual(T.check_tenant(d, std, REPO, held), [])
        self.assertTrue(any(h.startswith("conform: llms.txt") for h in held), held)
        self.assertTrue(T.pending(PLANNED, STD, "2026-12-11"))
        self.assertFalse(T.pending(PLANNED, STD, "2026-12-12"))
        self.assertEqual(T.render_surfaces(d, STD, REPO), ["publiccode.yml", "llms.txt"])
        self.assertEqual(T.check_tenant(d, self.std, REPO), [])

    def test_a_repository_without_the_reader_is_a_finding_never_a_pass(self):
        d = planned()
        shutil.rmtree(d / "vendor/ultrastable/tools")
        bad = "\n".join(T.check_tenant(d, self.std, None))
        self.assertIn("conform: vendor/ultrastable/tools/repoconform.py is not in the repository", bad)
        self.assertIn("VENDORED_FROM lists vendor/ultrastable/tools/surfaces.py, which is missing", bad)

    def test_the_core_side_fails_a_register_file_nothing_writes_and_an_unheld_vendor_map(self):
        std = json.loads(json.dumps(STD))
        std["scaffold"]["files"] = [f for f in std["scaffold"]["files"] if f["path"] != ".github/dependabot.yml"]
        self.assertTrue(any(".github/dependabot.yml is written by no part of the scaffold" in b for b in T.check_core(REPO, std)))
        def drop(reg):
            reg["tenants"]["did-it-work"]["vendor"].pop("seed/scripts/repoconform.py", None)
        bad = "\n".join(T.check_core(core_copy(drop), STD))  # no exception holds a vendor map: vendor_sync.mjs copies only what the map lists
        self.assertIn("did-it-work: vendor map in doctrine/tenant-repos.json does not carry seed/scripts/repoconform.py", bad)
        std = json.loads(json.dumps(STD)); std["exceptions"]["x"] = [{"until": "2026-12-11", "item": "Q-X", "why": "a reason that is long enough to read as one, forty characters"}]
        self.assertTrue(any("names no rule it departs from" in b for b in T.check_core(REPO, std)))


    def test_a_manifest_the_renderer_refuses_is_reported_and_nothing_is_rendered(self):
        d = planned()
        cfg = json.loads((d / "ultrastable.json").read_text()); cfg["identity"]["summary"] = "Too short."
        (d / "ultrastable.json").write_text(json.dumps(cfg))
        (d / "llms.txt").unlink()
        done = T.scaffold(d, PLANNED, REPO, STD)
        self.assertTrue(any(x.startswith("not rendered: tenantstd: surfaces.py renders nothing") and "summary" in x for x in done), done)
        self.assertFalse((d / "llms.txt").exists())
        with self.assertRaises(SystemExit) as e:
            T.main(["--render", str(d)])
        self.assertIn("shorter than 20 characters", str(e.exception))

    def test_a_tenants_rendered_surfaces_state_only_what_a_tenant_serves(self):
        """The starter Worker and the live tenants serve /health and /claims.json; none serves /live or reads an ignition stage."""
        readme, pc = (self.d / "README.md").read_text(), (self.d / "publiccode.yml").read_text()
        for false in ("/live", "ignition", "scripts/seedlife.py"):
            self.assertNotIn(false, readme)
        for false in ("Reads its own stage every tick", "Logs its criticality every tick"):
            self.assertNotIn(false, pc)
        self.assertIn("A daily beat searches open evaluation and trial registries", readme)  # the loop it closes, in IDEA.md's own words


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

    def test_a_dated_exception_holds_until_its_date_and_then_the_rule_fails_again(self):
        self.assertEqual(T.excepted("replication-ledger", STD, "2026-11-26"), {"worker/vendor/knowledge.js"})
        self.assertEqual(T.excepted("replication-ledger", STD, "2027-01-01"), set())
        self.assertEqual(T.excepted("unlearn", STD, "2026-11-26"), set())
        std = json.loads(json.dumps(STD)); std["exceptions"]["x"] = {"vendor_outside": ["a"], "why": "short"}
        self.assertTrue(any("exception for x needs" in b for b in T.check_core(REPO, std)))

    def test_live_reads_each_registered_repository_and_an_unreadable_one_fails(self):
        good = planned()
        def clone(repo, dest):
            if repo.endswith("/" + PLANNED):
                shutil.copytree(good, dest)
                return True
            return False
        res = T.live(REPO, STD, clone)
        self.assertEqual(res[PLANNED], [])
        self.assertIn("could not be read", res["unlearn"][0])
        self.assertNotIn("practical-solutions", res)  # exempt with a reason, measured not enforced


if __name__ == "__main__":
    unittest.main()

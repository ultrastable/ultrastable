# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLEET-MAP-1: the map names every repository, and a copy that differs from its source, or cannot be read, is never reported equal."""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from foundation import fleetmap as fm, upstream  # noqa: E402

os.environ["FLEETMAP_NO_FETCH"] = "1"  # tests never reach the network


def _git(d, *a):
    subprocess.run(["git", "-C", str(d), "-c", "user.name=t", "-c", "user.email=t@t", *a], check=True, capture_output=True)


class World(unittest.TestCase):
    """A small platform checkout with a seed/ folder, the registries --check reads, and clones of two copies beside it."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.core, self.clones = self.tmp / "ultrastable", self.tmp
        for rel, text in {"seed/worker/a.js": "one\n", "seed/agents/AGENTS.md": "rules\n", "seed/.github/workflows/platform-sync.yml": "name: p\n",
                          "agents/AGENTS.md": "rules\n", ".github/workflows/publish.yml": "name: x\n", "vendor/k.js": "k1\n"}.items():
            (self.core / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.core / rel).write_text(text)
        self.map = {"org": "o", "layers": {l: "x" for l in fm.LAYERS}, "session_repos": {"repos": ["o/ultrastable"]},
                    "template_contents": {"belongs": ["worker/", "agents/", ".github/"], "keep": ["NOTICE"], "never": ["admin/"]},
                    "repos": {
                        "o/ultrastable": {"purpose": "The platform.", "layer": "platform", "state": "live", "synced_from": [], "deploys": ["w"], "actions": True,
                                          "visibility": "public", "visibility_reason": "r", "instructions": {"file": "agents/AGENTS.md", "kind": "canonical"}},
                        "o/seed": {"purpose": "The template.", "layer": "template", "state": "live", "deploys": [], "actions": True, "visibility": "public", "visibility_reason": "r",
                                   "synced_from": [{"kind": "tree", "source_repo": "o/ultrastable", "source": "seed", "direction": "down", "workflow": ".github/workflows/publish.yml", "keep_from": "template_contents.keep"}],
                                   "instructions": {"file": "agents/AGENTS.md", "kind": "copy", "source": "seed/agents/AGENTS.md"}},
                        "o/app": {"purpose": "A tenant.", "layer": "tenant", "state": "live", "deploys": ["app"], "actions": True, "visibility": "public", "visibility_reason": "r",
                                  "synced_from": [{"kind": "vendor", "source_repo": "o/ultrastable", "source": "doctrine/tenant-repos.json", "map": "tenants.app.vendor", "direction": "down", "workflow": ".github/workflows/publish.yml"}],
                                  "instructions": {"file": "AGENTS.md", "kind": "pointer", "source": "agents/AGENTS.md"}}}}
        self._write("doctrine/tenant-repos.json", {"tenants": {"app": {"repo": "o/app", "vendor": {"vendor/k.js": "v/k.js"}}}, "visitor_apps": {"template": "o/seed"}})
        self._write("doctrine/seed-deploys.json", {"seeds": []})
        self._write("doctrine/full-stack.json", {"systems": {}})
        self._write("github/org-settings.json", {"repos": {"o/ultrastable": {}, "o/seed": {}}})
        self.save()
        shutil.copytree(self.core / "seed", self.tmp / "seed")
        (self.tmp / "app/v").mkdir(parents=True)
        (self.tmp / "app/v/k.js").write_text("k1\n")
        (self.tmp / "app/AGENTS.md").write_text("Rules: agents/AGENTS.md in ultrastable/ultrastable.\n")

    def _write(self, rel, data):
        (self.core / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.core / rel).write_text(json.dumps(data))

    def save(self):
        self._write(fm.MAP, self.map)

    def read(self, repo, fetch=None, clones="default"):
        return fm.drift_one(self.core, repo, self.map["repos"][repo], self.clones if clones == "default" else clones, fetch, self.map["template_contents"]["keep"])


class Check(World):
    def test_a_complete_map_passes(self):
        self.assertEqual(fm.check(self.core), [])

    def test_a_repository_a_registry_names_must_be_a_row_and_a_row_must_be_named(self):
        self._write("github/org-settings.json", {"repos": {"o/ultrastable": {}, "o/seed": {}, "o/new": {}}})
        self.assertTrue(any("o/new" in e and "no row" in e for e in fm.check(self.core)))
        self._write("github/org-settings.json", {"repos": {"o/ultrastable": {}, "o/seed": {}}})
        self.map["repos"]["o/ghost"] = dict(self.map["repos"]["o/ultrastable"])
        self.save()
        self.assertTrue(any("o/ghost" in e and "no registry names" in e for e in fm.check(self.core)))

    def test_a_seed_named_in_seed_deploys_must_be_a_row(self):
        self._write("doctrine/seed-deploys.json", {"seeds": ["second"]})
        self.assertTrue(any("o/second" in e for e in fm.check(self.core)))

    def test_synced_from_must_name_a_real_path_and_a_real_workflow(self):
        s = self.map["repos"]["o/seed"]["synced_from"][0]
        s["source"], s["workflow"] = "kernel", ".github/workflows/gone.yml"
        self.save()
        errs = fm.check(self.core)
        self.assertTrue(any("source kernel does not exist" in e for e in errs))
        self.assertTrue(any("workflow .github/workflows/gone.yml does not exist" in e for e in errs))

    def test_a_copy_layer_without_a_source_and_bad_fields_fail(self):
        r = self.map["repos"]["o/seed"]
        r["synced_from"], r["layer"], r["visibility_reason"] = [], "template", ""
        self.map["repos"]["o/app"]["layer"] = "misc"
        self.map["repos"]["o/app"]["instructions"] = {"file": None, "kind": "none"}
        self.save()
        errs = "\n".join(fm.check(self.core))
        for want in ("is a copy and must say what it is synced from", "visibility must be", "layer 'misc'", "kind none needs a reason"):
            self.assertIn(want, errs)

    def test_admin_material_and_undeclared_folders_in_seed_fail(self):
        (self.core / "seed/admin").mkdir()
        (self.core / "seed/notes").mkdir()
        errs = "\n".join(fm.check(self.core))
        self.assertIn("seed/admin/ is admin or platform material", errs)
        self.assertIn("seed/notes/ is not listed in template_contents.belongs", errs)


class Drift(World):
    def test_an_exact_copy_reads_equal_and_kept_files_are_not_extra(self):
        (self.tmp / "seed/NOTICE").write_text("n\n")
        r = self.read("o/seed")
        self.assertEqual((r["status"], r["how"]), ("equal", "clone"))
        self.assertEqual(self.read("o/app")["status"], "equal")

    def test_differ_missing_and_extra_are_counted(self):
        (self.tmp / "seed/worker/a.js").write_text("edited\n")
        (self.tmp / "seed/agents/AGENTS.md").unlink()
        (self.tmp / "seed/worker/only-here.js").write_text("x\n")
        r = self.read("o/seed")
        self.assertEqual(r["status"], "drifted")
        self.assertEqual((r["differ"], r["missing"], r["extra"]), (["worker/a.js"], ["agents/AGENTS.md"], ["worker/only-here.js"]))

    def test_a_stale_vendored_file_and_a_missing_pointer_are_drift(self):
        (self.core / "vendor/k.js").write_text("k2\n")
        (self.tmp / "app/AGENTS.md").write_text("Local rules only.\n")
        r = self.read("o/app")
        self.assertEqual(r["differ"], ["v/k.js"])
        self.assertTrue(any("does not point at the platform" in n for n in r["notes"]))
        (self.tmp / "app/AGENTS.md").unlink()
        self.assertIn("AGENTS.md", self.read("o/app")["missing"])

    def test_a_copy_that_cannot_be_read_is_unmeasured_never_equal(self):
        r = self.read("o/seed", fetch=lambda url: {"error": "HTTP 404"}, clones=self.tmp / "nowhere")
        self.assertEqual(r["status"], "unmeasured")
        r = self.read("o/seed", fetch=lambda url: {"tree": [], "truncated": True}, clones=None)
        self.assertEqual(r["status"], "unmeasured")

    def test_the_public_tree_is_compared_by_blob_id_without_a_clone(self):
        tree = [{"path": p, "type": "blob", "sha": s} for p, s in fm.local_tree(self.core / "seed").items()]
        self.assertEqual(self.read("o/seed", fetch=lambda url: {"tree": tree}, clones=None)["status"], "equal")
        tree[0]["sha"] = "0" * 40
        r = self.read("o/seed", fetch=lambda url: {"tree": tree}, clones=None)
        self.assertEqual((r["status"], r["how"], len(r["differ"])), ("drifted", "github", 1))

    def test_blob_sha_is_gits(self):
        self.assertEqual(fm.blob_sha(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a")

    def test_apply_files_one_item_and_the_same_reading_closes_it(self):
        (self.tmp / "seed/worker/a.js").write_text("edited\n")
        out = fm.apply(self.core, [self.read("o/seed"), self.read("o/app")], now="2026-11-25T00:00:00Z")
        self.assertEqual(out["filed"], ["Q-FLEETMAP-seed"])
        f = self.core / "docs/issues/Q-FLEETMAP-seed.json"
        body = json.loads(f.read_text())["body"]
        self.assertIn("**Status:** open", body)
        self.assertIn("cmd:python3 -m foundation fleetmap --probe seed", body)
        self.assertEqual(json.loads((self.core / fm.READING).read_text())["repos"]["o/seed"]["differ"], 1)
        self.assertEqual(fm.apply(self.core, [self.read("o/seed")])["filed"], [])  # the same reading files nothing twice
        (self.tmp / "seed/worker/a.js").write_text("one\n")
        self.assertEqual(fm.apply(self.core, [self.read("o/seed")])["closed"], ["Q-FLEETMAP-seed"])
        self.assertIn("**Status:** closed", f.read_text())

    def test_an_unmeasured_copy_gets_an_item_too(self):
        r = self.read("o/seed", fetch=lambda url: None, clones=None)
        self.assertEqual(fm.apply(self.core, [r])["filed"], ["Q-FLEETMAP-seed"])


class Publish(World):
    def setUp(self):
        super().setUp()
        _git(self.core, "init", "-q")
        _git(self.core, "add", "-A")
        _git(self.core, "commit", "-qm", "v1")
        (self.core / "seed/worker/a.js").write_text("two\n")
        (self.core / "seed/worker/b.js").write_text("new\n")
        _git(self.core, "add", "-A")
        _git(self.core, "commit", "-qm", "v2")
        self.mirror = self.tmp / "seed"

    def test_an_older_copy_is_replaced_and_a_missing_file_added(self):
        rep = fm.publish(self.core, self.mirror, "seed", ["NOTICE"], apply=True)
        self.assertEqual((rep["updated"], rep["added"], rep["conflicts"]), (["worker/a.js"], ["worker/b.js"], []))
        self.assertEqual((self.mirror / "worker/a.js").read_text(), "two\n")
        self.assertTrue((self.mirror / fm.STAMP).exists())
        self.assertEqual(self.read("o/seed")["status"], "equal")  # the stamp is not drift

    def test_work_done_in_the_copy_is_never_overwritten_or_deleted(self):
        (self.mirror / "worker/a.js").write_text("edited in the template\n")
        (self.mirror / "worker/only-here.js").write_text("x\n")
        rep = fm.publish(self.core, self.mirror, "seed", ["NOTICE"], apply=True)
        self.assertEqual((rep["conflicts"], rep["extra"]), (["worker/a.js"], ["worker/only-here.js"]))
        self.assertEqual((self.mirror / "worker/a.js").read_text(), "edited in the template\n")
        self.assertTrue((self.mirror / "worker/only-here.js").exists())

    def test_what_the_last_publish_wrote_is_replaced_by_the_next(self):
        fm.publish(self.core, self.mirror, "seed", [], apply=True)
        (self.core / "seed/worker/a.js").write_text("three\n")  # not committed: only the stamp can vouch for the mirror's copy
        rep = fm.publish(self.core, self.mirror, "seed", [], apply=True)
        self.assertEqual((rep["updated"], rep["conflicts"]), (["worker/a.js"], []))

    def test_a_dry_run_changes_nothing(self):
        fm.publish(self.core, self.mirror, "seed", [], apply=False)
        self.assertEqual((self.mirror / "worker/a.js").read_text(), "one\n")
        self.assertFalse((self.mirror / fm.STAMP).exists())


class KernelSyncWithoutALock(unittest.TestCase):
    """A system filled by a plain copy of seed/ has no lock; the sync must still replace kernel files it never edited (second-tenant, 2026-11-25)."""

    def test_an_older_core_version_is_not_a_local_edit(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        core, inst = tmp / "core", tmp / "inst"
        for rel, text in {"seed/agents/AGENTS.md": "v1\n", "seed/worker/x.js": "v1\n"}.items():
            (core / rel).parent.mkdir(parents=True, exist_ok=True)
            (core / rel).write_text(text)
        (core / upstream.CONTRACT).write_text(json.dumps({"repo": "o/core", "version": "0.1.0", "kernel_root": "seed"}))
        _git(core, "init", "-q"); _git(core, "add", "-A"); _git(core, "commit", "-qm", "v1")
        shutil.copytree(core / "seed", inst)
        (inst / "worker/x.js").write_text("edited here\n")
        (core / "seed/agents/AGENTS.md").write_text("v2\n")
        (core / "seed/worker/x.js").write_text("v2\n")
        _git(core, "add", "-A"); _git(core, "commit", "-qm", "v2")
        rep = upstream.sync(core, inst, apply=True)
        self.assertEqual((rep["updated"], rep["conflicts"]), (["agents/AGENTS.md"], ["worker/x.js"]))
        self.assertEqual((inst / "agents/AGENTS.md").read_text(), "v2\n")
        self.assertEqual((inst / "worker/x.js").read_text(), "edited here\n")
        self.assertTrue((inst / upstream.LOCK).exists())


class RealMap(unittest.TestCase):
    def test_the_repository_map_passes_and_covers_the_layers(self):
        self.assertEqual(fm.check(REPO), [])
        m = fm.load(REPO)
        self.assertEqual({r["layer"] for r in m["repos"].values()}, set(fm.LAYERS))
        self.assertEqual(m["repos"]["ultrastable/seed"]["synced_from"][0]["source"], "seed")

    def test_the_rule_is_wired(self):
        self.assertIn("fleetmap --check", (REPO / ".github/workflows/checks.yml").read_text())
        self.assertIn("fleetmap --drift --apply", (REPO / ".github/workflows/tenant-sync.yml").read_text())
        self.assertIn("fleetmap --publish", (REPO / ".github/workflows/template-publish.yml").read_text())
        self.assertIn("upstream sync --instance", (REPO / ".github/workflows/tenant-repos.yml").read_text())

    def test_instruction_text_points_at_the_platform(self):
        t = fm.instructions_text(REPO, "ultrastable/ops")
        self.assertTrue(all(p in t for p in fm.POINTER))


if __name__ == "__main__":
    unittest.main()

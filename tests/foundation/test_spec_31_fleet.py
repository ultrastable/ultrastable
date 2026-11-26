# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-31, the fleet: the repository standard and its measurement, branch cleanup, the fleet map and its drift, the one manifest and its surfaces, live links,
the full stack, the public directory list, the cold-start contract, boot acceptance and spinoffs. Each test names the requirement it proves."""
import copy, datetime as dt, importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest import mock

from foundation import bootaccept, bootproof, coldstart, discover, fleetmap, fullstack, livelinks, publication, repostd, spinoff, surfaces
from _repo import scratch

ROOT = Path(__file__).resolve().parents[2]
STD = repostd.standard(ROOT)


def tmp(test):
    d = tempfile.TemporaryDirectory()
    test.addCleanup(d.cleanup)
    return Path(d.name)


def put(root, rel, data):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(data if isinstance(data, str) else json.dumps(data, indent=1) + "\n", encoding="utf-8")


def load_tool(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class RepositoryStandard(unittest.TestCase):
    def test_US_31_R26_the_standard_is_squash_only_with_auto_merge_and_branch_deletion_and_the_worker_carries_the_same_json(self):
        w = STD["worker"]
        self.assertEqual([w["settings"][k] for k in ("allow_squash_merge", "allow_merge_commit", "allow_rebase_merge", "allow_auto_merge", "delete_branch_on_merge")], [True, False, False, True, True])
        self.assertEqual({r["type"] for r in w["ruleset"]["rules"]}, {"deletion", "non_fast_forward"})
        self.assertEqual(repostd.worker_block(ROOT), w, "the Worker applies byte for byte the block of github/repo-standard.json")
        self.assertEqual(repostd.check(ROOT), [])
        self.assertEqual(STD["files"], ["README.md", "LICENSE", "AGENTS.md", "SECURITY.md"])
        self.assertEqual(STD["workflows"], [".github/workflows/branch-cleanup.yml"])

    def test_US_31_R31_description_homepage_and_topics_are_computed_in_one_place_from_the_registries_and_a_private_repository_needs_a_written_reason(self):
        md = lambda name, reg: repostd.repo_metadata(name, reg, ROOT, STD)
        new = md("new-thing", {})
        self.assertEqual((new["description"], new["homepage"], new["private"]), ("New Thing: a system running on Ultrastable.", "https://ultrastable.io", False))
        self.assertEqual(new["topics"], sorted(STD["metadata"]["topics"]["system"]))
        row = {"kind": "system", "description": "X does useful things for people and keeps going.", "frontend": "https://x.example", "route": "https://r.example/"}
        self.assertEqual((md("x", {"x": row})["description"], md("x", {"x": row})["homepage"]), (row["description"], "https://x.example"))
        self.assertEqual(md("x", {"x": {"route": "https://r.example/"}})["homepage"], "https://r.example/")
        over = md("x", {"x": {**row, "override": {"description": "An override that wins over the tenant row.", "homepage": "https://o.example", "topics": ["zeta", "alpha"]}}})
        self.assertEqual((over["description"], over["homepage"], over["topics"]), ("An override that wins over the tenant row.", "https://o.example", ["alpha", "zeta"]))
        self.assertEqual(md("p", {"p": {"kind": "platform"}})["topics"], sorted(STD["metadata"]["topics"]["platform"]))
        self.assertEqual(len(md("x", {"x": {"description": "d" * 500}})["description"]), 350)
        ops = md("ops", {})
        self.assertTrue(ops["private"] and len(ops["private_reason"]) >= 20)
        want = repostd.desired("x", {"x": {"override": {"settings": {"private": True, "has_wiki": True}}}}, ROOT, STD)
        self.assertNotIn("private", want["settings"])
        self.assertTrue(want["settings"]["has_wiki"])
        self.assertEqual(repostd.desired("seed", {}, ROOT, STD)["make_public"], True)
        self.assertEqual((repostd.desired("ops", {}, ROOT, STD)["workflows"], repostd.desired("ultrastable", {}, ROOT, STD)["workflows"]), ([], []))
        self.assertEqual(repostd.desired("x", {}, ROOT, STD)["workflows"], [".github/workflows/branch-cleanup.yml"])

    def test_US_31_R32_an_override_may_not_weaken_the_merge_rules_or_make_a_repository_private_without_a_reason(self):
        regs = {"x": {"kind": "system", "override": {"settings": {"allow_merge_commit": True, "allow_rebase_merge": True, "delete_branch_on_merge": False, "allow_auto_merge": False, "private": True}}},
                "y": {"kind": "system", "override": {"settings": {"private": False}}}, "ops": {"kind": "platform", "override": {"settings": {"private": False}}}}
        with mock.patch.object(repostd, "registries", return_value=regs):
            errs = "\n".join(repostd.check(ROOT))
        for want in ("x: an override may not turn allow_merge_commit on", "x: an override may not turn allow_rebase_merge on", "x: an override may not turn delete_branch_on_merge off",
                     "x: an override may not turn allow_auto_merge off", "x: github/org-settings.json says private but github/repo-standard.json gives no reason (visibility.private)",
                     "ops: github/org-settings.json says public but github/repo-standard.json lists it private"):
            self.assertIn(want, errs)

    def api(self, **over):
        want = repostd.desired("x", {"x": {"kind": "system"}}, ROOT, STD)
        live = {"description": want["description"], "homepage": want["homepage"], "topics": want["topics"], "private": False, "archived": False, "default_branch": "main", **want["settings"],
                "security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}, **over.get("live", {})}
        answers = {"workflows": (200, {"workflows": [{"path": ".github/workflows/branch-cleanup.yml"}]}), "rulesets": (200, [{"enforcement": "active"}]), "branch": (200, {"protected": True}), **over.get("answers", {})}
        missing = set(over.get("missing", ()))
        def api(method, path):
            if path == "/repos/ultrastable/x":
                return over.get("repo", (200, live))
            if "/actions/workflows" in path:
                return answers["workflows"]
            if path.endswith("/rulesets"):
                return answers["rulesets"]
            if "/branches/" in path:
                return answers["branch"]
            if path.startswith("/repos/ultrastable/.github/contents/"):
                return (200, {}) if "org-default" not in missing else (404, {})
            name = path.rsplit("/contents/", 1)[1]
            return (404, {}) if name in missing else (200, {})
        return api, want

    def test_US_31_R33_a_live_repository_is_read_against_the_standard_and_what_cannot_be_read_is_unmeasured_never_ok(self):
        api, want = self.api()
        ok = repostd.measure(api, "x", want, STD)
        self.assertEqual((ok["findings"], ok["unmeasured"], ok["gated"], ok["status"]), ([], [], [], "measured"))
        api, want = self.api(live={"private": True}, answers={"workflows": (200, {"workflows": [{"path": ".github/workflows/a.yml"}]})})
        priv = repostd.measure(api, "x", want, STD)
        self.assertTrue(any("private with 1 workflow(s): Actions minutes are billed" in f for f in priv["findings"]))
        self.assertIn("private, and the standard gives no reason for it", priv["findings"])
        self.assertEqual(sorted(priv["gated"]), ["allow_auto_merge", "ruleset", "security"], "what the plan withholds is said, not failed")
        api, want = self.api(live={"description": "", "allow_merge_commit": True}, missing=["LICENSE"])
        bad = "\n".join(repostd.measure(api, "x", want, STD)["findings"])
        for text in ("description is empty", "setting allow_merge_commit is true, standard false", "LICENSE is missing"):
            self.assertIn(text, bad)
        api, want = self.api(answers={"rulesets": (403, {}), "branch": (403, {})})
        blind = repostd.measure(api, "x", want, STD)
        self.assertEqual((blind["findings"], blind["status"]), ([], "partly-unmeasured"))
        self.assertIn("main protection: rulesets HTTP 403, branch HTTP 403", blind["unmeasured"])
        api, want = self.api(answers={"rulesets": (200, []), "branch": (200, {"protected": False})})
        self.assertIn("main is not protected (no active ruleset, no branch protection)", repostd.measure(api, "x", want, STD)["findings"])
        api, want = self.api(repo=(404, {"message": "Not Found"}))
        gone = repostd.measure(api, "x", want, STD)
        self.assertEqual(gone["status"], "unmeasured")
        self.assertIn("absent, or private and not visible to this credential", gone["unmeasured"][0])
        api, want = self.api(live={"archived": True})
        self.assertEqual(repostd.measure(api, "x", want, STD)["status"], "archived")
        api, want = self.api(missing=["SECURITY.md", "org-default"])
        api2 = lambda m, p: (404, {}) if p.endswith("/contents/SECURITY.md") or "/.github/contents/" in p else api(m, p)
        self.assertIn("SECURITY.md is missing", repostd.measure(api2, "x", want, STD)["findings"], "the org default file is read before a file is called missing")

    def test_US_31_R34_a_branch_with_no_open_pull_request_is_merged_closed_or_unmerged_work(self):
        prs = lambda *states: [{"state": s, "merged_at": "t" if s == "merged" else None, "head": {"sha": h}} for s, h in states]
        self.assertEqual(repostd.classify("t1", []), "unmerged-work")
        self.assertEqual(repostd.classify("t1", prs(("open", "t1"))), "open")
        self.assertEqual(repostd.classify("t1", prs(("merged", "t1"))), "merged")
        self.assertEqual(repostd.classify("t1", [{"state": "closed", "merged_at": None, "head": {"sha": "t1"}}]), "closed")
        self.assertEqual(repostd.classify("later", prs(("merged", "t1"))), "unmerged-work", "commits pushed after the last pull request are unmerged work")

    def cleanup(self, branches, prs, meta=None, dates=None):
        bc = load_tool("branch_cleanup_spec31", "seed/scripts/branch_cleanup.py")
        calls = []
        base = {"default_branch": "main", "private": False, "delete_branch_on_merge": True, "allow_auto_merge": True}
        def gh(*args, method="GET", fields=None, paginate=False):
            path = args[0]
            calls.append((method, path, fields))
            if path == "repos/ultrastable/x":
                return {**base, **(meta or {})}
            if "/branches?" in path:
                return branches
            if "/pulls?" in path:
                return prs.get(path.split("head=ultrastable:")[1], [])
            if "/commits/" in path:
                return {"commit": {"committer": {"date": (dates or {})[path.rsplit("/", 1)[1]]}}}
            return None
        return bc, gh, calls

    def test_US_31_R34_branch_cleanup_deletes_what_is_finished_archives_unmerged_work_first_and_never_touches_main_ledgers_protected_or_open_branches(self):
        br = lambda n, sha, **k: {"name": n, "commit": {"sha": sha}, **k}
        branches = [br("main", "s0"), br("done", "s1"), br("openpr", "s2"), br("draft", "s3"), br("fresh", "s4"), br("loops-evidence", "s5"), br("moved", "s7"), br("prot", "s8", protected=True)]
        prs = {"done": [{"state": "closed", "merged_at": "t", "number": 1, "head": {"sha": "s1"}}], "openpr": [{"state": "open", "number": 2, "head": {"sha": "s2"}}],
               "moved": [{"state": "closed", "merged_at": "t", "number": 3, "head": {"sha": "s6"}}]}
        old, new = "2020-01-01T00:00:00Z", dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        dates = {"s3": old, "s4": new, "s7": old}
        bc, gh, calls = self.cleanup(branches, prs, dates=dates)
        with mock.patch.object(bc, "gh", gh), mock.patch.object(bc, "repos", lambda: ["x"]), mock.patch("builtins.print"):
            self.assertEqual(bc.run(False, 6), 1, "stale branches fail the check")
            self.assertTrue(all(c[0] == "GET" for c in calls), "a check writes nothing")
            calls.clear()
            self.assertEqual(bc.run(True, 6), 0)
        writes = [(m, p, f) for m, p, f in calls if m != "GET"]
        self.assertEqual([w for w in writes if w[0] == "POST"], [("POST", "repos/ultrastable/x/git/refs", {"ref": "refs/archive/draft", "sha": "s3"}), ("POST", "repos/ultrastable/x/git/refs", {"ref": "refs/archive/moved", "sha": "s7"})])
        self.assertEqual(sorted(p.rsplit("/", 1)[1] for m, p, f in writes if m == "DELETE"), ["done", "draft", "moved"])
        self.assertFalse(any(("fresh" in p or "openpr" in p or "evidence" in p or "prot" in p or p.endswith("heads/main")) for m, p, f in writes), "main, ledgers, protected, open and young branches stay")

    def test_US_31_R34_branch_cleanup_puts_the_two_settings_back_and_leaves_auto_merge_to_the_plan_on_a_private_repository(self):
        bc, gh, calls = self.cleanup([{"name": "main", "commit": {"sha": "s0"}}], {}, meta={"delete_branch_on_merge": False, "allow_auto_merge": False})
        with mock.patch.object(bc, "gh", gh), mock.patch.object(bc, "repos", lambda: ["x"]), mock.patch("builtins.print"):
            bc.run(True, 6)
        self.assertIn(("PATCH", "repos/ultrastable/x", {"delete_branch_on_merge": True, "allow_auto_merge": True}), calls)
        bc, gh, calls = self.cleanup([{"name": "main", "commit": {"sha": "s0"}}], {}, meta={"private": True, "delete_branch_on_merge": True, "allow_auto_merge": False})
        with mock.patch.object(bc, "gh", gh), mock.patch.object(bc, "repos", lambda: ["x"]), mock.patch("builtins.print"):
            self.assertEqual(bc.run(False, 6), 0, "a private repository is not drift for lacking auto-merge")
        self.assertEqual(bc.REPO_SETTINGS, {"delete_branch_on_merge": True, "allow_auto_merge": True})
        self.assertEqual((ROOT / "seed/scripts/branch_cleanup.py").read_bytes(), (ROOT / "scripts/branch_cleanup.py").read_bytes())

    def test_US_31_R61_a_public_repository_keeps_its_license_a_clean_tree_and_no_private_data(self):
        self.assertEqual(publication.case_collisions(["LICENSE", "license/a.md", "src/x.js"]), [["LICENSE", "license"]])
        self.assertEqual(publication.case_collisions(["a/B.md", "a/b.md"]), [["a/B.md", "a/b.md"]])
        self.assertEqual(publication.case_collisions(["a/b.md", "c/d.md"]), [])
        pol = publication.load(ROOT)
        d = tmp(self)
        put(d, "good.js", f"// {pol['spdx']}\nconst a = 1;\n")
        put(d, "bad.js", "const b = 2;\n")
        put(d, "notes.md", "no header needed\n")
        self.assertEqual(publication.missing_headers(d, ["good.js", "bad.js", "notes.md", "gone.js"], pol), ["bad.js"])
        self.assertEqual(sorted(pol["source_suffixes"]), [".js", ".mjs", ".py", ".sh", ".ts"])
        self.assertEqual(publication.private_hits("nothing private here", pol), [])
        self.assertEqual(set(pol["required_files"]), {"LICENSE", "NOTICE", "COMMERCIAL-TERMS.md", "CITATION.cff", "SECURITY.md"})


class FleetMapAndManifest(unittest.TestCase):
    def test_US_31_R38_every_repository_a_registry_names_is_one_row_with_a_layer_visibility_and_instruction_file_and_a_copy_names_its_source(self):
        self.assertEqual(fleetmap.check(ROOT), [])
        m = fleetmap.load(ROOT)
        self.assertEqual(set(m["layers"]), set(fleetmap.LAYERS))
        self.assertTrue(set(m["identity"]["files"]) <= set(__import__("foundation.upstream", fromlist=["x"]).OWNED), "the kernel sync never overwrites an identity file")
        bad = copy.deepcopy(m)
        bad["repos"]["ultrastable/seed"]["layer"] = "bogus"
        bad["repos"]["ultrastable/ops"]["visibility_reason"] = ""
        bad["repos"]["ultrastable/.github"]["instructions"] = {"kind": "none", "file": None}
        bad["repos"]["ultrastable/second-tenant"]["synced_from"] = []
        with mock.patch.object(fleetmap, "load", return_value=bad):
            errs = "\n".join(fleetmap.check(ROOT))
        for want in ("ultrastable/seed: layer 'bogus' is not one of", "ultrastable/ops: visibility must be public or private, with a reason",
                     "ultrastable/.github: instructions kind none needs a reason", "ultrastable/second-tenant: a seeded-system is a copy and must say what it is synced from"):
            self.assertIn(want, errs)
        extra = {**fleetmap.named_repos(ROOT), "ultrastable/new-one": ["github/org-settings.json"]}
        with mock.patch.object(fleetmap, "named_repos", return_value=extra):
            self.assertTrue(any("ultrastable/new-one: named in github/org-settings.json and has no row" in e for e in fleetmap.check(ROOT)))

    def world(self):
        d = tmp(self)
        put(d, "seed/a.txt", "A\n")
        put(d, "seed/ultrastable.json", "{}\n")
        row = {"synced_from": [{"kind": "tree", "source_repo": "o/p", "source": "seed", "direction": "down", "workflow": "w.yml", "keep": ["keepme"]}], "instructions": {"kind": "none"}}
        return d, row

    def tree(self, files=None, **extra):
        files = {"a.txt": "A\n", "ultrastable.json": "{}\n", **(files or {})}
        return lambda url: {"tree": [{"path": p, "type": "blob", "sha": fleetmap.blob_sha(c.encode())} for p, c in files.items() if c is not None], **extra}

    def test_US_31_R39_a_copy_is_read_against_its_source_as_equal_drifted_or_unmeasured_and_a_copy_that_cannot_be_read_is_never_equal(self):
        d, row = self.world()
        read = lambda fetch: fleetmap.drift_one(d, "o/p", row, None, fetch)
        self.assertEqual(read(self.tree())["status"], "equal")
        self.assertEqual((read(self.tree())["how"]), "github")
        r = read(self.tree({"a.txt": "edited\n", "extra.txt": "x\n", "keepme": "mine\n"}))
        self.assertEqual((r["status"], r["differ"], r["extra"]), ("drifted", ["a.txt"], ["extra.txt"]))
        self.assertEqual(read(self.tree({"a.txt": None}))["missing"], ["a.txt"])
        no_manifest = read(self.tree({"ultrastable.json": None}))
        self.assertEqual((no_manifest["status"], no_manifest["missing"]), ("drifted", ["ultrastable.json"]))
        self.assertTrue(any("no ultrastable.json manifest" in n for n in no_manifest["notes"]))
        self.assertEqual(read(lambda url: {"error": "HTTP 404"})["status"], "unmeasured")
        self.assertEqual(read(self.tree(truncated=True))["status"], "unmeasured")
        self.assertEqual(fleetmap.drift_one(d, "o/ultrastable", {"instructions": {"kind": "canonical"}}, None, None)["status"], "not-a-copy")

    def test_US_31_R39_each_copy_that_is_not_equal_is_one_item_the_same_reading_closes_it_and_a_new_timestamp_alone_is_not_a_change(self):
        d, row = self.world()
        drifted = fleetmap.drift_one(d, "o/p", row, None, self.tree({"extra.txt": "x\n"}))
        it = fleetmap.item(drifted)
        self.assertEqual(it["id"], "Q-FLEETMAP-p")
        self.assertIn("**Closing probe:** cmd:python3 -m foundation fleetmap --probe p", it["body"])
        self.assertEqual(fleetmap.apply(d, [drifted], now="T1")["filed"], ["Q-FLEETMAP-p"])
        self.assertEqual(fleetmap.apply(d, [drifted], now="T2")["filed"], [], "the same finding is not filed twice")
        self.assertEqual(json.loads((d / fleetmap.READING).read_text())["at"], "T1")
        equal = fleetmap.drift_one(d, "o/p", row, None, self.tree())
        self.assertEqual(fleetmap.apply(d, [equal], now="T3")["closed"], ["Q-FLEETMAP-p"])
        closed = json.loads((d / "docs/issues/Q-FLEETMAP-p.json").read_text())["body"]
        self.assertIn("**Status:** closed", closed)
        self.assertIn("fleetmap --drift read o/p equal to its source (github)", closed)
        unread = fleetmap.drift_one(d, "o/q", row, None, lambda url: {"error": "x"})
        self.assertEqual(fleetmap.apply(d, [unread], now="T4")["filed"], ["Q-FLEETMAP-q"])

    def test_US_31_R40_publishing_a_kernel_never_overwrites_work_done_in_the_copy_and_never_deletes(self):
        src, mirror = tmp(self), tmp(self)
        put(src, "seed/a.txt", "A1\n")
        put(src, "seed/b.txt", "B1\n")
        put(mirror, "only-here.txt", "mine\n")
        dry = fleetmap.publish(src, mirror)
        self.assertEqual((dry["added"], dry["extra"]), (["a.txt", "b.txt"], ["only-here.txt"]))
        self.assertFalse((mirror / "a.txt").exists(), "a dry run writes nothing")
        fleetmap.publish(src, mirror, apply=True, source_sha="sha1")
        self.assertEqual((mirror / "a.txt").read_text(), "A1\n")
        stamp = json.loads((mirror / fleetmap.STAMP).read_text())
        self.assertEqual((stamp["rule"], stamp["source_sha"], sorted(stamp["digests"])), ("FLEET-MAP-1", "sha1", ["a.txt", "b.txt"]))
        put(src, "seed/a.txt", "A2\n")
        again = fleetmap.publish(src, mirror, apply=True)
        self.assertEqual((again["updated"], again["conflicts"], again["same"]), (["a.txt"], [], 1), "what the last publish wrote is replaced by the next")
        self.assertEqual((mirror / "a.txt").read_text(), "A2\n")
        (mirror / "a.txt").write_text("edited in the copy\n")
        put(src, "seed/a.txt", "A3\n")
        clash = fleetmap.publish(src, mirror, apply=True)
        self.assertEqual(clash["conflicts"], ["a.txt"])
        self.assertEqual((mirror / "a.txt").read_text(), "edited in the copy\n", "work done in the copy is a conflict to carry up, never overwritten")
        self.assertEqual((mirror / "only-here.txt").read_text(), "mine\n")

    def test_US_31_R41_one_manifest_renders_every_surface_that_says_what_a_system_is_and_a_hand_edit_or_a_bad_manifest_is_caught(self):
        eng = surfaces.engine()
        d = tmp(self)
        put(d, "ultrastable.json", (ROOT / "seed/ultrastable.json").read_text())
        put(d, "standards/system.schema.json", (ROOT / "seed/standards/system.schema.json").read_text())
        put(d, "README.md", "# A system\n\nIts own words.\n")
        self.assertEqual(eng.check_manifest(d), [])
        wrote = eng.render(d)
        self.assertEqual(sorted(wrote), [".ultrastable/github.json", "CITATION.cff", "README.md", "catalog-info.yaml", "publiccode.yml"])
        self.assertEqual(eng.check(d), [])
        self.assertEqual(eng.render(d), [], "a second render changes nothing")
        text = (d / "README.md").read_text()
        self.assertTrue(text.startswith("# A system\n\n<!-- identity:start"))
        self.assertIn("<!-- how:start", text)
        self.assertNotIn(eng.LIVE_START, text, "a template has nothing deployed, so it carries no Live block")
        self.assertIn("Its own words.", text)
        ident = json.loads((d / "ultrastable.json").read_text())["identity"]
        none = eng.live_block({**ident, "layer": "tenant", "public_url": None})
        self.assertIn("Not deployed yet", none)
        self.assertNotIn("https://x.example", none)
        up = eng.live_block({**ident, "layer": "tenant", "public_url": "https://x.example", "runs_as": [{"provider": "cloudflare", "kind": "worker", "name": "w"}]})
        for want in ("[https://x.example/health](https://x.example/health)", "https://x.example/claims.json", "Cloudflare Worker `w`"):
            self.assertIn(want, up)
        (d / "publiccode.yml").write_text("hand edited\n")
        self.assertEqual(eng.check(d), ["publiccode.yml: differs from what ultrastable.json renders; run python3 scripts/surfaces.py --render"])
        eng.render(d)
        self.assertEqual(eng.stage(d), "unmeasured", "a stage is read from evidence, never from the manifest")
        put(d, "ops/seed-lifecycle.json", {"stage": "built"})
        self.assertEqual(eng.stage(d), "built")
        put(d, "ops/seed-lifecycle.json", {"stage": "bogus"})
        self.assertEqual(eng.stage(d), "unmeasured")
        m = json.loads((d / "ultrastable.json").read_text())
        m["org"] = {"slug": "not-the-slug"}
        put(d, "ultrastable.json", m)
        self.assertTrue(any("one name, one slug" in e for e in eng.check(d)))
        del m["identity"]["summary"]
        put(d, "ultrastable.json", m)
        self.assertTrue(any("summary" in e for e in eng.check_manifest(d)))
        with self.assertRaises(SystemExit):
            eng.render(d)
        self.assertIn("github", eng.plan(ident, "github"))

    def test_US_31_R42_the_live_block_is_computed_from_the_registries_and_a_system_with_nothing_deployed_says_so_and_links_no_host(self):
        rows = {r["id"]: r for r in livelinks.rows(ROOT)}
        self.assertIn("ultrastable", rows)
        core = livelinks.block("ultrastable", ROOT)
        self.assertIn("https://ultrastable.io/health", core)
        self.assertIn("https://ultrastable.io/claims.json", core)
        self.assertTrue(core.startswith(livelinks.START) and core.rstrip().endswith(livelinks.END))
        nothing = livelinks.block("no-such-system", ROOT)
        self.assertIn("Not deployed yet", nothing)
        self.assertNotIn("https://no-such", nothing)
        fleet = livelinks.block("fleet", ROOT)
        self.assertIn("## Where everything runs", fleet)
        self.assertIn("| ultrastable |", fleet)
        placed = livelinks.place("# Title\n\nbody\n", core)
        self.assertTrue(placed.startswith("# Title\n"))
        self.assertTrue(livelinks.has(placed, core))
        self.assertEqual(livelinks.place(placed, core), placed, "placing the same block again changes nothing")
        self.assertFalse(livelinks.has("# Title\n", core))
        self.assertEqual(livelinks.place("no heading", core).count(livelinks.START), 1)
        self.assertEqual(livelinks.check(ROOT), [])

    def test_US_31_R43_every_system_has_a_repository_a_back_end_and_a_front_end_or_an_open_item_building_the_missing_part(self):
        d = tmp(self)
        for rel in fullstack.RULE_FILES:
            put(d, rel, "FULLSTACK-1 is named here\n")
        put(d, "instances/ultrastable/progress.json", {"systems": [{"id": "a", "repo": "o/a", "url": "https://a.example/"}, {"id": "b"}]})
        put(d, "doctrine/seed-deploys.json", {"seeds": []})
        put(d, fullstack.POLICY, {"systems": {"a": {"backend": "https://a.example/health"}, "b": {"gaps": {"repo": "Q-FS-b-repo", "backend": "Q-FS-b-back", "frontend": "Q-FS-b-front"}}, "ghost": {}}})
        put(d, "docs/issues/Q-FS-b-repo.json", {"body": "**Status:** open"})
        put(d, "docs/issues/Q-FS-b-back.json", {"body": "**Status:** closed"})
        errs = "\n".join(fullstack.check(d))
        self.assertIn("b: no backend, and its item Q-FS-b-back is missing or closed", errs)
        self.assertIn("b: no frontend, and its item Q-FS-b-front is missing or closed", errs)
        self.assertNotIn("b: no repo", errs, "an open item building the part is the honest state")
        self.assertIn("ghost: row in doctrine/full-stack.json for a system that is not in progress.json or seed-deploys.json", errs)
        self.assertNotIn("a:", errs)
        pol = json.loads((d / fullstack.POLICY).read_text())
        pol["systems"]["a"]["gaps"] = {"backend": "Q-FS-a"}
        put(d, fullstack.POLICY, pol)
        self.assertIn("a: backend is declared, so its gap (Q-FS-a) should be removed", fullstack.check(d))
        body = lambda url, ua: (200, "text/html", "<html>") if url == "https://a.example/" else (503, "application/json", '{"ok": false}')
        rows = {r["id"]: r for r in fullstack.live(d, body)}
        self.assertEqual((rows["a"]["frontend"], rows["a"]["backend"], rows["a"]["repo"], rows["a"]["ok"]), ("live", "live", "declared", True))
        self.assertEqual((rows["b"]["frontend"], rows["b"]["ok"]), ("missing", False))
        down = {r["id"]: r for r in fullstack.live(d, lambda url, ua: (0, "", "refused"))}
        self.assertEqual((down["a"]["frontend"], down["a"]["backend"], down["a"]["ok"]), ("down (0)", "down (0)", False))

    def test_US_31_R47_the_public_list_is_generated_from_the_registries_so_a_live_tenant_without_a_showcase_or_a_stale_list_fails(self):
        d = tmp(self)
        put(d, "doctrine/tenant-repos.json", {"tenants": {"a": {"repo": "ultrastable/a", "state": "own-repo", "worker": "w-a"}, "b": {"repo": "ultrastable/b", "state": "planned"},
                                                          "c": {"repo": "ultrastable/c", "state": "own-repo", "worker": "w-c"}, "e": {"repo": "ultrastable/e", "state": "retired"}}})
        put(d, "doctrine/topology.json", {"workers": [{"id": "w-a", "state": "live"}, {"id": "w-c", "state": "planned"}]})
        put(d, "doctrine/stakeholders.json", {"showcases": [{"id": "x", "name": "X", "status": "planned", "home": "https://x.example/"}]})
        put(d, "site/worker.js", "// a site Worker that renders nothing of the directory\n")
        self.assertEqual(set(discover.live_tenants(d)), {"a"}, "planned, retired and not-yet-live workers are not listed")
        errs = discover.check(d)
        self.assertIn("a: live tenant with no live showcase and home in doctrine/stakeholders.json, so the homepage cannot list it", errs)
        self.assertTrue(any(e.startswith("site/directory-data.js is stale") for e in errs))
        put(d, "doctrine/stakeholders.json", {"showcases": [{"id": "a", "name": "A", "status": "live", "home": "https://a.example/", "summary": "s"}, {"id": "x", "name": "X", "status": "planned", "home": "https://x.example/"}]})
        listed = discover.core(d)
        self.assertEqual([c["id"] for c in listed], ["ultrastable", "a"])
        self.assertEqual((listed[0]["kind"], listed[1]["kind"], listed[1]["repo"]), ("platform", "tenant", "https://github.com/ultrastable/a"))
        put(d, discover.OUT, discover.render(d))
        after = discover.check(d)
        self.assertFalse(any(e.startswith("site/directory-data.js is stale") for e in after))
        self.assertIn("site/worker.js: /directory is not served", after)
        self.assertIn("site/worker.js: external systems cannot register", after)
        self.assertEqual(discover.check(ROOT), [])


class ColdStart(unittest.TestCase):
    def test_US_31_R49_a_system_is_born_with_thirteen_capabilities_each_carried_by_seed_files_a_wired_step_and_an_open_public_path(self):
        c = coldstart.load(ROOT)
        self.assertEqual([x["id"] for x in c["capabilities"]], ["own-repo", "backend", "frontend", "clock", "discoverable", "knowledge-graph", "progress", "live-content", "self-improve", "platform-sync", "year-unattended", "goals", "instructions"])
        self.assertEqual(coldstart.check_capabilities(c, ROOT), [])
        reads = coldstart.public_reads(ROOT)
        self.assertTrue({"/", "/health", "/.well-known/ultrastable.json", "/api/graph"} <= reads)
        self.assertTrue(all(x["live"]["path"] in reads for x in c["capabilities"] if x.get("live")))
        bad = copy.deepcopy(c)
        bad["capabilities"].append({"id": "x", "rule": "R-1", "seed": ["nowhere/file.txt"], "step": "no-such-step", "cron": "seed/IDEA.md", "live": {"path": "/hidden-path", "status": [200]}, "fleet": "nocommand --check"})
        errs = "\n".join(coldstart.check_capabilities(bad, ROOT))
        for want in ("x: the seed does not carry nowhere/file.txt", "x: tick step 'no-such-step' is not wired in seed/worker/src/index.js", "x: seed/IDEA.md declares no cron",
                     "x: /hidden-path is hidden on a health-only seed", "x: its fleet check `python3 -m foundation nocommand --check` does not resolve to a command"):
            self.assertIn(want, errs)

    def test_US_31_R50_the_definition_and_the_agent_instructions_are_the_same_in_the_platform_and_the_seed_and_every_import_and_named_command_resolves(self):
        c = coldstart.load(ROOT)
        self.assertEqual((coldstart.check_definition(c, ROOT), coldstart.check_commands(c, ROOT), coldstart.check_instructions(c, ROOT), coldstart.check_schema(c, ROOT)), ([], [], [], []))
        d = tmp(self)
        put(d, "CLAUDE.md", "@AGENTS.md\n@gone.md\n")
        put(d, "AGENTS.md", "x\n")
        put(d, "p.md", "- **A rule (RULE-1, Rowan)** text\n- **A rule (RULE-1, Rowan)** text\n- **Only here (ONLY-2, Rowan)** text\n")
        put(d, "s.md", "nothing\n")
        cfg = {"instructions": {"platform": "p.md", "seed": "s.md", "imports": ["CLAUDE.md"], "platform_only": {"ONLY-2": "named by the platform alone"}}}
        errs = "\n".join(coldstart.check_instructions(cfg, d))
        self.assertIn("CLAUDE.md: @gone.md does not resolve", errs)
        self.assertIn("s.md: rule RULE-1 is in p.md but not in the seed", errs)
        self.assertNotIn("ONLY-2", errs, "a platform-only rule carries its reason")
        self.assertIn("p.md: a rule bullet appears 2 times", errs)
        self.assertTrue(coldstart.command_ok("coldstart") and not coldstart.command_ok("no-such-command"))
        self.assertEqual(coldstart.CMD_RE.findall("python3 -m foundation admit --check and python -m foundation.tenantsync"), ["admit", "tenantsync"])

    def test_US_31_R51_a_deployed_system_is_probed_for_every_live_path_of_the_contract_and_each_miss_names_its_reason(self):
        paths = {x["live"]["path"]: x["live"] for x in coldstart.load(ROOT)["capabilities"] if x.get("live")}
        def get(answers):
            def g(url):
                p = "/" + url.split("//", 1)[1].split("/", 1)[1] if "/" in url.split("//", 1)[1] else "/"
                return answers.get(p) or ((200, "text/html", b"<html>") if p == "/" else (503 if p == "/health" else 200, "application/json", b'{"ok": true}'))
            return g
        rows = coldstart.live("https://sys.example/", ROOT, get({}))
        self.assertEqual({r["path"] for r in rows}, set(paths))
        self.assertTrue(all(r["ok"] for r in rows), rows)
        bad = {r["path"]: r for r in coldstart.live("https://sys.example", ROOT, get({"/api/graph": (200, "text/html", b"<html>nope"), "/": (200, "application/json", b"{}"), "/.well-known/ultrastable.json": (404, "text/plain", b"no")}))}
        self.assertEqual(bad["/api/graph"]["why"], "answer is not JSON")
        self.assertEqual(bad["/"]["why"], "content-type application/json, expected text/html")
        self.assertEqual(bad["/.well-known/ultrastable.json"]["why"], "status 404, expected [200]")
        self.assertEqual(coldstart.live("https://sys.example", ROOT, lambda url: (0, "", b"refused"))[0]["ok"], False)

    def test_US_31_R52_the_seed_kernel_is_treated_as_a_fresh_checkout_and_fails_on_anything_it_needs_that_code_does_not_produce(self):
        self.assertEqual(bootproof.audit(ROOT), [])
        d = tmp(self)
        put(d, "doctrine/bootproof.json", {"secrets": {"GOOD": {"degrade": "d", "acquire": "a"}, "BAD": {"degrade": "d"}}, "wrangler_filled_elsewhere": ["d1_database_id"], "migration_duplicates_grandfathered": []})
        put(d, "seed/CLAUDE.md", "@AGENTS.md\n@doctrine/missing.md\n")
        put(d, "seed/AGENTS.md", "rules\n")
        put(d, "seed/worker/wrangler.template.jsonc", '{"name": "{org_slug}", "database_id": "{d1_database_id}", "x": "{unfilled_thing}"}')
        put(d, "seed/bootstrap/bootstrap.py", "org_slug = 1\n")
        for n in ("0001_a.sql", "0003_b.sql", "0003_c.sql"):
            put(d, f"seed/worker/migrations/{n}", "select 1;\n")
        put(d, "seed/.github/workflows/w.yml", "name: w\non: push\njobs:\n  a:\n    env:\n      T: ${{ secrets.GOOD }}\n      U: ${{ secrets.UNDECLARED }}\n")
        put(d, "seed/.github/workflows/x.yml", "name: x\njobs: {}\n")
        errs = "\n".join(bootproof.audit(d))
        for want in ("seed/CLAUDE.md imports @doctrine/missing.md but the seed does not carry it", "wrangler placeholder {unfilled_thing} is filled by nothing in bootstrap.py",
                     "seed migrations reuse number(s) [3]", "seed migrations are not a contiguous run: [1, 3]", "w.yml uses secret UNDECLARED that doctrine/bootproof.json does not declare with a route",
                     "x.yml has no trigger: it can never start by itself", "secret BAD lacks a degrade route or an automated acquire route"):
            self.assertIn(want, errs)
        self.assertNotIn("{org_slug}", errs)
        self.assertNotIn("GOOD", errs)

    def probe(self, **down):
        base, repo = "https://s.example", "o/s"
        directory = lambda listed: json.dumps({"core": [], "external": [{"id": base if listed else "x"}]})
        answers = {
            f"https://api.github.com/repos/{repo}": (200, {}, '{"private": false}'),
            base + "/health": (200, {}, '{"org": "s", "ok": true, "ignition": {"stage": "looping"}}'),
            base + "/": (200, {"content-type": "text/html"}, "<footer>Built on ultrastable.io <a href='/.well-known/ultrastable.json'></a></footer>"),
            base + "/api/graph": (200, {}, '{"built": true, "last": {"nodes": 12}}'),
            base + "/.well-known/ultrastable.json": (200, {}, json.dumps({"ultrastable": 1, "url": base, "repo": "https://github.com/" + repo, "discoverable": True})),
            bootaccept.DIRECTORY + "/directory.json": (200, {}, directory(True)),
        }
        answers.update({k.replace("_", "/"): v for k, v in down.items()})
        return base, repo, lambda url: answers.get(url, (404, {}, "")), answers

    def test_US_31_R53_acceptance_reads_six_layers_from_outside_and_a_system_is_accepted_only_when_all_six_hold(self):
        base, repo, get, answers = self.probe()
        layers = bootaccept.probe(base, repo, get)
        self.assertEqual(list(layers), list(bootaccept.LAYERS))
        self.assertEqual(bootaccept.LAYERS, ("repo", "backend", "health", "ui", "graph", "discovery"))
        self.assertEqual(bootaccept.verdict(layers), {"passed": True, "failed_layers": []})
        answers[base + "/api/graph"] = (404, {}, "")
        answers[bootaccept.DIRECTORY + "/directory.json"] = (200, {}, json.dumps({"external": []}))
        answers[f"https://api.github.com/repos/{repo}"] = (200, {}, '{"private": true}')
        v = bootaccept.verdict(bootaccept.probe(base, repo, get))
        self.assertEqual(v["failed_layers"], ["repo", "graph", "discovery"])
        self.assertEqual(bootaccept.probe(base, None, get)["repo"]["ok"], False, "a system with no declared repository fails, it is never skipped")
        posted = []
        def post(url, body):
            posted.append((url, body))
            answers[bootaccept.DIRECTORY + "/directory.json"] = (200, {}, json.dumps({"external": [{"id": base}]}))
            return 202, "{}"
        answers[base + "/api/graph"] = (200, {}, '{"built": true, "last": {"nodes": 3}}')
        answers[f"https://api.github.com/repos/{repo}"] = (200, {}, '{"private": false}')
        again = bootaccept.probe(base, repo, get, post)
        self.assertTrue(again["discovery"]["ok"], "the second route registers the system and reads the listing again")
        self.assertEqual(posted, [(bootaccept.DIRECTORY + "/api/directory/register", {"url": base})])

    def test_US_31_R53_a_layer_that_fails_is_read_again_after_a_wait_and_a_failed_launch_fails_the_acceptance(self):
        base, repo, get, answers = self.probe()
        system = {"system": "s", "base": base, "repo": repo}
        good = bootaccept.accept([system], get, retries=1, wait_s=0, sleep=lambda s: None)[0]
        self.assertEqual((good["passed"], good["owner_gates"]), (True, ["gap-fresh-account-bootstrap", "visitor-app-repos"]))
        calls = {"n": 0}
        def flaky(url):
            if url == base + "/health":
                calls["n"] += 1
                if calls["n"] == 1:
                    return 503, {}, "{}"
            return get(url)
        waits = []
        self.assertTrue(bootaccept.accept([system], flaky, retries=1, wait_s=60, sleep=waits.append)[0]["passed"])
        self.assertEqual(waits, [60])
        launched = bootaccept.accept([system], get, launch={"passed": False, "failed_stages": ["provision"], "slug": "x", "route": "oidc"}, retries=0)[0]
        self.assertEqual((launched["passed"], launched["failed_layers"]), (False, ["launch"]))

    def test_US_31_R54_the_latest_acceptance_of_each_standing_seed_must_have_passed_and_be_fresh_and_no_record_is_a_failure(self):
        d = tmp(self)
        put(d, "doctrine/seed-deploys.json", {"seeds": ["alpha"]})
        put(d, "doctrine/full-stack.json", {"systems": {"alpha": {"repo": "ultrastable/alpha"}}})
        now = dt.datetime(2026, 11, 26, 12, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(bootaccept.standing_systems(d), [{"system": "alpha", "base": "https://ultrastable-seed-alpha.ultrastable.workers.dev", "repo": "ultrastable/alpha"}])
        self.assertTrue(any("no bootstrap acceptance recorded" in e for e in bootaccept.check(d, now)))
        row = lambda at, ok: json.dumps({"system": "alpha", "at": at, "passed": ok, "failed_layers": [] if ok else ["graph"], "layers": {"graph": {"ok": ok, "detail": "not built yet"}}})
        put(d, bootaccept.LEDGER, row("2026-11-25T12:00:00Z", True) + "\n")
        self.assertEqual(bootaccept.check(d, now), [])
        put(d, bootaccept.LEDGER, row("2026-11-25T12:00:00Z", True) + "\n" + row("2026-11-26T11:00:00Z", False) + "\n")
        self.assertIn("alpha: failed layers ['graph']: graph: not built yet", bootaccept.check(d, now)[0], "the latest row decides")
        put(d, bootaccept.LEDGER, row("2026-11-10T12:00:00Z", True) + "\n")
        self.assertEqual(bootaccept.check(d, now), ["alpha: latest acceptance is 16 days old (> 8)"])


class Spinoffs(unittest.TestCase):
    def sandbox(self):
        d = scratch()
        for rel in ("doctrine/spinoff.json", "doctrine/spinoff-ideas.json", "ops/free-tier.json"):
            (d / rel).parent.mkdir(parents=True, exist_ok=True)
            (d / rel).write_text((ROOT / rel).read_text())
        (d / "spinoffs").mkdir()
        return d

    def test_US_31_R58_a_candidate_that_collects_anything_asks_for_free_text_or_names_a_denied_domain_never_launches(self):
        cfg = spinoff.load(ROOT)
        cand = {"slug": "s", "archetype": "domain-check", "why": "checks a public website", "domains": [], "need_ids": [], "collects": [], "input": "a public domain name"}
        self.assertEqual(spinoff.gate(cand, cfg), {"ok": True, "reasons": []})
        bad = spinoff.gate({**cand, "why": "a people-search and medical lookup", "collects": ["email"], "input": "free text", "archetype": "nonesuch"}, cfg)
        self.assertFalse(bad["ok"])
        text = "\n".join(bad["reasons"])
        for want in ("denied domain: people-search", "denied domain: medical", "collects email", "an app may collect nothing beyond aggregate counts", "input not allowed: free text", "unknown archetype"):
            self.assertIn(want, text)
        self.assertEqual(cfg["budget"]["monthly_usd_ceiling"], 0)
        self.assertEqual(spinoff.check(ROOT), [])

    def test_US_31_R58_launches_stop_at_the_live_cap_the_weekly_cap_and_the_daily_cap_the_free_tier_level_sets(self):
        t = dt.datetime(2026, 11, 26, 12, 0, tzinfo=dt.timezone.utc)
        cfg = spinoff.load(ROOT)
        iso = lambda h: (t - dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")
        d = self.sandbox()
        for i in range(cfg["budget"]["max_live"]):
            (d / f"instances/spinoffs/app{i}").mkdir(parents=True)
            (d / f"instances/spinoffs/app{i}/app.json").write_text(json.dumps({"slug": f"app{i}", "status": "live", "archetype": "domain-check"}))
        self.assertEqual(spinoff.launch(d, False, t)["why"], f"live cap {cfg['budget']['max_live']} reached")
        e = self.sandbox()
        ledger = e / cfg["ledger"]
        ledger.parent.mkdir(parents=True)
        ledger.write_text("\n".join(json.dumps({"event": "launch", "at": iso(30 + i)}) for i in range(cfg["budget"]["max_launches_per_week"])) + "\n")
        self.assertEqual(spinoff.launch(e, False, t)["why"], f"weekly launch cap {cfg['budget']['max_launches_per_week']} reached")
        f = self.sandbox()
        (f / cfg["ledger"]).parent.mkdir(parents=True)
        (f / cfg["ledger"]).write_text("\n".join(json.dumps({"event": "launch", "at": iso(1 + i)}) for i in range(cfg["budget"]["max_launches_per_day"])) + "\n")
        self.assertRegex(spinoff.launch(f, False, t)["why"], r"^daily launch cap \d+ reached \(free-tier level sets it\)$")

    def test_US_31_R59_each_app_is_kept_iterated_promoted_or_retired_by_its_measured_value_and_an_unmeasured_app_is_never_scored_as_zero(self):
        t = dt.datetime(2026, 11, 26, tzinfo=dt.timezone.utc)
        cfg = spinoff.load(ROOT)
        d = self.sandbox()
        ago = lambda days: (t - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        apps = {"young": ago(3), "dead": ago(30), "mid": ago(30), "star": ago(30), "unmeasured": ago(30), "board": ago(30)}
        for slug, launched in apps.items():
            (d / f"instances/spinoffs/{slug}").mkdir(parents=True)
            extra = {"showcase": True} if slug == "board" else {}
            (d / f"instances/spinoffs/{slug}/app.json").write_text(json.dumps({"slug": slug, "status": "live", "archetype": "domain-check", "launched": launched, **extra}))
        reads = {"young": dict(verified_fixes_7d=0), "dead": dict(verified_fixes_7d=0, return_share=0, visitors_with_a_gap_7d=0), "mid": dict(verified_fixes_7d=5, return_share=0, visitors_with_a_gap_7d=0),
                 "star": dict(verified_fixes_7d=10, return_share=0.2, visitors_with_a_gap_7d=20), "board": dict(board_age_hours=100)}
        lines = [json.dumps({"slug": s, "ok": True, **m}) for s, m in reads.items()]
        (d / cfg["metrics_ledger"]).parent.mkdir(parents=True, exist_ok=True)
        (d / cfg["metrics_ledger"]).write_text("\n".join(lines) + "\n")
        got = {x["slug"]: x for x in spinoff.tick(d, False, t)}
        self.assertEqual({s: x["decision"] for s, x in got.items()}, {"young": "keep", "dead": "retire", "mid": "iterate", "star": "promote", "unmeasured": "measure", "board": "iterate"})
        self.assertEqual((got["unmeasured"]["value"], got["board"]["value"]), (None, None))
        self.assertEqual((got["dead"]["value"], got["star"]["value"]), (0.0, 1.0))
        self.assertTrue(0.15 <= got["mid"]["value"] < 0.6)
        self.assertEqual(got["dead"]["budget_share"], 0)
        self.assertGreaterEqual(got["young"]["budget_share"], cfg["portfolio"]["budget_share_floor"])
        self.assertFalse((d / cfg["ledger"]).exists(), "a reading without apply records nothing")


if __name__ == "__main__":
    unittest.main()

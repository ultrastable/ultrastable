# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REPO-STANDARD-1: one repository standard for every repository of the org, discovered at run time, with computed metadata."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import repostd as rs  # noqa: E402

STD = rs.standard(ROOT)


def good_live(name, want, **over):
    live = {"name": name, "private": want["visibility"] == "private", "archived": False, "default_branch": "main", "description": want["description"],
            "homepage": want["homepage"], "topics": list(want["topics"]), "permissions": {"admin": True},
            "security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}, **want["settings"]}
    live.update(over)
    return live


class FakeApi:
    """A GitHub that holds `repos` (name -> live dict); extras per repo: workflows (int), ruleset (bool), missing (set of paths)."""
    token = "t"

    def __init__(self, repos, extras=None, listing=True, refuse_writes=False):
        self.repos, self.extras, self.listing, self.refuse, self.calls = repos, extras or {}, listing, refuse_writes, []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path.startswith("/orgs/"):
            return (200, [dict(v) for v in self.repos.values()]) if self.listing else (403, {"message": "no"})
        parts = path.split("?")[0].split("/")
        name, rest = parts[3], "/".join(parts[4:])
        if name not in self.repos:
            return 404, {"message": "Not Found"}
        x = self.extras.get(name, {})
        if method != "GET":
            if self.refuse:
                return 403, {"message": "Resource not accessible by integration"}
            if rest == "" and method == "PATCH":
                self.repos[name].update({k: v for k, v in body.items() if k != "security_and_analysis"})
                for k, v in (body.get("security_and_analysis") or {}).items():
                    self.repos[name].setdefault("security_and_analysis", {})[k] = v
            if rest == "topics":
                self.repos[name]["topics"] = body["names"]
            if rest == "rulesets":
                x["ruleset"] = True
                self.extras[name] = x
                return 201, {"id": 1}
            return (204, None) if rest == "vulnerability-alerts" else (200, {})
        if rest == "":
            return 200, self.repos[name]
        if rest == "actions/workflows":
            return 200, {"workflows": [{"path": f".github/workflows/w{i}.yml"} for i in range(x.get("workflows", 0))]}
        if rest == "rulesets":
            return 200, ([{"id": 1, "name": "main-protected", "enforcement": "active"}] if x.get("ruleset") else [])
        if rest.startswith("branches/"):
            return 200, {"protected": False}
        if rest.startswith("contents/"):
            return (404, {}) if rest[len("contents/"):] in x.get("missing", set()) else (200, {})
        return 500, {"message": "unexpected " + path}


class Standard(unittest.TestCase):
    def test_the_repository_is_consistent(self):
        self.assertEqual(rs.check(ROOT), [])

    def test_the_worker_applies_the_same_standard(self):
        self.assertEqual(rs.worker_block(ROOT), STD["worker"])

    def test_merge_rules_are_one_default(self):
        s = STD["worker"]["settings"]
        self.assertEqual((s["allow_squash_merge"], s["allow_merge_commit"], s["allow_rebase_merge"], s["allow_auto_merge"], s["delete_branch_on_merge"]),
                         (True, False, False, True, True))

    def test_every_registered_repository_gets_the_whole_standard_with_computed_metadata(self):
        p = rs.plan(ROOT)
        for must in ("ultrastable", "seed", "ops", ".github", "second-tenant", "replication-ledger", "what-works", "unlearn", "practical-solutions", "base-rates"):
            self.assertIn(must, p)
        for name, d in p.items():
            self.assertGreaterEqual(len(d["description"]), 20, name)
            self.assertLessEqual(len(d["description"]), 350, name)
            self.assertTrue(d["homepage"].startswith("https://"), name)
            self.assertTrue(d["topics"], name)
            self.assertIs(d["settings"]["delete_branch_on_merge"], True, name)
            self.assertIs(d["settings"]["allow_merge_commit"], False, name)

    def test_homepage_is_where_it_runs(self):
        p = rs.plan(ROOT)
        self.assertEqual(p["unlearn"]["homepage"], "https://unlearn.ultrastable.org/")
        self.assertEqual(p["replication-ledger"]["homepage"], "https://replication-ledger.ultrastable.org/")
        self.assertIn("ultrastable.org", p["practical-solutions"]["homepage"])
        self.assertIn("second-tenant", p["second-tenant"]["homepage"])
        self.assertEqual(p["ultrastable"]["homepage"], "https://ultrastable.io")

    def test_a_repository_no_registry_names_still_gets_the_default(self):
        d = rs.desired("brand-new-system", root=ROOT)
        self.assertFalse(d["registered"])
        self.assertEqual(d["settings"], STD["worker"]["settings"])
        self.assertEqual(d["visibility"], "public")
        self.assertEqual(d["description"], "Brand New System: a system running on Ultrastable.")
        self.assertIn(".github/workflows/branch-cleanup.yml", d["workflows"])

    def test_metadata_has_one_source_function_and_the_manifest_wins_when_it_exists(self):
        reg = rs.registries(ROOT)
        m = rs.repo_metadata("unlearn", reg, ROOT, STD)
        self.assertEqual(set(m), {"description", "homepage", "topics", "private", "private_reason"})
        self.assertEqual(rs.desired("unlearn", reg, ROOT, STD)["description"], m["description"])

    def test_private_is_only_by_a_written_reason(self):
        self.assertEqual(list(STD["visibility"]["private"]), ["ops"])
        self.assertEqual(rs.desired("ops", root=ROOT)["visibility"], "private")
        self.assertEqual(rs.desired("seed", root=ROOT)["visibility"], "public")
        self.assertTrue(rs.desired("seed", root=ROOT)["make_public"])


class Live(unittest.TestCase):
    def world(self, names=("unlearn",), **kw):
        reg = rs.registries(ROOT)
        repos = {n: good_live(n, rs.desired(n, reg, ROOT, STD)) for n in names}
        return repos, reg

    def one(self, api, name):
        return rs.measure(api, name, rs.desired(name, root=ROOT), STD)

    def test_a_repository_on_the_standard_is_clean(self):
        repos, _ = self.world()
        r = self.one(FakeApi(repos, {"unlearn": {"workflows": 2, "ruleset": True}}), "unlearn")
        self.assertEqual((r["findings"], r["unmeasured"], r["status"]), ([], [], "measured"))

    def test_a_private_repository_with_workflows_fails(self):
        repos, _ = self.world(("seed",))
        repos["seed"]["private"] = True
        r = self.one(FakeApi(repos, {"seed": {"workflows": 9}}), "seed")
        self.assertTrue(any("billed" in f for f in r["findings"]), r["findings"])
        self.assertIn("ruleset", r["gated"])

    def test_ops_private_without_workflows_is_within_the_rule_and_plan_gated_parts_are_said(self):
        repos, _ = self.world(("ops",))
        r = self.one(FakeApi(repos, {"ops": {"workflows": 0, "missing": {".github/workflows/branch-cleanup.yml"}}}), "ops")
        self.assertEqual(r["findings"], [])
        self.assertEqual(sorted(set(r["gated"])), ["allow_auto_merge", "ruleset", "security"])

    def test_empty_metadata_wrong_merge_rules_and_unprotected_main_are_each_named(self):
        repos, _ = self.world(("replication-ledger",))
        repos["replication-ledger"].update(description=None, homepage=None, topics=[], allow_merge_commit=True, delete_branch_on_merge=False)
        r = self.one(FakeApi(repos, {"replication-ledger": {"workflows": 1, "missing": {"LICENSE", ".github/workflows/branch-cleanup.yml"}}}), "replication-ledger")
        text = " | ".join(r["findings"])
        for needle in ("description is empty", "homepage (the About website) is empty", "https://replication-ledger.ultrastable.org/", "topics are empty",
                       "allow_merge_commit is true", "delete_branch_on_merge is false", "main is not protected", "LICENSE is missing", "branch-cleanup.yml is missing"):
            self.assertIn(needle, text)

    def test_what_cannot_be_read_is_unmeasured_never_ok(self):
        api = FakeApi({}, listing=False)
        r = self.one(api, "ops")
        self.assertEqual(r["status"], "unmeasured")
        lines = []
        self.assertEqual(rs.live(api, ROOT, out=lines.append), 2)
        self.assertFalse(any(l.startswith("ok") for l in lines), lines[:3])
        self.assertTrue(lines[0].startswith("unmeasured"))
        # merge settings hidden from a credential without push access: the fields are unmeasured, the repository is not called ok
        repos, _ = self.world()
        for k in STD["worker"]["settings"]:
            repos["unlearn"].pop(k)
        r = self.one(FakeApi(repos, {"unlearn": {"ruleset": True}}), "unlearn")
        self.assertEqual(r["status"], "partly-unmeasured")
        self.assertTrue(any("allow_auto_merge" in u for u in r["unmeasured"]))

    def test_a_repository_outside_every_registry_is_discovered_and_judged(self):
        repos, _ = self.world()
        repos["app-new"] = {"name": "app-new", "private": False, "archived": False, "default_branch": "main", "description": "", "homepage": "", "topics": []}
        lines = []
        self.assertEqual(rs.live(FakeApi(repos, {"unlearn": {"ruleset": True}}), ROOT, out=lines.append), 1)
        self.assertTrue(any(l.startswith("DRIFT") and "ultrastable/app-new" in l for l in lines))

    def test_archived_repositories_are_left_alone(self):
        repos, _ = self.world(("workers",))
        repos["workers"]["archived"] = True
        self.assertEqual(self.one(FakeApi(repos), "workers")["status"], "archived")


class Apply(unittest.TestCase):
    def drifted(self):
        reg = rs.registries(ROOT)
        want = rs.desired("replication-ledger", reg, ROOT, STD)
        live = good_live("replication-ledger", want, description=None, homepage=None, topics=[], allow_merge_commit=True, allow_auto_merge=False,
                         delete_branch_on_merge=False, security_and_analysis={"secret_scanning": {"status": "disabled"}})
        return {"replication-ledger": live}, want

    def test_a_token_that_may_puts_the_repository_on_the_standard_and_the_read_back_is_clean(self):
        repos, want = self.drifted()
        api = FakeApi(repos, {"replication-ledger": {"workflows": 1}})
        lines = []
        rc = rs.apply(api, ROOT, out=lines.append, via_app=lambda full, w: (False, "not used"))
        mine = [l for l in lines if "ultrastable/replication-ledger" in l]
        self.assertTrue(mine[0].startswith("ok"), mine)
        self.assertEqual(rs.measure(api, "replication-ledger", want, STD)["findings"], [])
        self.assertEqual(repos["replication-ledger"]["homepage"], "https://replication-ledger.ultrastable.org/")
        self.assertIn(rc, (0, 1))  # the other registered repositories are absent from this fake and go to the (failing) app route

    def test_without_a_token_that_may_every_repository_goes_through_the_administration_app_with_its_computed_metadata(self):
        repos, want = self.drifted()
        repos["replication-ledger"]["permissions"] = {"admin": False}
        sent = {}

        def via(full, w):
            sent[full] = w
            return True, "description, homepage, topics, ruleset"
        api = FakeApi(repos)
        lines = []
        self.assertEqual(rs.apply(api, ROOT, out=lines.append, via_app=via), 0)
        self.assertEqual(sent["ultrastable/replication-ledger"]["homepage"], "https://replication-ledger.ultrastable.org/")
        self.assertFalse([c for c in api.calls if c[0] != "GET"], "nothing is written with a token that may not")
        self.assertIn("ultrastable/second-tenant", sent, "a repository with no typed row is covered")

    def test_a_refusal_is_loud_and_the_run_fails(self):
        repos, _ = self.drifted()
        lines = []
        rc = rs.apply(FakeApi(repos, refuse_writes=True), ROOT, out=lines.append, via_app=lambda full, w: (False, "HTTP 409 admin-app-scope topics: HTTP 403"))
        self.assertEqual(rc, 1)
        bad = [l for l in lines if "ultrastable/replication-ledger" in l][0]
        self.assertTrue(bad.startswith("::error::REFUSED"))
        self.assertIn("Resource not accessible by integration", bad)
        self.assertIn("admin-app-scope", bad)

    def test_archived_is_skipped_not_failed(self):
        reg = rs.registries(ROOT)
        repos = {"workers": good_live("workers", rs.desired("workers", reg, ROOT, STD), archived=True)}
        lines = []
        rs.apply(FakeApi(repos), ROOT, out=lines.append, via_app=lambda full, w: (True, "unchanged"))
        self.assertTrue(any(l.startswith("skip") and "ultrastable/workers" in l for l in lines))

    def test_only_a_named_repository_is_ever_made_public(self):
        reg = rs.registries(ROOT)
        for name, expect in (("seed", True), ("ops", False)):
            want = rs.desired(name, reg, ROOT, STD)
            live = good_live(name, want, private=True, allow_auto_merge=False)
            api = FakeApi({name: live})
            rs._direct(api, f"ultrastable/{name}", want, live, STD)
            patched = [c[2] for c in api.calls if c[0] == "PATCH" and c[2] and "private" in c[2]]
            self.assertEqual(bool(patched), expect, name)


class Branches(unittest.TestCase):
    def test_each_class(self):
        pr = lambda sha, merged, state="closed": {"number": 1, "state": state, "merged_at": "2026-11-25T00:00:00Z" if merged else None, "head": {"sha": sha}}  # noqa: E731
        self.assertEqual(rs.classify("a", [pr("a", True)]), "merged")
        self.assertEqual(rs.classify("a", [pr("a", False)]), "closed")
        self.assertEqual(rs.classify("b", [pr("a", True)]), "unmerged-work", "commits pushed after the merge are not lost")
        self.assertEqual(rs.classify("a", []), "unmerged-work")
        self.assertEqual(rs.classify("a", [pr("a", False, "open"), pr("z", True)]), "open")

    def test_the_kit_and_a_new_tenant_repository_carry_the_cleanup(self):
        import tempfile
        from foundation import tenantrepos as tr
        self.assertEqual((ROOT / "seed/scripts/branch_cleanup.py").read_bytes(), (ROOT / "scripts/branch_cleanup.py").read_bytes())
        wf = (ROOT / "seed/.github/workflows/branch-cleanup.yml").read_text()
        for needle in ("# budget:", "# trigger:", "# free-alternative:", "timeout-minutes", "vars.HALT != '1'", 'BRANCH_CLEANUP_SETTINGS: "off"'):
            self.assertIn(needle, wf)
        with tempfile.TemporaryDirectory() as d:
            done = tr.prepare(Path(d), "replication-ledger", ROOT)
            self.assertTrue((Path(d) / ".github/workflows/branch-cleanup.yml").exists(), done)
            self.assertTrue((Path(d) / "scripts/branch_cleanup.py").exists())

    def test_the_cleanup_archives_work_pushed_after_a_merge_and_leaves_settings_to_the_standard(self):
        import importlib.util
        import os
        from unittest import mock
        spec = importlib.util.spec_from_file_location("branch_cleanup_under_test", ROOT / "scripts/branch_cleanup.py")
        bc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bc)
        old = "2026-01-01T00:00:00Z"
        prs = {"merged-clean": [{"number": 1, "state": "closed", "merged_at": old, "head": {"sha": "s1"}}],
               "merged-then-pushed": [{"number": 2, "state": "closed", "merged_at": old, "head": {"sha": "old"}}],
               "has-open-pr": [{"number": 3, "state": "open", "merged_at": None, "head": {"sha": "s3"}}], "no-pr": []}
        tips = {"main": "m", "loop-evidence": "e", "guarded": "g", "merged-clean": "s1", "merged-then-pushed": "new", "has-open-pr": "s3", "no-pr": "s5"}
        writes = []

        def gh(*args, method="GET", fields=None, paginate=False):
            path = args[0]
            if method != "GET":
                writes.append((method, path, fields))
                return {}
            if "/branches" in path:
                return [{"name": n, "commit": {"sha": s}, "protected": n == "guarded"} for n, s in tips.items()]
            if "/pulls" in path:
                return prs[path.split("head=ultrastable:")[1]]
            if "/commits/" in path:
                return {"commit": {"committer": {"date": old}}}
            return {"default_branch": "main", "private": False, "delete_branch_on_merge": False, "allow_auto_merge": False}
        with mock.patch.object(bc, "gh", gh), mock.patch.dict(os.environ, {"BRANCH_CLEANUP_REPOS": "x", "BRANCH_CLEANUP_SETTINGS": "off"}), mock.patch("builtins.print"):
            self.assertEqual(bc.run(True, 6), 0)
        deleted = sorted(p.rsplit("/heads/", 1)[1] for m, p, _ in writes if m == "DELETE")
        self.assertEqual(deleted, ["merged-clean", "merged-then-pushed", "no-pr"], "main, the ledger, the protected branch and the open pull request stay")
        archived = sorted(f["ref"] for m, p, f in writes if m == "POST")
        self.assertEqual(archived, ["refs/archive/merged-then-pushed", "refs/archive/no-pr"], "unmerged commits are archived before the branch goes")
        self.assertFalse([w for w in writes if w[0] == "PATCH"], "the per-repository run leaves the settings to the standard")
        self.assertLess(writes.index(("POST", "repos/ultrastable/x/git/refs", {"ref": "refs/archive/no-pr", "sha": "s5"})),
                        [i for i, w in enumerate(writes) if w[0] == "DELETE" and w[1].endswith("/no-pr")][0])

if __name__ == "__main__":
    unittest.main()

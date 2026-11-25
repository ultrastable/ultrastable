# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""TENANT-REPO-1: every tenant app lives in its own repository; the core keeps the manifest and builds the worker from the tenant repository."""
import json
import shutil
import unittest
from pathlib import Path

from foundation import tenantrepos as tr

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _repo  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def scratch(reg, topo, dirs=()):
    d = _repo.scratch()
    (d / "doctrine").mkdir()
    (d / "doctrine/tenant-repos.json").write_text(json.dumps(reg))
    (d / "doctrine/topology.json").write_text(json.dumps(topo))
    for p in dirs:
        (d / p).mkdir(parents=True, exist_ok=True)
    return d


class TenantRepos(unittest.TestCase):
    def test_repository_registry_passes(self):
        self.assertEqual(tr.check(ROOT), [])

    def test_new_tenant_code_in_the_core_fails(self):
        d = scratch({"org": "o", "tenants": {}}, {"workers": []}, ["instances/newapp/worker"])
        self.assertTrue(any("newapp" in e and "own repository" in e for e in tr.check(d)))

    def test_moved_tenant_needs_no_code_left_and_a_topology_source(self):
        reg = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "moved", "source": "instances/a", "worker": "w-a",
                                              "sandbox": {"budget": {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}}}}}
        d = scratch(reg, {"workers": [{"id": "w-a", "main": "worker/index.js"}]}, ["instances/a/worker"])
        errs = tr.check(d)
        self.assertTrue(any("still in the core" in e for e in errs))
        self.assertTrue(any("does not build from o/a" in e for e in errs))
        d2 = scratch(reg, {"workers": [{"id": "w-a", "state": "live", "routes": ["a.example.org"], "main": "worker/index.js", "source": {"repo": "o/a"}}]}, ["instances/a"])
        self.assertEqual(tr.check(d2), [])

    def test_sandbox_rejects_shared_stores_services_and_missing_budget(self):
        reg = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "own-repo", "worker": "w-a",
                                              "sandbox": {"stores": ["ultrastable-a"], "secrets": []}}}}
        topo = {"workers": [
            {"id": "w-a", "source": {"repo": "o/a"}, "bindings": {"d1": {"DB": "ultrastable-a", "ORG": "ultrastable-org"},
                                                                 "services": {"TICK": "ultrastable-tick"}, "secrets": ["CF_DEPLOY_TOKEN"]}},
            {"id": "core", "bindings": {"d1": {"X": "ultrastable-a"}}}]}
        errs = tr.isolation(scratch(reg, topo), reg, topo)
        for frag in ("binds ultrastable-org", "binds services", "outside its scope", "daily budget", "core worker core binds ultrastable-a"):
            self.assertTrue(any(frag in e for e in errs), frag)
        reg["tenants"]["a"]["sandbox"]["budget"] = {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}
        ok = {"workers": [{"id": "w-a", "source": {"repo": "o/a"}, "bindings": {"d1": {"DB": "ultrastable-a"}}}]}
        self.assertEqual(tr.isolation(scratch(reg, ok), reg, ok), [])

    def test_retired_group_fails_when_an_app_goes_live(self):
        reg = {"org": "o", "tenants": {"s": {"repo": "o/s", "state": "retired", "source": "instances/s"}}}
        d = scratch(reg, {"workers": []}, ["instances/s/x"])
        (d / "instances/s/x/app.json").write_text(json.dumps({"status": "live"}))
        self.assertTrue(any("live again" in e for e in tr.check(d)))

    def test_every_tenant_deploys_a_public_front_end(self):
        """FULLSTACK-1: repo, back end and a public web UI; a tenant with no deployed front end fails."""
        reg = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "own-repo"}, "b": {"repo": "o/b", "state": "own-repo", "worker": "w-b"}}}
        errs = tr.check(scratch(reg, {"workers": [{"id": "w-b", "state": "live", "main": "worker/index.js"}]}))
        self.assertTrue(any(e.startswith("a:") and "front end" in e for e in errs))
        self.assertTrue(any(e.startswith("b:") and "public route" in e for e in errs))
        reg["tenants"]["a"]["frontend"] = "https://a.example.org"
        reg["tenants"]["b"]["sandbox"] = {"budget": {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}}
        ok = tr.check(scratch(reg, {"workers": [{"id": "w-b", "state": "live", "routes": ["b.example.org"], "main": "worker/index.js"}]}))
        self.assertEqual(ok, [])

    def test_prepare_vendors_core_files_and_rewrites_imports(self):
        d = _repo.scratch()
        (d / "worker").mkdir()
        (d / "worker/index.js").write_text('import M from "../../../doctrine/models.json" with { type: "json" };\nexport default M;\n')
        out = tr.prepare(d, "unlearn", ROOT)
        self.assertTrue((d / "vendor/ultrastable/models.json").exists())
        src = (d / "worker/index.js").read_text()
        self.assertIn('"../vendor/ultrastable/models.json"', src)
        self.assertNotIn("doctrine/models.json", src)
        self.assertTrue(any(line.startswith("rewrote import") for line in out))
        self.assertIn('"type": "module"', (d / "package.json").read_text())
        self.assertIn("Unlearn", (d / "AGENTS.md").read_text())

    def test_behind_compares_tenant_main_with_the_last_deployed_commit(self):
        reg = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "moved", "worker": "w-a"}}}
        d = scratch(reg, {"workers": []})
        (d / "ops").mkdir()
        (d / "ops/deploys.jsonl").write_text(json.dumps({"worker": "w-a", "live_matches_commit": True, "source_sha": "s1"}) + "\n")
        self.assertEqual(tr.behind(d, head=lambda repo: "s1"), [])
        self.assertEqual(tr.behind(d, head=lambda repo: "s2"), ["w-a"])


if __name__ == "__main__":
    unittest.main()


class TenantRepoProbe(unittest.TestCase):
    """The gate tenant-repo-unlearn closes on `tenantrepos --probe unlearn`: it passes only when the tenant's own repository has a main."""
    def test_probe_follows_the_tenant_repository_head(self):
        real = tr._gh_head
        try:
            tr._gh_head = lambda repo: ""
            self.assertEqual(tr.main(["--probe", "unlearn"]), 1)
            tr._gh_head = lambda repo: "a" * 40
            self.assertEqual(tr.main(["--probe", "unlearn"]), 0)
            self.assertEqual(tr.main(["--probe", "no-such-tenant"]), 1)
        finally:
            tr._gh_head = real


class TenantHealth(unittest.TestCase):
    """TENANT-HEALTH-1: liveness alone hid What Works' launch (clock ticking, every index refusing); a part reporting ok false fails."""
    def test_problems(self):
        self.assertEqual(tr.health_problems({"ok": True, "evidence": {"ok": True}}), [])
        p = tr.health_problems({"ok": True, "evidence": {"ok": False, "programmes_checked_6h": 0}})
        self.assertEqual(len(p), 1); self.assertIn("evidence not ok", p[0])
        self.assertEqual(len(tr.health_problems({"ok": False, "clock": "stopped"})), 1)
        self.assertEqual(len(tr.health_problems("nope")), 1)

    def test_health_reads_every_live_tenant_and_counts_unreadable_as_failure(self):
        reg = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "moved", "worker": "w-a"}, "b": {"repo": "o/b", "state": "moved", "worker": "w-b"},
                                         "c": {"repo": "o/c", "state": "moving", "worker": "w-c"}}}
        d = scratch(reg, {"workers": [{"id": "w-a", "routes": ["a.example.org"]}]})
        def fetch(url):
            if url == "https://a.example.org/health":
                return {"ok": True}
            raise OSError("refused")
        r = tr.health(d, fetch=fetch)
        self.assertEqual(sorted(r), ["a", "b"])
        self.assertTrue(r["a"]["ok"]); self.assertFalse(r["b"]["ok"]); self.assertIn("w-b.ultrastable.workers.dev", r["b"]["url"])

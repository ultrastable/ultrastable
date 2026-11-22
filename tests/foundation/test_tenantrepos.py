# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""TENANT-REPO-1: every tenant app lives in its own repository; the core keeps the manifest and builds the worker from the tenant repository."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from foundation import tenantrepos as tr

ROOT = Path(__file__).resolve().parents[2]


def scratch(reg, topo, dirs=()):
    d = Path(tempfile.mkdtemp())
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
        reg = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "moved", "source": "instances/a", "worker": "w-a"}}}
        d = scratch(reg, {"workers": [{"id": "w-a", "main": "worker/index.js"}]}, ["instances/a/worker"])
        errs = tr.check(d)
        self.assertTrue(any("still in the core" in e for e in errs))
        self.assertTrue(any("does not build from o/a" in e for e in errs))
        d2 = scratch(reg, {"workers": [{"id": "w-a", "main": "worker/index.js", "source": {"repo": "o/a"}}]}, ["instances/a"])
        self.assertEqual(tr.check(d2), [])

    def test_prepare_vendors_core_files_and_rewrites_imports(self):
        d = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / "instances/unlearn/worker", d / "worker")
        out = tr.prepare(d, "unlearn", ROOT)
        self.assertTrue((d / "vendor/ultrastable/models.json").exists())
        src = (d / "worker/index.js").read_text()
        self.assertIn('"../vendor/ultrastable/models.json"', src)
        self.assertNotIn("doctrine/models.json", src)
        self.assertTrue(any(line.startswith("rewrote import") for line in out))

    def test_behind_compares_tenant_main_with_the_last_deployed_commit(self):
        reg = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "moved", "worker": "w-a"}}}
        d = scratch(reg, {"workers": []})
        (d / "ops").mkdir()
        (d / "ops/deploys.jsonl").write_text(json.dumps({"worker": "w-a", "live_matches_commit": True, "source_sha": "s1"}) + "\n")
        self.assertEqual(tr.behind(d, head=lambda repo: "s1"), [])
        self.assertEqual(tr.behind(d, head=lambda repo: "s2"), ["w-a"])


if __name__ == "__main__":
    unittest.main()

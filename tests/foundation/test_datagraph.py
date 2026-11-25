# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""DATAGRAPH-1: every system keeps a knowledge graph of all its data; a new system without one, a drifted vendor copy or an unwired seed step fails."""
import json, shutil, unittest
from pathlib import Path
import _repo  # noqa: E402  (tests/foundation is on sys.path under discover)
from foundation import datagraph

REPO = Path(__file__).resolve().parents[2]
POL = json.loads((REPO / datagraph.POLICY).read_text())
FILES = [datagraph.POLICY, "instances/ultrastable/progress.json", "doctrine/tenant-repos.json", "seed/worker/src/index.js", "seed/worker/migrations/index.json",
         datagraph.RESEARCH, POL["core_module"], POL["seed_vendor"], POL["seed_step"], POL["migration"], *POL["rule_files"], "seed/worker/src/knowledge.js"] + [f"docs/issues/{r['item']}.json" for r in POL["systems"].values() if r.get("item")]


class DataGraph(unittest.TestCase):
    def setUp(self):
        self.tmp = _repo.scratch()
        for f in FILES:
            (self.tmp / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / f, self.tmp / f)

    def edit(self, rel, fn):
        p = self.tmp / rel
        d = json.loads(p.read_text())
        fn(d)
        p.write_text(json.dumps(d))

    def test_repo_passes(self):
        self.assertEqual(datagraph.check(REPO), [])

    def test_new_system_without_a_graph_fails(self):
        self.edit("instances/ultrastable/progress.json", lambda d: d["systems"].append({"id": "newbie", "repo": "x/y"}))
        self.assertTrue(any("newbie" in b for b in datagraph.check(self.tmp)))

    def test_vendor_drift_fails(self):
        p = self.tmp / POL["seed_vendor"]
        p.write_text(p.read_text() + "\n// local edit\n")
        self.assertTrue(any("differs" in b for b in datagraph.check(self.tmp)))

    def test_unwired_step_fails(self):
        p = self.tmp / "seed/worker/src/index.js"
        p.write_text(p.read_text().replace("b('knowledge-graph'", "b('kg-off'"))
        self.assertTrue(any("knowledge-graph step" in b for b in datagraph.check(self.tmp)))

    def test_pending_tenant_needs_item_and_vendor(self):
        self.edit(datagraph.POLICY, lambda d: d["systems"].update({"unlearn": {"state": "pending", "item": "Q-KG-unlearn"}}))
        self.edit("doctrine/tenant-repos.json", lambda d: d["tenants"]["unlearn"]["vendor"].pop(POL["core_module"]))
        bad = datagraph.check(self.tmp)
        self.assertTrue(any("unlearn: pending with no queue item" in b for b in bad))
        self.assertTrue(any("unlearn: doctrine/tenant-repos.json does not vendor" in b for b in bad))

    def test_built_tenant_on_the_shared_engine_needs_it_vendored(self):
        self.edit("doctrine/tenant-repos.json", lambda d: d["tenants"]["unlearn"]["vendor"].pop("seed/worker/src/knowledge.js"))
        self.assertTrue(any("unlearn: doctrine/tenant-repos.json does not vendor seed/worker/src/knowledge.js" in b for b in datagraph.check(self.tmp)))


if __name__ == "__main__":
    unittest.main()

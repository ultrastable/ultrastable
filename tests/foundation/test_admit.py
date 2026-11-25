# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ADMIT-1: one doctrine/tenant-repos.json row admits a tenant; every registry is derived and the check sees every live tenant."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from foundation import admit

ROOT = Path(__file__).resolve().parents[2]
FILES = ["doctrine/tenant-repos.json", "doctrine/topology.json", "doctrine/stakeholders.json", "doctrine/admission.json", "doctrine/tenant-promotion.json",
         "social/gate.json", "github/org-settings.json", "doctrine/clocks.json", "instances/ultrastable/progress.json", "instances/ultrastable/cost-budgets.json"]


class Admit(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.d = Path(tmp.name)
        for f in FILES:
            (self.d / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / f, self.d / f)
        (self.d / "instances/ultrastable/system").mkdir(parents=True, exist_ok=True)

    def j(self, rel):
        return json.loads((self.d / rel).read_text())

    def w(self, rel, data):
        (self.d / rel).write_text(json.dumps(data, indent=2) + "\n")

    def test_the_repository_itself_admits_every_live_tenant(self):
        self.assertEqual(admit.run(ROOT, fix=False), [])

    def test_one_tenant_row_bootstraps_every_registry(self):
        reg = self.j("doctrine/tenant-repos.json")
        reg["tenants"]["fresh-atlas"] = {"repo": "ultrastable/fresh-atlas", "state": "moved", "worker": "ultrastable-fresh-atlas", "description": "Fresh Atlas: a test tenant."}
        self.w("doctrine/tenant-repos.json", reg)
        topo = self.j("doctrine/topology.json")
        topo["workers"].append({"id": "ultrastable-fresh-atlas", "state": "live", "crons": ["5 * * * *"], "routes": ["fresh-atlas.ultrastable.org"]})
        self.w("doctrine/topology.json", topo)
        (self.d / "instances/ultrastable/system/ultrastable-fresh-atlas.wrangler.jsonc").write_text('{ "d1_databases": [{ "database_id": "11111111-2222-3333-4444-555555555555" }] }')
        gaps = admit.run(self.d, fix=False)
        self.assertEqual(sorted(g.split(": ")[1].split(" ")[0] for g in gaps if g.startswith("fresh-atlas")),
                         ["budget", "clock", "gate", "org-settings", "progress", "promotion", "showcase"])
        admit.run(self.d, fix=True)
        self.assertEqual(admit.run(self.d, fix=False), [])
        p = next(s for s in self.j("instances/ultrastable/progress.json")["systems"] if s["id"] == "fresh-atlas")
        self.assertEqual((p["repo"], p["url"], p["heal"]), ("ultrastable/fresh-atlas", "https://fresh-atlas.ultrastable.org/", ["ci.yml"]))
        self.assertIn("https://fresh-atlas.ultrastable.org/social-queue.json", self.j("social/gate.json")["tenant_queues"])
        self.assertFalse(self.j("github/org-settings.json")["repos"]["ultrastable/fresh-atlas"]["settings"]["private"])
        clock = next(c for c in self.j("doctrine/clocks.json")["clocks"] if c["id"] == "fresh-atlas-beat")
        self.assertEqual(clock["d1_id"], "11111111-2222-3333-4444-555555555555")
        before = {f: (self.d / f).read_text() for f in FILES}
        admit.run(self.d, fix=True)  # idempotent: a second pass writes nothing
        self.assertEqual(before, {f: (self.d / f).read_text() for f in FILES})

    def test_a_finished_move_moves_progress_to_the_tenant_repository(self):
        reg = self.j("doctrine/tenant-repos.json")
        prog = self.j("instances/ultrastable/progress.json")
        moving = [s for s, t in reg["tenants"].items() if t.get("state") == "moving" and t.get("source")]
        if not moving:
            self.skipTest("no tenant is moving")
        slug = moving[0]
        self.assertEqual(next(s for s in prog["systems"] if s["id"] == slug)["repo"], "ultrastable/ultrastable")
        reg["tenants"][slug]["state"] = "moved"
        self.w("doctrine/tenant-repos.json", reg)
        self.assertTrue(any(slug in g and "progress" in g for g in admit.run(self.d, fix=False)))
        admit.run(self.d, fix=True)
        self.assertEqual(next(s for s in self.j("instances/ultrastable/progress.json")["systems"] if s["id"] == slug)["repo"], reg["tenants"][slug]["repo"])

    def test_planned_and_retired_tenants_are_not_admitted(self):
        reg = self.j("doctrine/tenant-repos.json")
        reg["tenants"]["later"] = {"repo": "ultrastable/later", "state": "planned"}
        self.w("doctrine/tenant-repos.json", reg)
        self.assertFalse(any(g.startswith("later:") for g in admit.run(self.d, fix=False)))


if __name__ == "__main__":
    unittest.main()

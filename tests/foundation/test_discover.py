# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import discover

ROOT = Path(__file__).resolve().parents[2]


class Discover(unittest.TestCase):
    def test_repo_passes(self):
        self.assertEqual(discover.check(), [])

    def test_every_live_tenant_is_in_core(self):
        ids = {c["id"] for c in discover.core()}
        shows = {c["id"] for c in json.loads((ROOT / "doctrine/stakeholders.json").read_text())["showcases"]}
        for t in discover.live_tenants():
            if t in shows:
                self.assertIn(t, ids)

    def test_live_tenant_without_showcase_fails(self):
        with tempfile.TemporaryDirectory() as d:
            for rel in ["doctrine/tenant-repos.json", "doctrine/topology.json", "doctrine/stakeholders.json", "site/worker.js", discover.OUT,
                        "seed/worker/src/index.js", "seed/worker/src/ui.js"]:
                (Path(d) / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(ROOT / rel, Path(d) / rel)
            tr = json.loads((Path(d) / "doctrine/tenant-repos.json").read_text())
            tr["tenants"]["new-one"] = {"repo": "ultrastable/new-one", "state": "own-repo"}
            (Path(d) / "doctrine/tenant-repos.json").write_text(json.dumps(tr))
            self.assertTrue(any("new-one" in b for b in discover.check(d)))


if __name__ == "__main__":
    unittest.main()

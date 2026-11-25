# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""KGRAPH-1: every system has a row in doctrine/knowledge-graph.json and the platform half of the loop is wired."""
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import kgraph

ROOT = Path(__file__).resolve().parents[2]


class KGraph(unittest.TestCase):
    def test_repo_passes(self):
        self.assertEqual(kgraph.check(ROOT), [])

    def test_a_new_tenant_without_a_row_fails(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            for rel in ["doctrine/knowledge-graph.json", "doctrine/tenant-repos.json", "instances/ultrastable/progress.json"]:
                (d / rel).parent.mkdir(parents=True, exist_ok=True); shutil.copy(ROOT / rel, d / rel)
            t = json.loads((d / "doctrine/tenant-repos.json").read_text()); t["tenants"]["new-thing"] = {"repo": "ultrastable/new-thing"}
            (d / "doctrine/tenant-repos.json").write_text(json.dumps(t))
            bad = kgraph.check(d)
            self.assertTrue(any(b.startswith("new-thing:") for b in bad), bad)


if __name__ == "__main__":
    unittest.main()

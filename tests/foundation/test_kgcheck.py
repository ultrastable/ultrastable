# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""KGRAPH-1: every system keeps a self-maintained knowledge graph; the check fails a system with no row, a live row the vendor map does not
back, a pending row with no queue item, and a missing rule."""
import json, shutil, tempfile, unittest
from pathlib import Path
import _repo
from foundation import kgcheck

REPO = Path(__file__).resolve().parents[2]
FILES = ["doctrine/knowledge-graph.json", "doctrine/tenant-repos.json", "instances/ultrastable/progress.json", "seed/worker/src/knowledge.js",
         "seed/worker/src/tick.js", "seed/worker/src/index.js", *kgcheck.RULE_FILES]


class KgCheck(unittest.TestCase):
    def setUp(self):
        self.root = _repo.scratch()
        for f in FILES:
            (self.root / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / f, self.root / f)
        for p in (REPO / "docs/issues").glob("Q-KG-*.json"):
            (self.root / "docs/issues").mkdir(parents=True, exist_ok=True)
            shutil.copy(p, self.root / "docs/issues" / p.name)

    def tearDown(self):
        shutil.rmtree(self.root)

    def edit(self, rel, fn):
        p = self.root / rel
        d = json.loads(p.read_text())
        fn(d)
        p.write_text(json.dumps(d))

    def test_repo_passes(self):
        self.assertEqual(kgcheck.check(REPO), [])

    def test_system_without_row_fails(self):
        self.edit("doctrine/knowledge-graph.json", lambda d: d["systems"].pop("what-works"))
        self.assertTrue(any("what-works" in b and "no row" in b for b in kgcheck.check(self.root)))

    def test_live_without_vendored_engine_fails(self):
        self.edit("doctrine/tenant-repos.json", lambda d: d["tenants"]["unlearn"]["vendor"].pop("seed/worker/src/knowledge.js"))
        self.assertTrue(any("unlearn" in b and "vendor" in b for b in kgcheck.check(self.root)))

    def test_pending_without_item_fails(self):
        self.edit("doctrine/knowledge-graph.json", lambda d: d["systems"].update({"what-works": {"state": "pending", "item": "Q-KG-what-works"}}))
        (self.root / "docs/issues/Q-KG-what-works.json").unlink()
        self.assertTrue(any("what-works" in b and "queue item" in b for b in kgcheck.check(self.root)))

    def test_tick_without_step_and_missing_rule_fail(self):
        p = self.root / "seed/worker/src/tick.js"
        p.write_text(p.read_text().replace("'knowledge'", "'knowl'"))
        (self.root / "agents/PROJECT-INSTRUCTIONS.md").write_text("no rule here")
        bad = kgcheck.check(self.root)
        self.assertTrue(any("knowledge step" in b for b in bad))
        self.assertTrue(any("PROJECT-INSTRUCTIONS" in b for b in bad))


if __name__ == "__main__":
    unittest.main()

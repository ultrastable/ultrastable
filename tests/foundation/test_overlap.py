# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OVERLAP-1: the four parallel knowledge-graph PRs of 2026-11-25, as they were, are caught; ordinary parallel work is not."""
import unittest
from foundation import overlap

# The added files of #2151, #2157, #2158 and #2166 (trimmed), with their real titles and creation times.
KG = [
    {"number": 2151, "title": "Knowledge graphs: tenants map their own records with the shared engine (DATAGRAPH-1 built rows)", "created_at": "2026-11-25T16:11:43Z",
     "added": ["doctrine/writeback/decision-2026-11-25-kgraph-1.json", "seed/worker/src/knowledge.js", "seed/worker/test/knowledge.test.js"]},
    {"number": 2157, "title": "KGRAPH-1: every Ultrastable system keeps a knowledge graph of all its data", "created_at": "2026-11-25T16:14:32Z",
     "added": ["doctrine/knowledge-graph.json", "foundation/kgraph.py", "seed/worker/migrations/0031_kgraph.sql", "seed/worker/src/kgraph.js", "ops/kgraph/leads.jsonl"]},
    {"number": 2158, "title": "DATAGRAPH-1: every system keeps a knowledge graph of all its data", "created_at": "2026-11-25T16:17:11Z",
     "added": ["docs/issues/Q-KG-what-works.json", "doctrine/knowledge-graph.json", "foundation/datagraph.py", "seed/worker/migrations/0031_datagraph.sql"]},
    {"number": 2166, "title": "KGRAPH-1: a knowledge graph in every system, with its own insight loop", "created_at": "2026-11-25T16:28:35Z",
     "added": ["doctrine/kgraph.json", "foundation/kgraph.py", "ops/kgraph/leads.jsonl", "seed/worker/migrations/0031_graph.sql"]},
]
for p in KG:
    p["files"] = p["added"]


class Overlap(unittest.TestCase):
    def test_the_knowledge_graph_race_is_caught(self):
        c = overlap.collisions(KG)
        kinds = {(x["earlier"], x["later"], x["kind"]) for x in c}
        self.assertIn((2157, 2158, "same-new-file"), kinds)      # doctrine/knowledge-graph.json
        self.assertIn((2157, 2158, "same-migration"), kinds)     # 0031
        self.assertIn((2157, 2166, "same-migration"), kinds)
        self.assertIn((2157, 2166, "same-new-file"), kinds)      # foundation/kgraph.py
        self.assertIn((2157, 2166, "same-item"), kinds)          # KGRAPH-1
        self.assertFalse(any(x["later"] == 2157 for x in c), "the earliest PR keeps the work")
        self.assertFalse(any("ops/kgraph/leads.jsonl" in x["detail"] for x in c), "append-only ledgers are the lane's merge job")

    def test_ordinary_parallel_work_is_not_a_collision(self):
        a = {"number": 1, "title": "Fix the paper chooser (PAPER-2)", "created_at": "1", "added": ["docs/issues/Q-1.json", "ops/x.jsonl"], "files": ["foundation/thought.py"]}
        b = {"number": 2, "title": "Add sitemap to the ledger (FIND-3)", "created_at": "2", "added": ["docs/issues/Q-2.json", "site/sitemap.js"], "files": ["site/worker.js"]}
        self.assertEqual(overlap.collisions([a, b]), [])

    def test_intent_finds_the_work_already_open(self):
        hits = overlap.related("knowledge graph engine for every system", KG)
        self.assertGreaterEqual(len(hits), 3)
        self.assertEqual(overlap.related("white paper social posts", KG), [])


if __name__ == "__main__":
    unittest.main()

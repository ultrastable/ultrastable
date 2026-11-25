# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COLLISION-1: the knowledge-graph directive produced competing PRs that clashed on a migration number, /api/graph and a check command."""
import json, tempfile, unittest
from pathlib import Path
from foundation import collisions as c

GRAPH_A = [{"filename": "seed/worker/migrations/0031_datagraph.sql", "status": "added", "patch": ""},
           {"filename": "seed/worker/src/index.js", "status": "modified", "patch": "+    if (url.pathname === '/api/graph') return x;"},
           {"filename": "foundation/__main__.py", "status": "modified", "patch": '+    if _av[:1] == ["datagraph"]:'}]
GRAPH_B = [{"filename": "seed/worker/migrations/0031_kgraph.sql", "status": "added", "patch": ""},
           {"filename": "seed/worker/src/index.js", "status": "modified", "patch": "+    if (p === '/api/graph') return y;"},
           {"filename": "foundation/__main__.py", "status": "modified", "patch": '+    if _av[:1] == ["datagraph"]:'}]


class Collisions(unittest.TestCase):
    def test_the_repository_passes(self):
        self.assertEqual(c.check(), [])

    def test_a_new_duplicate_number_fails_and_a_gone_baseline_fails(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t); d = root / "w/migrations"; d.mkdir(parents=True); (root / "doctrine").mkdir()
            (root / "doctrine/collisions.json").write_text(json.dumps({"baseline_duplicates": {"w/migrations": ["0001"]}}))
            for n in ("0001_a.sql", "0002_b.sql", "0002_c.sql"):
                (d / n).write_text("")
            (d / "index.json").write_text(json.dumps(["0001_a.sql", "0002_b.sql", "0002_c.sql"]))
            bad = c.check(root)
            self.assertTrue(any("0002" in b for b in bad), bad)
            self.assertTrue(any("baseline duplicate 0001 is gone" in b for b in bad), bad)

    def test_index_must_match_the_directory(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t); d = root / "migrations"; d.mkdir()
            (d / "0001_a.sql").write_text(""); (d / "0002_b.sql").write_text("")
            (d / "index.json").write_text(json.dumps(["0001_a.sql"]))
            self.assertTrue(any("index.json differs" in b for b in c.check(root)))

    def test_competing_graph_prs_clash_on_number_route_and_command(self):
        got = c.clashes(c.added(GRAPH_B), c.added(GRAPH_A))
        self.assertIn("migration number seed/worker/migrations#0031", got)
        self.assertIn("route /api/graph", got)
        self.assertIn("foundation subcommand datagraph", got)

    def test_only_the_newer_pr_is_refused(self):
        pulls = {1: {"number": 1, "title": "A", "created_at": "2026-11-25T10:00:00Z", "draft": False},
                 2: {"number": 2, "title": "B", "created_at": "2026-11-25T11:00:00Z", "draft": False}}
        def api(path, token):
            if path.endswith("pulls?state=open&per_page=100"):
                return list(pulls.values())
            return pulls[int(path.rsplit("/", 1)[1])]
        files = lambda repo, n, token: GRAPH_A if n == 1 else GRAPH_B
        self.assertTrue(c.prs("o/r", 2, "", api=api, files=files))
        self.assertEqual(c.prs("o/r", 1, "", api=api, files=files), [])

    def test_claim_finds_the_holder(self):
        api = lambda path, token: [{"number": 7, "title": "DATAGRAPH-1: graph", "body": "", "head": {"ref": "claude/x"}}]
        self.assertEqual(len(c.claim("o/r", "DATAGRAPH-1", "", api=api)), 1)
        self.assertEqual(c.claim("o/r", "KGRAPH-1", "", api=api), [])


if __name__ == "__main__":
    unittest.main()

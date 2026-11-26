# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REPO-SHAPE-1: a session's change stays inside a budget, state is classified apart from code, and an oversize branch splits into a stack that carries the same tree."""
import subprocess, tempfile, unittest
from pathlib import Path
from foundation import reposhape as r

POL = {"pr_budget": {"max_files": 3, "max_added_lines": 100, "exempt_classes": ["state"], "exempt_branch_prefixes": ["agent/"]},
       "state_budget": {"max_share_of_tracked_files": 0.25, "item": "x"},
       "areas": [{"path": "seed", "class": "kernel"}, {"path": "lib", "class": "platform"}, {"path": ".", "class": "platform"},
                 {"path": "docs", "class": "docs"}, {"path": "docs/issues", "class": "state"}]}


def row(p, a=1):
    return {"path": p, "added": a, "deleted": 0}


class Shape(unittest.TestCase):
    def test_the_repository_is_fully_classified(self):
        self.assertEqual(r.check(), [])

    def test_longest_prefix_wins_and_root_files_are_claimed(self):
        self.assertEqual(r.area_of("docs/issues/Q-1.json", POL["areas"])["class"], "state")
        self.assertEqual(r.area_of("docs/a.md", POL["areas"])["class"], "docs")
        self.assertEqual(r.area_of("README.md", POL["areas"])["path"], ".")
        self.assertIsNone(r.area_of("newdir/x", POL["areas"]))

    def test_state_is_excluded_and_a_session_branch_over_budget_fails(self):
        state = [row(f"docs/issues/Q-{i}.json") for i in range(500)]
        self.assertEqual(r.pr_problems(state, POL, "ccr-x"), [])
        code = [row(f"lib/f{i}.py") for i in range(4)]
        self.assertTrue(any("4 files changed" in b for b in r.pr_problems(code, POL, "ccr-x")))
        self.assertEqual(r.pr_problems(code, POL, "agent/data-1"), [])
        lines = [row("lib/a.py", 101)]
        self.assertTrue(any("101 lines added" in b for b in r.pr_problems(lines, POL, "claude/x")))

    def test_plan_lands_kernel_first_keeps_state_apart_and_respects_the_budget(self):
        rows = [row("docs/issues/Q-1.json"), row("docs/a.md"), row("lib/b.py"), row("seed/a.js"), row("seed/b.js"), row("seed/c.js"), row("seed/d.js")]
        b = r.plan(rows, POL)
        self.assertEqual([x["class"] for x in b], ["kernel", "kernel", "platform", "docs", "state"])
        self.assertTrue(all(len(x["files"]) <= 3 for x in b))
        self.assertEqual(sorted(p for x in b for p in x["files"]), sorted(x["path"] for x in rows))

    def test_split_branches_stack_to_the_same_tree_and_leave_the_original(self):
        with tempfile.TemporaryDirectory() as t:
            def g(*a):
                return subprocess.run(["git", "-C", t, *a], capture_output=True, text=True, check=True).stdout
            g("init", "-q", "-b", "main"); g("config", "user.email", "a@b.c"); g("config", "user.name", "t")
            (Path(t) / "lib").mkdir(); (Path(t) / "lib/keep.py").write_text("1\n"); (Path(t) / "lib/gone.py").write_text("1\n")
            g("add", "-A"); g("commit", "-q", "-m", "base")
            g("checkout", "-q", "-b", "ccr-big")
            for d in ("seed", "lib", "docs"):
                (Path(t) / d).mkdir(exist_ok=True)
                for i in range(4):
                    (Path(t) / d / f"f{i}.txt").write_text(f"{d}{i}\n")
            (Path(t) / "lib/gone.py").unlink()
            g("add", "-A"); g("commit", "-q", "-m", "big")
            head = g("rev-parse", "HEAD").strip()
            rows = r.changes(t, "main...ccr-big")
            self.assertEqual(len(rows), 13)
            b = r.plan(rows, POL | {"pr_budget": POL["pr_budget"] | {"max_files": 4}})
            names = r.apply_split(t, "main...ccr-big", b)
            self.assertEqual(len(names), len(b)); self.assertGreater(len(names), 1)
            self.assertEqual(g("diff", "--name-only", names[-1], "ccr-big").split(), [])
            self.assertEqual(g("rev-parse", "ccr-big").strip(), head)
            self.assertEqual(g("rev-parse", "--abbrev-ref", "HEAD").strip(), "ccr-big")
            for n in names:
                self.assertLessEqual(len(g("diff", "--name-only", "main", n).split()) if n == names[0] else 0, 4)


if __name__ == "__main__":
    unittest.main()

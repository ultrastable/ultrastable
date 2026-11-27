# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AGENT-ENTRY-1 in the platform: the entry an agent loads is short, and the standing rules are fetched by path. Ultrastable is the foundation for any autonomous system."""
import contextlib, io, json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from foundation import agentrules as A, coldstart

REPO = Path(__file__).resolve().parents[2]


class Platform(unittest.TestCase):
    def test_both_entries_are_inside_their_budget(self):
        self.assertEqual(A.check(REPO), [])
        self.assertEqual(coldstart.check_entry(REPO), [])
        for claude in ("CLAUDE.md", "seed/CLAUDE.md"):
            self.assertEqual((REPO / claude).read_text(encoding="utf-8").strip(), "@AGENTS.md", f"{claude} loads the short entry and nothing else")
        cfg = json.loads((REPO / A.CONFIG).read_text(encoding="utf-8"))
        loaded = A.budget(REPO, cfg)["entries"]["CLAUDE.md"]
        self.assertEqual(loaded["files"], ["CLAUDE.md", "AGENTS.md"])
        self.assertLess(loaded["bytes"], cfg["max_closure_bytes"])
        self.assertLessEqual(cfg["max_closure_bytes"], 32768, "Codex stops reading project instructions at 32 KiB")

    def test_the_rule_file_is_not_loaded_but_every_rule_is_fetchable(self):
        rs = A.parse((REPO / "agents/AGENTS.md").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(rs), 100)
        self.assertEqual(len({r["id"] for r in rs}), len(rs), "one id per rule")
        self.assertNotIn("agents/AGENTS.md", A.budget(REPO, json.loads((REPO / A.CONFIG).read_text()))["entries"]["CLAUDE.md"]["files"])
        ids = lambda p: [r["id"] for _, r in A.for_paths(rs, [p])]
        self.assertIn("WORK-NOT-PULSE-1", ids("seed/worker/src/greenguard.js"))
        self.assertIn("AGENT-ENTRY-1", ids("seed/scripts/agentrules.py"))
        self.assertTrue(A.find(rs, "AGENT-ENTRY-1")[0]["checks"])

    def test_the_command_answers(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(A.main(["--check"]), 0)
            self.assertEqual(A.main(["--for", "foundation/agentrules.py"]), 0)
            self.assertEqual(A.main(["--show", "AGENT-ENTRY-1"]), 0)
        self.assertIn("agent entry ok", out.getvalue())
        self.assertIn("AGENT-ENTRY-1: An agent starts from one short file", out.getvalue())


if __name__ == "__main__":
    unittest.main()

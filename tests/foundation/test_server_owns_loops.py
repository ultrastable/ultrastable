"""SERVER-OWNS-LOOPS-1: the rule is in every agent file, and the code paths that close loops run server side with no session in them."""
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FILES = ("agents/AGENTS.md", "seed/agents/AGENTS.md")


class ServerOwnsLoops(unittest.TestCase):
    def test_rule_is_in_every_agent_file(self):
        for f in FILES:
            self.assertIn("SERVER-OWNS-LOOPS-1", (REPO / f).read_text(encoding="utf-8"), f)

    def test_lane_closes_conflicts_and_merges_without_a_session(self):
        lane = (REPO / "scripts/lane.sh").read_text(encoding="utf-8")
        self.assertIn("foundation conflicts --pr", lane)
        self.assertIn("gh pr merge", lane.replace('"$_GH_BIN" pr merge', "gh pr merge"))

    def test_lane_triggers_are_server_side_events(self):
        wf = (REPO / ".github/workflows/lane.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_run", wf)
        self.assertIn("schedule", wf)

    def test_executor_retakes_closed_prs(self):
        self.assertIn("requeued", (REPO / "foundation/conflicts.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

"""One declaration of the system and of the code agents: topology.json for the system, code-agents.json for the agents."""
import unittest
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]


class Single(unittest.TestCase):
    def test_one_system_declaration(self):
        self.assertFalse((REPO / "doctrine/system.json").exists()); self.assertFalse((REPO / "foundation/system.py").exists())
        self.assertTrue((REPO / "doctrine/topology.json").is_file())

    def test_one_agent_declaration(self):
        self.assertFalse((REPO / "doctrine/agent-ladder.json").exists()); self.assertTrue((REPO / "doctrine/code-agents.json").is_file())

    def test_agents_worker_is_in_topology(self):
        from foundation import topology
        self.assertIn("ultrastable-agents", [w["id"] for w in topology.load(REPO)["workers"]])

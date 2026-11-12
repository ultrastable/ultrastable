"""FLOW-DIRECTIVE-1: the flow declaration is complete and a dead end is caught."""
import copy, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import flows  # noqa: E402


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.d, self.loops = flows.load()

    def test_registry_passes(self):
        self.assertEqual(flows.check(d=self.d, loops=self.loops), [])

    def test_every_declared_flow_is_on_a_cycle(self):
        self.assertEqual(set(self.d["flows"]), flows.graph(self.d)["closed"])

    def test_dead_end_is_caught(self):
        d = copy.deepcopy(self.d)
        d["flows"]["merge-lane"]["outflows"] = [{"signal": "nobody.reads", "via": "github:main"}]
        bad = flows.check(d=d, loops=self.loops)
        self.assertTrue(any("nobody.reads has no consumer" in b for b in bad), bad)
        self.assertTrue(any("lies on no feedback cycle" in b for b in bad), bad)

    def test_world_outflow_must_name_its_return(self):
        d = copy.deepcopy(self.d)
        d["flows"]["site-deploy"]["outflows"][0].pop("returns")
        self.assertTrue(any("names no returning signal" in b for b in flows.check(d=d, loops=self.loops)))

    def test_undeclared_loop_fails(self):
        d = copy.deepcopy(self.d)
        d["pending"].remove("lifecycle")
        self.assertTrue(any("loop lifecycle declares no flow" in b for b in flows.check(d=d, loops=self.loops)))

    def test_declared_loop_must_leave_pending(self):
        d = copy.deepcopy(self.d)
        d["pending"].append("merge-lane")
        self.assertTrue(any("remove it from pending" in b for b in flows.check(d=d, loops=self.loops)))

    def test_workflow_with_only_pending_loops_fails(self):
        d = copy.deepcopy(self.d)
        del d["flows"]["social-post"]
        d["pending"].append("social-post")
        self.assertTrue(any("workflow social-post.yml: its loops" in b for b in flows.check(d=d, loops=self.loops)))

    def test_undeclared_binding_fails(self):
        d = copy.deepcopy(self.d)
        d["flows"]["social-post"]["bindings"] = []
        self.assertTrue(any("flow social-post: bindings" in b and "run flows --sync" in b for b in flows.check(d=d, loops=self.loops)))

    def test_every_workflow_file_is_in_the_table(self):
        names = {p.name for p in (flows.REPO / ".github/workflows").glob("*.yml")}
        rows = flows.workflow_table()
        self.assertEqual(names, {r["workflow"] for r in rows})
        self.assertTrue(all(r["declared"] and r["out"] for r in rows))

    def test_directive_in_agent_files(self):
        root = flows.REPO
        for p in ("agents/AGENTS.md", "seed/agents/AGENTS.md"):
            t = (root / p).read_text(encoding="utf-8")
            self.assertIn("FLOW-DIRECTIVE-1", t, p)
            self.assertIn("foundation flows --check", t, p)
            self.assertIn("flows --workflows", t, p)


if __name__ == "__main__":
    unittest.main()

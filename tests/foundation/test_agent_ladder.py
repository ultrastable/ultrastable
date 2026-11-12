"""SYS-2: escalation order, reviewer independence and veto, cost rows, and credential-based rung skipping, with a fake transport (no network)."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import agent_ladder as L  # noqa: E402

ENV = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"}
ALL = {**ENV, "ANTHROPIC_API_KEY": "k", "ROUTER_URL": "https://r", "ROUTER_KEY": "x"}


class Ladder(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()

    def test_config_is_valid(self):
        self.assertEqual(L.check(), [])

    def test_rungs_follow_credentials(self):
        self.assertEqual([r["route"] for r in L.rungs(self.d, {})], [])
        self.assertEqual({r["route"] for r in L.rungs(self.d, ENV)}, {"workers-ai"})
        self.assertEqual(len(L.rungs(self.d, ALL)), 4)

    def test_attempt_escalates_and_clamps(self):
        seen = []
        def send(rung, prompt, env):
            seen.append(rung["id"]); return '{"files": []}', {"in": 10, "out": 5}
        for a in (0, 1, 9):
            L.call("p", a, root=self.d, env=ENV, send=send)
        self.assertEqual(seen, ["cf-coder", "cf-llama70", "cf-llama70"])

    def test_unusable_reply_is_logged_and_raised(self):
        with self.assertRaises(ValueError):
            L.call("p", 0, root=self.d, env=ENV, send=lambda r, p, e: ("not json at all", {}))
        row = json.loads((Path(self.d) / L.COST).read_text().splitlines()[0])
        self.assertFalse(row["ok"])

    def test_reviewer_is_a_different_model_and_can_veto(self):
        used = []
        def send(rung, prompt, env):
            used.append(rung["model"]); return json.dumps({"approve": False, "reasons": ["tests do not test the change"]}), {}
        rv = L.review({"title": "t", "body": ""}, {"summary": "s", "files": [{"path": "a.py", "content": "x"}]}, "@cf/qwen/qwen2.5-coder-32b-instruct", root=self.d, env=ENV, send=send)
        self.assertFalse(rv["approve"]); self.assertIn("tests do not test", rv["reasons"][0])
        self.assertNotEqual(used[0], "@cf/qwen/qwen2.5-coder-32b-instruct")

    def test_flaky_reviewer_does_not_block(self):
        def send(rung, prompt, env):
            raise OSError("down")
        rv = L.review({"title": "t"}, {"files": []}, "m", root=self.d, env=ENV, send=send)
        self.assertTrue(rv["approve"]); self.assertIn("skipped", rv)

    def test_cost_summary(self):
        L.call("p", 0, root=self.d, env=ENV, send=lambda r, p, e: ('{"a":1}', {"in": 1000, "out": 1000}))
        s = L.summary(self.d)
        self.assertEqual(s["calls"], 1); self.assertGreater(s["usd"], 0)


if __name__ == "__main__":
    unittest.main()

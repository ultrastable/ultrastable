"""SYS-2: escalation order over the code-agent registry, reviewer of another family with veto, cost rows, credential-based routing; fake transport, no network."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import agent_ladder as L, agents  # noqa: E402
import _repo  # noqa: E402

CF = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"}


class Ladder(unittest.TestCase):
    def setUp(self):
        self.d = str(_repo.scratch())

    def test_registry_is_valid(self):
        self.assertEqual(L.check(), [])

    def test_routing_follows_credentials_and_cost(self):
        self.assertEqual(L.rungs(self.d, {}), [])
        ids = [a["id"] for a in L.rungs(self.d, CF)]
        self.assertEqual(ids[0], "workers-ai-glm")  # cheapest known price first
        self.assertEqual(ids, [a["id"] for a in agents.route_authors(CF)])

    def test_attempt_escalates_and_clamps(self):
        seen = []
        def send(a, prompt, env):
            seen.append(a["id"]); return '{"files": []}', {"in": 10, "out": 5}
        n = len(L.rungs(self.d, CF))
        for att in (0, 1, 99):
            L.call("p", att, root=self.d, env=CF, send=send)
        expected = [a["id"] for a in L.rungs(self.d, CF)]
        self.assertEqual(seen, [expected[0], expected[1], expected[n - 1]])

    def test_unusable_reply_is_logged_and_raised(self):
        with self.assertRaises(ValueError):
            L.call("p", 0, root=self.d, env=CF, send=lambda a, p, e: ("not json at all", {}))
        self.assertFalse(json.loads((Path(self.d) / L.COST).read_text().splitlines()[0])["ok"])

    def test_reviewer_is_another_family_and_can_veto(self):
        used = []
        def send(a, prompt, env):
            used.append(a["family"]); return json.dumps({"approve": False, "reasons": ["tests do not test the change"]}), {}
        rv = L.review({"title": "t", "body": ""}, {"summary": "s", "files": [{"path": "a.py", "content": "x"}]}, "glm", root=self.d, env=CF, send=send)
        self.assertFalse(rv["approve"]); self.assertIn("tests do not test", rv["reasons"][0])
        self.assertNotEqual(used[0], "glm")

    def test_no_other_family_or_flaky_reviewer_does_not_block(self):
        rv = L.review({"title": "t"}, {"files": []}, "glm", root=self.d, env={"CLOUDFLARE_API_TOKEN": "t"}, send=lambda a, p, e: ("{}", {}))
        self.assertTrue(rv["approve"]); self.assertIn("skipped", rv)
        def boom(a, p, e):
            raise OSError("down")
        rv = L.review({"title": "t"}, {"files": []}, "glm", root=self.d, env=CF, send=boom)
        self.assertTrue(rv["approve"]); self.assertIn("skipped", rv)

    def test_cost_summary_counts_priced_calls(self):
        L.call("p", 1, root=self.d, env=CF, send=lambda a, p, e: ('{"a":1}', {"in": 1000, "out": 1000}))
        s = L.summary(self.d)
        self.assertEqual(s["calls"], 1); self.assertGreater(s["usd"], 0)


if __name__ == "__main__":
    unittest.main()

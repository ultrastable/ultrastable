"""SYS-2: escalation order over the code-agent registry, reviewer of another family with veto, cost rows, credential-based routing; fake transport, no network."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import agent_ladder as L, agents  # noqa: E402
import _repo  # noqa: E402

CF = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"}


class Ladder(unittest.TestCase):
    def setUp(self):
        self.d = str(_repo.scratch()); L.DOWN.clear()

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

    def test_a_dead_rung_is_skipped_for_the_rest_of_the_run(self):
        first = L.rungs(self.d, CF)[0]["id"]
        def boom(a, p, e):
            raise RuntimeError("non-JSON response (HTTP 200, text/plain)")
        with self.assertRaises(RuntimeError):
            L.call("p", 0, root=self.d, env=CF, send=boom)
        self.assertIn(first, L.DOWN)
        self.assertIn(agents.route_authors(CF)[0]["route"], L.DOWN)  # the whole provider route is down; with every route down the full list comes back rather than nothing
        L.DOWN.clear()

    def test_a_5xx_on_one_model_leaves_the_route_up(self):  # LADDER-ROUTE-SCOPE-1
        import urllib.error
        rs = L.rungs(self.d, CF)
        seen = []
        def send(a, p, e):
            seen.append(a["id"])
            if a["id"] == rs[0]["id"]:
                raise urllib.error.HTTPError("u", 502, "Bad Gateway", {}, None)
            return '{"files": []}', {}
        out, meta = L.call("p", 0, root=self.d, env=CF, send=send)
        self.assertEqual(seen, [rs[0]["id"], rs[1]["id"]])
        self.assertEqual(rs[1]["route"], rs[0]["route"])  # a sibling on the same route answered
        self.assertNotIn(rs[0]["route"], L.DOWN)
        L.DOWN.clear()

    def test_a_dead_rung_does_not_spend_the_attempt(self):  # LADDER-FALLTHROUGH-1
        reg = Path(self.d) / "doctrine/code-agents.json"  # the mechanism, not the provider: un-retire GitHub Models in the scratch copy
        reg.parent.mkdir(parents=True, exist_ok=True)
        d = json.loads((Path(agents.REPO) / "doctrine/code-agents.json").read_text()); [a.pop("retired", None) for a in d["adapters"]]; reg.write_text(json.dumps(d))
        GH = {**CF, "GITHUB_TOKEN": "g"}
        rs = L.rungs(self.d, GH)
        self.assertEqual(rs[0]["route"], "github-models")  # free rung first
        seen = []
        def send(a, p, e):
            seen.append(a["id"])
            if a["route"] == "github-models":
                raise RuntimeError("non-JSON response (HTTP 200, text/plain) from https://models.github.ai/inference/chat/completions: OK")
            return '{"files": []}', {}
        out, meta = L.call("p", 0, root=self.d, env=GH, send=send)
        live = [a["id"] for a in rs if a["route"] != "github-models"]
        self.assertEqual(seen, [rs[0]["id"], live[0]])  # same attempt, next live rung; the second GitHub Models rung is not tried (route down)
        self.assertEqual(meta["adapter"], live[0])
        seen.clear()
        L.call("p", 1, root=self.d, env=GH, send=send)
        self.assertEqual(seen, [live[1]])  # attempt 1 escalates among the live rungs; the cheapest live rung was not skipped
        L.DOWN.clear()

    def test_reviewer_on_a_dead_route_passes_to_the_next_family(self):
        GH = {**CF, "GITHUB_TOKEN": "g"}
        used = []
        def send(a, p, e):
            used.append(a["id"])
            if a["route"] == "github-models":
                raise RuntimeError("non-JSON response")
            return json.dumps({"approve": False, "reasons": ["breaks x"]}), {}
        rv = L.review({"title": "t"}, {"files": []}, "qwen", root=self.d, env=GH, send=send)
        self.assertFalse(rv["approve"]); self.assertNotIn("skipped", rv)
        self.assertEqual(agents.load(self.d)["adapters"][0]["route"], "github-models")
        self.assertNotEqual(rv["family"], "openai")
        L.DOWN.clear()

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

    def test_model_that_returns_the_object_not_a_string_is_handled(self):
        a = L.rungs(self.d, CF)[0]
        class R:  # transport stub at the HTTP level: the reply text is a dict
            pass
        import unittest.mock as m
        with m.patch.object(agents, "http", return_value={"result": {"response": {"summary": "s", "files": []}}}):
            text, _ = L.transport(a, "p", CF)
        self.assertEqual(json.loads(text)["summary"], "s")

    def test_cost_summary_counts_priced_calls(self):
        L.call("p", 1, root=self.d, env=CF, send=lambda a, p, e: ('{"a":1}', {"in": 1000, "out": 1000}))
        s = L.summary(self.d)
        self.assertEqual(s["calls"], 1); self.assertGreater(s["usd"], 0)


if __name__ == "__main__":
    unittest.main()

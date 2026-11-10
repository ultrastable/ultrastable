import os
import unittest

from ultrastable.agents import Result, VertexGeminiAgent, build_agent, check_pairing, model_family
from ultrastable.config import load_config
from ultrastable.engine import Engine
from ultrastable.store import Store

ITEM = {"id": "V1", "title": "t", "done_check": "d"}


class Vertex(unittest.TestCase):
    def test_stub_transport_do_and_verify(self):
        seen = []
        a = VertexGeminiAgent("r", transport=lambda p: seen.append(p) or "PASS looks right")
        res = a.do(ITEM)
        self.assertTrue(res.ok)
        self.assertTrue(a.verify(ITEM, res)[0])
        self.assertEqual(len(seen), 2)

    def test_fail_verdict_and_error(self):
        self.assertFalse(VertexGeminiAgent("r", transport=lambda p: "FAIL no").verify(ITEM, Result(True, "x"))[0])

        def boom(p):
            raise RuntimeError("down")
        self.assertIn("vertex error", VertexGeminiAgent("r", transport=boom).do(ITEM).evidence)

    def test_missing_env_is_an_error_not_a_call(self):
        for k in ("VERTEX_PROJECT", "VERTEX_ACCESS_TOKEN"):
            os.environ.pop(k, None)
        self.assertFalse(VertexGeminiAgent("r").do(ITEM).ok)

    def test_build_agent(self):
        a = build_agent({"kind": "vertex-gemini", "model": "gemini-x"}, "n")
        self.assertEqual((a.kind, a.model), ("vertex-gemini", "gemini-x"))

    def test_families_and_pairing(self):
        self.assertEqual(model_family({"kind": "vertex-gemini"}), "gemini")
        self.assertEqual(model_family({"kind": "anthropic", "model": "x"}), "claude")
        check_pairing({"kind": "anthropic"}, {"kind": "vertex-gemini"})
        check_pairing({"kind": "simulated"}, {"kind": "simulated"})
        with self.assertRaises(ValueError):
            check_pairing({"kind": "vertex-gemini"}, {"kind": "vertex-gemini", "model": "other"})

    def test_engine_rejects_same_family_pair(self):
        cfg = load_config()
        cfg["agents"]["doer"] = {"kind": "anthropic", "model": "a"}
        cfg["agents"]["reviewer"] = {"kind": "anthropic", "model": "b"}
        with self.assertRaises(ValueError):
            Engine(Store(":memory:"), cfg)
        cfg["agents"]["reviewer"] = {"kind": "vertex-gemini"}
        Engine(Store(":memory:"), cfg)


if __name__ == "__main__":
    unittest.main()

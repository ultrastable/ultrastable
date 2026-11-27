"""CODE-AGENTS-1: every adapter is invoked through a recorded transport; routing by cost; disjoint-family ensemble; fallback."""
import json, unittest
from pathlib import Path
from foundation import agents

REPO = Path(__file__).resolve().parents[2]
ENV = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "acct", "ANTHROPIC_API_KEY": "k"}
A = {a["id"]: a for a in agents.load(REPO)["adapters"]}


def fake(calls, text='{"summary":"s","files":[]}'):
    def t(url, headers, body, timeout=300):
        calls.append((url, headers, body))
        return {"content": [{"text": text}]} if "anthropic" in url else {"result": {"response": text}}
    return t


def fake_gh(calls, text='{"summary":"s","files":[]}'):
    def t(url, headers, body, timeout=300):
        calls.append((url, headers, body))
        return {"choices": [{"message": {"content": text}}]}
    return t


class Agents(unittest.TestCase):
    def test_invoke_github_models_free_tier(self):
        for i in ("github-models-gpt", "github-models-llama"):
            c = []; out = agents.invoke(A[i], "p", {"GITHUB_TOKEN": "g"}, fake_gh(c))
            self.assertEqual(c[0][0], "https://models.github.ai/inference/chat/completions"); self.assertEqual(c[0][1]["authorization"], "Bearer g"); self.assertIn("summary", out)

    def test_free_tier_prompt_is_trimmed_to_its_cap(self):
        c = []; agents.invoke(A["github-models-gpt"], "H" * 30000 + "TAIL", {"GITHUB_TOKEN": "g"}, fake_gh(c))
        sent = c[0][2]["messages"][0]["content"]; self.assertLessEqual(len(sent), 12000); self.assertTrue(sent.endswith("TAIL"))

    def test_a_retired_route_is_never_asked(self):  # ROUTE-RETIRED-1: GitHub Models shut down 2026-07-30
        self.assertEqual(agents.route_authors({"GITHUB_TOKEN": "g"}, REPO), [])
        self.assertEqual(agents.ensemble("openai", {"GITHUB_TOKEN": "g"}, REPO), [])

    def test_invoke_workers_ai_gpt_oss_and_qwen3(self):  # LADDER-WIDE-1
        for i, fam in (("workers-ai-gpt-oss", "openai"), ("workers-ai-qwen3", "qwen")):
            c = []; out = agents.invoke(A[i], "p", ENV, fake(c)); self.assertEqual(A[i]["family"], fam); self.assertIn("summary", out); self.assertIn("/ai/run/@cf/", c[0][0])

    def test_workers_ai_reply_shapes(self):  # LADDER-CONTENT-1: shapes measured live 2026-11-27
        a = A["workers-ai-glm"]
        self.assertEqual(agents.parse_text(a, {"result": {"choices": [{"message": {"content": "x"}}]}}), "x")
        self.assertEqual(json.loads(agents.parse_text(a, {"result": {"response": {"summary": "s", "files": []}}})), {"summary": "s", "files": []})  # JSON prompt: the object itself
        with self.assertRaises(ValueError) as cm:  # thinking used every token: content null, reasoning is not the answer
            agents.parse_text(a, {"result": {"choices": [{"message": {"content": None, "reasoning": "1. analyze"}, "finish_reason": "length"}]}})
        self.assertIn("length", str(cm.exception))

    def test_registry_is_clean(self):
        self.assertEqual(agents.check(REPO), [])

    def test_invoke_workers_ai_qwen_coder(self):
        c = []; out = agents.invoke(A["workers-ai-qwen-coder"], "p", ENV, fake(c))
        self.assertIn("/accounts/acct/ai/run/@cf/qwen/qwen2.5-coder-32b-instruct", c[0][0]); self.assertEqual(c[0][1]["authorization"], "Bearer t"); self.assertIn("summary", out)

    def test_invoke_workers_ai_glm_keeps_reasoning_low(self):
        c = []; agents.invoke(A["workers-ai-glm"], "p", ENV, fake(c)); self.assertEqual(c[0][2]["reasoning_effort"], "low")

    def test_invoke_workers_ai_llama(self):
        c = []; agents.invoke(A["workers-ai-llama"], "p", ENV, fake(c)); self.assertIn("llama-3.3-70b", c[0][0])

    def test_invoke_anthropic_api(self):
        c = []; agents.invoke(A["anthropic-api"], "p", ENV, fake(c)); self.assertEqual(c[0][1]["x-api-key"], "k"); self.assertEqual(c[0][2]["model"], "claude-sonnet-5-5")
        c = []; agents.invoke(A["anthropic-api-fable"], "p", ENV, fake(c)); self.assertEqual(c[0][2]["model"], "claude-fable-5-2")  # RND-1: the second-model reviewer route

    def test_claude_session_is_not_an_http_route(self):
        self.assertFalse(agents.available(A["claude-session"], ENV))
        with self.assertRaises(ValueError):
            agents.build_request(A["claude-session"], "p", ENV)

    def test_routing_cheapest_known_first_and_unavailable_dropped(self):
        ids = [a["id"] for a in agents.route_authors(ENV, REPO)]
        self.assertEqual(ids[0], "workers-ai-glm"); self.assertLess(ids.index("workers-ai-glm"), ids.index("workers-ai-llama")); self.assertEqual(ids[-1] in ("anthropic-api", "workers-ai-qwen-coder"), True)
        self.assertEqual(agents.route_authors({}, REPO), [])

    def test_ensemble_disjoint_and_never_authors_family(self):
        fams = [a["family"] for a in agents.ensemble("glm", ENV, REPO)]
        self.assertNotIn("glm", fams); self.assertEqual(len(fams), len(set(fams))); self.assertGreaterEqual(len(fams), 2)

    def test_needs_ensemble_on_risky_paths(self):
        self.assertTrue(agents.needs_ensemble(["site/auth.js"])); self.assertFalse(agents.needs_ensemble(["docs/x.md"]))

    def test_complete_falls_back_to_next_adapter(self):
        n = []
        def t(url, headers, body, timeout=300):
            n.append(url)
            if "glm" in url:
                raise OSError("model down")
            return {"result": {"response": '{"summary":"ok","files":[]}'}} if "cloudflare" in url else {"content": [{"text": '{"summary":"ok","files":[]}'}]}
        out, who = agents.complete("p", ENV, t, REPO)
        self.assertEqual(out["summary"], "ok"); self.assertNotEqual(who, "workers-ai-glm"); self.assertIn("glm", n[0])

    def test_complete_without_any_adapter_says_so(self):
        with self.assertRaises(RuntimeError):
            agents.complete("p", {}, fake([]), REPO)

    def test_review_uses_two_families(self):
        r = agents.review("diff", "claude", ENV, fake([], "no defects"), REPO)
        self.assertGreaterEqual(len({x["family"] for x in r}), 2)


if __name__ == "__main__":
    unittest.main()


class ModelsOrgFallback(unittest.TestCase):
    def test_non_json_user_endpoint_retries_org_endpoint(self):
        from foundation import agents
        calls = []

        def tr(u, h, b):
            calls.append(u)
            if len(calls) == 1:
                raise RuntimeError("non-JSON response (HTTP 200, text/plain) from x: OK")
            return {"choices": [{"message": {"content": "done"}}]}
        out = agents.invoke({"route": "github-models", "model": "m", "id": "g"}, "p", {"GITHUB_TOKEN": "t", "GITHUB_REPOSITORY_OWNER": "acme"}, tr)
        self.assertEqual(out, "done")
        self.assertIn("/orgs/acme/", calls[1])

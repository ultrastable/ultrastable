# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AI-OIDC-1, MODELS-ORG-1 on the ladder, MODELS-UA-1: the executor's code agents keep a working model when the GitHub Models user endpoint
answers 200 "OK" and the repo's Cloudflare secrets name a retired account."""
import io, json, unittest
from unittest import mock

from foundation import agents, agent_ladder

OIDC_ENV = {"ACTIONS_ID_TOKEN_REQUEST_URL": "https://token.example/?x=1", "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "rt", "GITHUB_TOKEN": "gh"}


def adapter(i):
    return next(a for a in agents.load()["adapters"] if a["id"] == i)


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class AiOidc(unittest.TestCase):
    def test_workers_ai_is_available_through_oidc_without_cloudflare_secrets(self):
        a = adapter("workers-ai-glm")
        self.assertFalse(agents.available(a, {}))
        self.assertTrue(agents.available(a, OIDC_ENV))
        self.assertIn("workers-ai-glm", [x["id"] for x in agents.route_authors(OIDC_ENV)])

    def test_request_goes_to_the_site_cf_route_with_the_oidc_token(self):
        with mock.patch("urllib.request.urlopen", return_value=_Resp(json.dumps({"value": "oidc-jwt"}).encode())):
            url, h, body = agents.build_request(adapter("workers-ai-glm"), "hi", OIDC_ENV)
        self.assertTrue(url.endswith("/__internal/cf"))
        self.assertEqual(h["authorization"], "Bearer oidc-jwt")
        self.assertEqual((h["x-cf-method"], h["x-cf-path"]), ("POST", "ai/run/@cf/zai-org/glm-4.7-flash"))
        self.assertEqual(body["messages"][0]["content"], "hi")

    def test_direct_route_kept_when_cloudflare_secrets_are_bound(self):
        env = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "acc"}
        url, h, _ = agents.build_request(adapter("workers-ai-glm"), "hi", env)
        self.assertIn("/accounts/acc/ai/run/", url)

    def test_ladder_transport_falls_back_to_the_org_models_endpoint(self):
        seen = []

        def fake(url, headers, body):
            seen.append(url)
            if "/orgs/" not in url:
                raise RuntimeError("non-JSON response (HTTP 200, text/plain) from " + url + ": OK")
            return {"choices": [{"message": {"content": "{\"files\": []}"}}], "usage": {}}

        with mock.patch.object(agents, "http", fake):
            text, _ = agent_ladder.transport(adapter("github-models-gpt"), "hi", {"GITHUB_TOKEN": "gh", "GITHUB_REPOSITORY_OWNER": "ultrastable"})
        self.assertEqual(text, "{\"files\": []}")
        self.assertEqual(len(seen), 2)
        self.assertIn("/orgs/ultrastable/", seen[1])

    def test_http_names_its_client(self):
        cap = {}

        def opener(req, timeout=0):
            cap.update({k.lower(): v for k, v in req.header_items()})
            return _Resp(b"{}")

        with mock.patch("urllib.request.urlopen", opener):
            agents.http("https://x.example", {"content-type": "application/json"}, {})
        self.assertEqual(cap.get("user-agent"), agents.UA)


if __name__ == "__main__":
    unittest.main()

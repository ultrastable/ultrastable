# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CF-ROUTE-1: read and back up the Cloudflare account with no stored Cloudflare credential in GitHub.

A workflow with `permissions: id-token: write` asks GitHub for its per-run OIDC token (audience ultrastable-deploy) and sends each Cloudflare request to the
site Worker's /__internal/cf route (site/deployer.js), which checks the token and the allow-list and forwards it with the credential only that Worker holds.
`make_api` has the same shape as foundation/backup.py's direct client, so the backup drill runs through either route."""
from __future__ import annotations
import json, os, urllib.error, urllib.parse, urllib.request

SITE = "https://ultrastable-site.ultrastable.workers.dev"
UA = "ultrastable-cf-route/1"  # Cloudflare answers 403 (error 1010) to the default Python-urllib agent


def available(env=os.environ) -> bool:
    return bool(env.get("ACTIONS_ID_TOKEN_REQUEST_URL") and env.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN"))


def oidc(env=os.environ, opener=urllib.request.urlopen) -> str:
    req = urllib.request.Request(env["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=ultrastable-deploy", headers={"authorization": "Bearer " + env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"], "user-agent": UA})
    return json.load(opener(req, timeout=20))["value"]


def make_api(env=os.environ, site=None, opener=urllib.request.urlopen):
    """api(method, path, body=None, raw=False) like backup.make_api; the path is relative to the account. Errors carry the status and path only."""
    base = (site or env.get("TARGET_SITE") or SITE).rstrip("/")

    def api(method, path, body=None, raw=False):
        data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
        h = {"authorization": "Bearer " + oidc(env, opener), "x-cf-method": method, "x-cf-path": path, "user-agent": UA,
             "content-type": "application/octet-stream" if isinstance(body, bytes) else "application/json"}
        try:
            with opener(urllib.request.Request(base + "/__internal/cf", method="POST", data=data if data is not None else b"", headers=h), timeout=120) as r:
                b = r.read()
        except urllib.error.HTTPError as e:
            raise OSError(f"{method} {path.split('?')[0]}: HTTP {e.code}") from None
        return b if raw else json.loads(b)
    return api


def reaches_account(env=os.environ, api=None) -> dict:
    """{'state': ok|invalid|unmeasured}: can the Worker's own credential list the account's D1 databases (what the backup drill and the deploys need)."""
    try:
        api = api or make_api(env)
        r = api("GET", "d1/database?per_page=1")
        return {"state": "ok" if r.get("success") else "invalid", "expires": None}
    except OSError as e:
        return {"state": "invalid" if "HTTP 401" in str(e) or "HTTP 403" in str(e) or "HTTP 9109" in str(e) else "unmeasured", "expires": None, "error": str(e)[:100]}
    except Exception as e:  # a probe failure is a result, never a crash of the watchdog
        return {"state": "unmeasured", "expires": None, "error": type(e).__name__}

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


def admin_app(env=os.environ, site=None, opener=urllib.request.urlopen, repo="ultrastable/ultrastable") -> dict:
    """APP-CRED-WATCH-1: {'state': ok|invalid|unmeasured}: can the tick Worker's administration App still read an org repository (the route tenant
    repositories, visitor apps and repo settings depend on). A dry repo-settings read through the site Worker; nothing is written."""
    base = (site or env.get("TARGET_SITE") or SITE).rstrip("/")
    try:
        body = json.dumps({"op": "repo-settings", "repo": repo, "dry": True}).encode()
        req = urllib.request.Request(base + "/__internal/launches", method="POST", data=body,
                                     headers={"authorization": "Bearer " + oidc(env, opener), "content-type": "application/json", "user-agent": UA})
        try:
            with opener(req, timeout=60) as r:
                j = json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            j = json.loads(e.read() or b"{}") if e.code in (400, 409) else {"http": e.code}
        if j.get("ok"):
            return {"state": "ok", "expires": None}
        if str(j.get("waiting_on", "")).startswith("admin-app"):
            return {"state": "invalid", "expires": None, "error": str(j.get("error", ""))[:100]}
        return {"state": "unmeasured", "expires": None, "error": str(j.get("error") or j.get("http") or "no answer")[:100]}
    except Exception as e:  # a probe failure is a result, never a crash of the watchdog
        return {"state": "unmeasured", "expires": None, "error": type(e).__name__}


TICK = "https://ultrastable-tick.ultrastable.workers.dev"


def make_ops_sink(env=os.environ, tick=None, opener=urllib.request.urlopen):
    """BACKUP-SINK-1: an `api` for the backup drill's storage calls that keeps the dumps in the private ops repository (backups/...) instead of R2.

    It answers the same R2 object calls foundation/backup.py makes (PUT, GET, DELETE of one object and a prefix listing) by sending GitHub contents requests
    to the tick Worker's /api/ops/backup route, which checks this run's OIDC token (audience ultrastable-main) and adds the org App's token."""
    import base64
    base = (tick or env.get("TICK_URL") or TICK).rstrip("/")

    def token():
        req = urllib.request.Request(env["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=ultrastable-main", headers={"authorization": "Bearer " + env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"], "user-agent": UA})
        return json.load(opener(req, timeout=20))["value"]

    def gh(method, path, body=None, accept="application/vnd.github+json", missing_ok=False):
        h = {"authorization": "Bearer " + token(), "x-gh-method": method, "x-gh-path": path, "accept": accept, "user-agent": UA, "content-type": "application/json"}
        try:
            with opener(urllib.request.Request(base + "/api/ops/backup", method="POST", data=json.dumps(body).encode() if body is not None else b"", headers=h), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 and missing_ok:
                return None
            raise OSError(f"{method} ops {path.split('?')[0]}: HTTP {e.code}") from None

    def meta(key):
        b = gh("GET", "contents/" + key, missing_ok=True)
        return json.loads(b) if b else None

    def api(method, path, body=None, raw=False):
        obj = path.split("/objects", 1)[1] if "/objects" in path else None
        if obj is None:
            raise OSError(f"{method} {path.split('?')[0]}: not a storage call")
        if obj.startswith("?"):  # listing by prefix: the files of one directory
            prefix = urllib.parse.unquote(urllib.parse.parse_qs(obj[1:]).get("prefix", [""])[0]).rstrip("/")
            m = meta(urllib.parse.quote(prefix, safe="/"))
            return {"success": True, "result": [{"key": x["path"]} for x in (m if isinstance(m, list) else []) if x.get("type") == "file"]}
        key = obj.lstrip("/")
        if method == "PUT":
            old = meta(key)
            b = {"message": "backup " + urllib.parse.unquote(key), "content": base64.b64encode(body).decode()}
            if isinstance(old, dict) and old.get("sha"):
                b["sha"] = old["sha"]
            return gh("PUT", "contents/" + key, b)
        if method == "GET":
            return gh("GET", "contents/" + key, accept="application/vnd.github.raw")
        if method == "DELETE":
            old = meta(key)
            return gh("DELETE", "contents/" + key, {"message": "backup retention " + urllib.parse.unquote(key), "sha": old["sha"]}) if isinstance(old, dict) else b""
        raise OSError(f"{method} {path.split('?')[0]}: not a storage call")
    return api

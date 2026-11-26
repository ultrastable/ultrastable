# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TOKEN-EXPIRY-1: credentials and registrations are probed for expiry before they lapse. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation credwatch --run [--apply] [--changed-file F]   probe each one; --apply writes ops/credwatch.json and files or closes Q-CRED items
  python3 -m foundation credwatch --check                             doctrine/credwatch.json is well formed
  python3 -m foundation credwatch --ledger                            CRED-EXPIRY-1 (detector credential-expiry): the recorded states in
                                                                      ops/credwatch.json; fails on a required credential not ok, any expiry
                                                                      inside warn_days, or a credential the doctrine names that was never recorded

A Cloudflare token is asked about itself (GET /user/tokens/verify returns status and expires_on); a GitHub token's expiry is the response header
github-authentication-token-expiration; a registration's expiry is data. A value is read from the environment by name and never printed or stored.
A name that is not bound is `unbound`, a probe that could not run is `unmeasured`, and neither is reported as ok.
Data: doctrine/credwatch.json. Consumers: .github/workflows/watchdog.yml, tests/foundation/test_credwatch.py."""
from __future__ import annotations
import datetime as dt, json, os, sys, urllib.request, urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/credwatch.json").read_text(encoding="utf-8"))


def _http(url: str, token: str):
    req = urllib.request.Request(url, headers={"authorization": f"Bearer {token}", "user-agent": "ultrastable-credwatch", "accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), ""


def _date(s: str | None) -> dt.date | None:
    if not s:
        return None
    s = s.strip().replace(" UTC", "").replace("Z", "")
    for f in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s[:19], f).date()
        except ValueError:
            continue
    return None


def probe(cred: dict, env=os.environ, http=_http) -> dict:
    """{'state': ok|invalid|unbound|unmeasured, 'expires': ISO date or None}; never raises and never returns the value."""
    if cred["kind"] == "cloudflare-worker-token":  # CF-ROUTE-1: the credential is the site Worker's; the check is whether it can read the account, through the OIDC route
        from . import workerroute
        return workerroute.reaches_account(env) if workerroute.available(env) else {"state": "unmeasured", "expires": None}
    if cred["kind"] == "worker-github-app":  # APP-CRED-WATCH-1: the tick Worker's administration App, read through the same OIDC route
        from . import workerroute
        return workerroute.admin_app(env) if workerroute.available(env) else {"state": "unmeasured", "expires": None}
    tok = env.get(cred["name"], "")
    if not tok:
        return {"state": "unbound", "expires": None}
    try:
        if cred["kind"] == "cloudflare-token":
            code, _, body = http("https://api.cloudflare.com/client/v4/user/tokens/verify", tok)
            if code in (401, 403):
                # An account-owned token is rejected by the user endpoint; its own verify route is the second reading before it counts as invalid.
                acct = json.load(open(os.path.join(os.path.dirname(__file__), "..", "doctrine", "cost.json"))).get("account_id", "")
                code, _, body = http(f"https://api.cloudflare.com/client/v4/accounts/{acct}/tokens/verify", tok) if acct else (code, None, "")
                if code in (401, 403):
                    return {"state": "invalid", "expires": None}
            res = (json.loads(body or "{}").get("result") or {}) if code == 200 else None
            if res is None:
                return {"state": "unmeasured", "expires": None}
            e = _date(res.get("expires_on"))
            return {"state": "ok" if res.get("status") == "active" else "invalid", "expires": e.isoformat() if e else None}
        code, headers, _ = http("https://api.github.com/rate_limit", tok)
        if code == 401:
            return {"state": "invalid", "expires": None}
        if code != 200:
            return {"state": "unmeasured", "expires": None}
        e = _date({k.lower(): v for k, v in headers.items()}.get("github-authentication-token-expiration"))
        return {"state": "ok", "expires": e.isoformat() if e else None}
    except Exception as ex:  # a probe failure is a result, not a crash of the watchdog
        return {"state": "unmeasured", "expires": None, "error": type(ex).__name__}


def assess(c: dict, today: dt.date, env=os.environ, http=_http) -> list[dict]:
    rows = []
    for cred in c["credentials"]:
        rows.append({"name": cred["name"], "what": cred["used_by"], **probe(cred, env, http), **({"optional": True} if cred.get("optional") else {})})
    for r in c["registrations"]:
        rows.append({"name": r["name"], "what": "registration" + ("" if r.get("auto_renew") else ", auto-renew off"), "state": "ok", "expires": r["expires"]})
    for r in rows:
        e = _date(r.get("expires"))
        r["days_left"] = (e - today).days if e else None
        if r["state"] == "ok" and e and r["days_left"] <= c["warn_days"]:
            r["state"] = "expired" if r["days_left"] < 0 else "expiring"
    return rows


def item(r: dict) -> dict:
    iid = f"Q-CRED-{r['name']}"
    return {"id": iid, "title": f"{iid}: {r['name']} is {r['state']}" + (f" ({r['days_left']} days left)" if r.get("days_left") is not None else ""),
            "body": f"**Owner:** staff\n**Trigger:** every watchdog run\n**Done check:** cmd:python3 -m foundation credwatch --probe {r['name']}\n**Status:** open\n\n"
                    f"TOKEN-EXPIRY-1: `{r['name']}` ({r['what']}) is {r['state']}; expiry {r.get('expires') or 'not reported'}. "
                    "Move every loop that uses it to a route that does not (GitHub's per-run token, the deploy gateway's OIDC route) and renew it through the connect flow.\n",
            "labels": ["role:staff", "credential"], "milestone": "Now", "workstream": "Reliability"}


def run(root=REPO, apply=False, today=None, env=os.environ, http=_http) -> dict:
    root = Path(root); c = cfg(root); today = today or dt.datetime.now(dt.timezone.utc).date()
    rows = assess(c, today, env, http)
    bad = [r for r in rows if r["state"] in ("invalid", "expiring", "expired") and not r.get("optional")]
    state = {"rows": [{k: r[k] for k in ("name", "state", "expires") + (("optional",) if r.get("optional") else ())} for r in rows]}  # no dates of the run: the file changes only when a state does
    out, changed = root / "ops/credwatch.json", False
    if apply:
        new = json.dumps(state, indent=1) + "\n"
        if not out.exists() or out.read_text(encoding="utf-8") != new:
            out.parent.mkdir(parents=True, exist_ok=True); out.write_text(new, encoding="utf-8"); changed = True
        for r in bad:
            p = root / "docs/issues" / f"Q-CRED-{r['name']}.json"
            if not p.exists():
                p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(item(r), indent=2) + "\n", encoding="utf-8"); changed = True
    return {"rows": rows, "bad": [r["name"] for r in bad], "changed": changed}


def probe_recorded(name: str, root=REPO) -> int:
    """Closing probe of a Q-CRED item: passes only when the last recorded state of that credential is ok."""
    p = Path(root) / "ops/credwatch.json"
    rows = json.loads(p.read_text(encoding="utf-8"))["rows"] if p.exists() else []
    st = next((r["state"] for r in rows if r["name"] == name), "unmeasured")
    print(f"{name}: {st}")
    return 0 if st == "ok" else 1


def ledger(root=REPO, today=None) -> list[str]:
    root, c = Path(root), cfg(root)
    today = today or dt.datetime.now(dt.timezone.utc).date()
    p = root / "ops/credwatch.json"
    rows = {r["name"]: r for r in (json.loads(p.read_text(encoding="utf-8"))["rows"] if p.exists() else [])}
    bad = []
    for cred in c["credentials"]:
        r = rows.get(cred["name"])
        if r is None:
            bad.append(f"{cred['name']}: never recorded by credwatch --run (unmeasured)")
        elif r["state"] != "ok" and not cred.get("optional"):
            bad.append(f"{cred['name']}: {r['state']}")
    for name, r in rows.items():
        e = _date(r.get("expires"))
        if e and (e - today).days <= c["warn_days"]:
            bad.append(f"{name}: expires {e.isoformat()} ({(e - today).days} days left, warning window {c['warn_days']})")
    return bad


def check(root=REPO) -> list[str]:
    c, bad = cfg(root), []
    for cred in c["credentials"]:
        if cred.get("kind") not in ("cloudflare-token", "github-token", "cloudflare-worker-token", "worker-github-app") or not cred.get("name") or not cred.get("used_by"):
            bad.append(f"credential {cred.get('name')}: needs name, kind and used_by")
    for r in c["registrations"]:
        if not _date(r.get("expires")):
            bad.append(f"registration {r.get('name')}: expires must be a date")
    return bad


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--check" in argv:
        bad = check()
        print("\n".join(bad) or "credwatch ok")
        return 1 if bad else 0
    if "--ledger" in argv:
        bad = ledger()
        print("\n".join(bad) or "credwatch ledger ok: every required credential ok, nothing inside its warning window")
        return 1 if bad else 0
    if "--probe" in argv:
        return probe_recorded(argv[argv.index("--probe") + 1])
    r = run(REPO, "--apply" in argv)
    if "--changed-file" in argv and r["changed"]:
        Path(argv[argv.index("--changed-file") + 1]).write_text("1", encoding="utf-8")
    print(json.dumps(r, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

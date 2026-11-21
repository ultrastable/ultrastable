# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Single Cloudflare account, as code (SINGLE-ACCOUNT-1, Rowan 2026-11-18). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation singleaccount --check    no file names the quniverse account or one of its Ultrastable assets
  python3 -m foundation singleaccount --scan     one line per match
  python3 -m foundation singleaccount --moved    exit 1 while an item in ops/account-move.json is not moved (ops/account-move.json)
  python3 -m foundation singleaccount --live     exit 1 when a live Ultrastable asset sits outside the ultrastable account (SINGLE-ACCOUNT-LIVE-1)

Rule and patterns: doctrine/single-account.json. Consumers: .github/workflows/checks.yml, doctrine/rules.json (single-account),
tests/foundation/test_singleaccount.py. The move records (deploy/transfer, the retired-account list) are the only allowed mentions.
"""
from __future__ import annotations
import fnmatch, json, os, re, sys, urllib.request, urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/single-account.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def scan(root=REPO, d: dict | None = None) -> list[str]:
    root = Path(root); d = d or load(root)
    rules = [(f["id"], re.compile(f["pattern"])) for f in d["forbidden"]]
    allow = [a["path"] for a in d["allow"]]
    out = []
    for base, dirs, names in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in d["skip_dirs"])
        for n in sorted(names):
            rel = (Path(base) / n).relative_to(root).as_posix()
            if any(fnmatch.fnmatch(rel, a) for a in allow):
                continue
            try:
                text = (Path(base) / n).read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue  # binary or unreadable: not text a rule could cite
            for i, ln in enumerate(text.splitlines(), 1):
                for rid, rx in rules:
                    if rx.search(ln):
                        out.append(f"{rel}:{i}: {rid}")
    return out


def check(root=REPO) -> list[str]:
    d = load(root); problems = scan(root, d)
    acc = json.loads((Path(root) / "deploy/cloudflare-accounts.json").read_text(encoding="utf-8"))
    if acc["target"]["id"] != d["required_account"]["id"]:
        problems.append("deploy/cloudflare-accounts.json target is not the ultrastable account")
    return problems


def moved(root=REPO) -> list[str]:
    """Items of ops/account-move.json not yet 'moved'. Closing probe of OL-20261118-1: fails while the move is unfinished."""
    d = json.loads((Path(root) / "ops/account-move.json").read_text(encoding="utf-8"))
    return [k for k, v in d["items"].items() if v != "moved"]


CF = "https://api.cloudflare.com/client/v4"
DOH = "https://cloudflare-dns.com/dns-query"


def _get(url, token=None):
    req = urllib.request.Request(url, headers={"accept": "application/dns-json" if url.startswith(DOH) else "application/json",
                                               **({"authorization": "Bearer " + token} if token else {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _cf_list(get, token, path):
    out, page = [], 1
    while True:
        j = get(f"{CF}{path}{'&' if '?' in path else '?'}per_page=50&page={page}", token)
        res = j.get("result") or []
        out += res if isinstance(res, list) else (res.get("buckets") or [])
        info = j.get("result_info") or {}
        if not isinstance(res, list) or page >= int(info.get("total_pages") or 1):
            return out
        page += 1


def live(root=REPO, get=_get, token=None) -> dict:
    """SINGLE-ACCOUNT-LIVE-1 (Rowan 2026-11-21: zero Ultrastable assets, records or anything else in quniverse).
    Route 1, no credential: every Ultrastable domain answers with the ultrastable account's name servers (public DNS over HTTPS).
    Route 2, CLOUDFLARE_API_TOKEN: every account the token can read other than the ultrastable account holds no zone, Worker, D1, KV
    namespace, R2 bucket or registration whose name matches doctrine/single-account.json `live.asset_patterns`. An account the token
    cannot see is reported as unmeasured, never as clean."""
    d = load(root)["live"]
    rx = re.compile(d["asset_patterns"])
    problems, notes = [], []
    want = set(d["expected_ns"])
    for dom in d["domains"]:
        try:
            ans = get(f"{DOH}?name={urllib.parse.quote(dom)}&type=NS").get("Answer") or []
            got = {a["data"].rstrip(".").lower() for a in ans if a.get("type") == 2}
            if got != want:
                problems.append(f"dns {dom}: name servers {sorted(got)} are not the ultrastable account's {sorted(want)}")
        except Exception as e:  # unreadable is a failure here: the domains are public
            problems.append(f"dns {dom}: unreadable ({str(e)[:80]})")
    token = token if token is not None else os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        notes.append("accounts: unmeasured (no CLOUDFLARE_API_TOKEN)")
    else:
        try:
            accts = _cf_list(get, token, "/accounts")
            others = [a for a in accts if a.get("id") != load(root)["required_account"]["id"]]
            if not others:
                notes.append("accounts: only the ultrastable account is visible to this token; other accounts unmeasured")
            for a in others:
                aid = a["id"]
                lists = {
                    "zone": [z["name"] + (f" (status {z['status']})" if z.get("status") not in (None, "active") else "") for z in _cf_list(get, token, f"/zones?account.id={aid}")],  # a moved zone shell still counts until it is gone
                    "worker": [w["id"] for w in _cf_list(get, token, f"/accounts/{aid}/workers/scripts")],
                    "d1": [x["name"] for x in _cf_list(get, token, f"/accounts/{aid}/d1/database")],
                    "kv": [x["title"] for x in _cf_list(get, token, f"/accounts/{aid}/storage/kv/namespaces")],
                    "r2": [x["name"] for x in _cf_list(get, token, f"/accounts/{aid}/r2/buckets")],
                    "registration": [x["name"] for x in _cf_list(get, token, f"/accounts/{aid}/registrar/domains")],
                }
                for kind, names in lists.items():
                    for n in names:
                        if rx.search(n):
                            problems.append(f"account {a.get('name') or aid}: {kind} {n}")
        except Exception as e:
            notes.append(f"accounts: unmeasured ({str(e)[:120]})")
        # Route 3 (Rowan 2026-11-21: "assume the Quniverse doesn't even exist anymore"): no Worker in the ultrastable account depends on
        # the retired account through a plain variable or a binding (a secret's value cannot be read; secrets are named in the record instead).
        try:
            full = load(root)
            pats = [(f["id"], re.compile(f["pattern"])) for f in full["forbidden"]]
            rid = full["required_account"]["id"]
            for w in _cf_list(get, token, f"/accounts/{rid}/workers/scripts"):
                st = get(f"{CF}/accounts/{rid}/workers/scripts/{w['id']}/settings", token).get("result") or {}
                for b in st.get("bindings") or []:
                    blob = json.dumps(b)
                    for pid, prx in pats:
                        if prx.search(blob):
                            problems.append(f"worker {w['id']} binding {b.get('name')}: {pid}")
        except Exception as e:
            notes.append(f"dependencies: unmeasured ({str(e)[:120]})")
    return {"ok": not problems, "problems": problems, "notes": notes}


def main(argv) -> int:
    if argv[:1] == ["--live"]:
        r = live()
        for p in r["problems"]:
            print("FAIL " + p)
        for n in r["notes"]:
            print("note " + n)
        print("single-account live: " + ("ok" if r["ok"] else f"{len(r['problems'])} Ultrastable asset(s) outside the ultrastable account"))
        return 0 if r["ok"] else 1
    if argv[:1] == ["--moved"]:
        left = moved()
        print("\n".join("pending: " + k for k in left) or "account move complete")
        return 1 if left else 0
    if argv[:1] == ["--scan"]:
        print("\n".join(scan()) or "no matches"); return 0
    problems = check()
    for p in problems:
        print("FAIL " + p)
    print("single-account: " + ("ok" if not problems else f"{len(problems)} reference(s) to the retired quniverse account"))
    return 1 if problems else 0

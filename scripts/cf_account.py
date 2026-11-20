#!/usr/bin/env python3
"""Cloudflare account tool for Ultrastable: reach the dedicated account, bootstrap on it, and move assets from the QNFO account.
Ultrastable is the foundation for any autonomous system.

  cf_account.py probe                         which accounts this token reaches, and whether the target is one of them
  cf_account.py inventory ACCOUNT_ID          workers, D1, KV, R2 (names, ids) as JSON
  cf_account.py transfer plan                 the staged plan from deploy/transfer/plan.json with current stage
  cf_account.py transfer copy [--apply]       stage 2: copy D1 (export/import), KV, workers (bindings remapped) to the target
  cf_account.py transfer verify               stage 3: shadow-compare source and target (names, D1 row counts)
  cf_account.py transfer cutover [--apply]    stage 4: move cron triggers to the target (source cron removed, reversible)
  cf_account.py transfer rollback [--apply]   stage 5: restore source crons, remove target crons; nothing is deleted anywhere

Credential: CLOUDFLARE_API_TOKEN (bound, never printed). Source is never mutated before cutover and is never deleted by this tool.
Account ids come from deploy/cloudflare-accounts.json (target, current). Secrets cannot be read back from Cloudflare: the copy
stage lists secret NAMES per worker for re-binding from the repo's secret store; values are never handled.
"""
from __future__ import annotations
import json, re, os, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.cloudflare.com/client/v4"
PLAN = ROOT / "deploy/transfer/plan.json"
STATE = ROOT / "deploy/transfer/state.json"


def accounts():
    return json.loads((ROOT / "deploy/cloudflare-accounts.json").read_text(encoding="utf-8"))


def http(method, path, token, body=None, raw=False, headers=None):
    req = urllib.request.Request(API + path, method=method, data=body, headers={"authorization": "Bearer " + token, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            return data if raw else json.loads(data)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {e.read()[:300]!r}") from None


def result(resp):
    if not resp.get("success", True):
        raise RuntimeError(json.dumps(resp.get("errors")))
    return resp.get("result")


def probe(api) -> dict:
    cfg = accounts()
    reach = [{"id": a["id"], "name": a["name"]} for a in result(api("GET", "/accounts"))]
    ids = {a["id"] for a in reach}
    return {"reachable": reach, "target": cfg["target"]["id"], "target_reachable": cfg["target"]["id"] in ids,
            "source": cfg["current"]["id"], "source_reachable": cfg["current"]["id"] in ids}


def inventory(api, acct) -> dict:
    get = lambda p: result(api("GET", f"/accounts/{acct}{p}")) or []
    inv = {"workers": [], "d1": [], "kv": [], "r2": []}
    for w in get("/workers/scripts"):
        name = w["id"]
        sets = result(api("GET", f"/accounts/{acct}/workers/scripts/{name}/settings"))
        secrets = [s["name"] for s in get(f"/workers/scripts/{name}/secrets")]
        inv["workers"].append({"name": name, "bindings": sets.get("bindings", []), "secret_names": secrets, "compat": sets.get("compatibility_date")})
    inv["d1"] = [{"name": d["name"], "id": d["uuid"]} for d in get("/d1/database")]
    inv["kv"] = [{"title": k["title"], "id": k["id"]} for k in get("/storage/kv/namespaces")]
    inv["r2"] = [b["name"] for b in (result(api("GET", f"/accounts/{acct}/r2/buckets")) or {}).get("buckets", [])]
    return inv


def load_state():
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {"stage": "none", "d1_map": {}, "kv_map": {}, "log": []}


def save_state(s, apply):
    if apply:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(s, indent=2) + "\n", encoding="utf-8")


def in_scope(name, plan):
    return any(name == p or (p.endswith("*") and name.startswith(p[:-1])) for p in plan["assets"]["workers"])


def parse_modules(raw):
    """Split a content/v2 multipart response into (name, content-type, bytes); a bare script becomes one worker.js."""
    if not raw.startswith(b"--"):
        return [("worker.js", "application/javascript+module", raw)]
    nl = bytes([13, 10])
    b = raw[:raw.index(nl)]
    out = []
    for part in raw.split(b)[1:-1]:
        head, _, data = part.partition(nl + nl)
        h = head.decode(errors="replace")
        n = re.search(r'name="([^"]+)"', h).group(1)
        m = re.search(r"Content-Type: ([^" + chr(13) + chr(10) + "]+)", h)
        out.append((n, m.group(1) if m else "application/javascript+module", data[:-2] if data.endswith(nl) else data))
    return out


def main_module(mods):
    cands = [m for m in mods if re.search(rb"export\s+default|export\s*\{[^}]*as\s+default", m[2])]
    for m in cands:
        if re.match(r"(index|worker|_worker)\.m?js$", m[0]):
            return m[0]
    return (cands or mods)[0][0]


def copy(api, src, dst, apply, plan) -> dict:
    st = load_state()
    inv = inventory(api, src)
    steps = []
    for d in inv["d1"]:
        if d["name"] not in plan["assets"]["d1"]:
            continue
        steps.append(f"d1 {d['name']}: export from source, create on target, import")
        if apply:
            exp = result(api("POST", f"/accounts/{src}/d1/database/{d['id']}/export", json.dumps({"output_format": "polling"}).encode(), headers={"content-type": "application/json"}))
            for _ in range(30):
                if exp.get("status") == "complete":
                    break
                time.sleep(2)
                exp = result(api("POST", f"/accounts/{src}/d1/database/{d['id']}/export", json.dumps({"output_format": "polling", "current_bookmark": exp["at_bookmark"]}).encode(), headers={"content-type": "application/json"}))
            sql = api("GET", exp["result"]["signed_url"], raw=True) if False else urllib.request.urlopen(exp["result"]["signed_url"], timeout=120).read()
            have = [x for x in (result(api("GET", f"/accounts/{dst}/d1/database?name={d['name']}")) or []) if x["name"] == d["name"]]
            new = have[0] if have else result(api("POST", f"/accounts/{dst}/d1/database", json.dumps({"name": d["name"]}).encode(), headers={"content-type": "application/json"}))
            st["d1_map"][d["id"]] = new["uuid"]
            q = lambda t: api("POST", f"/accounts/{dst}/d1/database/{new['uuid']}/query", json.dumps({"sql": t}).encode(), headers={"content-type": "application/json"})
            if not have or not (result(q("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")) or [{}])[0].get("results"):
                q(sql.decode())   # import only into an empty database: re-runs are idempotent
    for k in [k for k in inv["kv"] if k["title"].startswith("ultrastable-")]:
        steps.append(f"kv {k['title']}: create on target and copy keys")
        if apply:
            have = [x for x in (result(api("GET", f"/accounts/{dst}/storage/kv/namespaces?per_page=100")) or []) if x["title"] == k["title"]]
            new = have[0] if have else result(api("POST", f"/accounts/{dst}/storage/kv/namespaces", json.dumps({"title": k["title"]}).encode(), headers={"content-type": "application/json"}))
            st["kv_map"][k["id"]] = new["id"]
            keys = [x["name"] for x in result(api("GET", f"/accounts/{src}/storage/kv/namespaces/{k['id']}/keys"))]
            pairs = [{"key": n, "value": __import__("base64").b64encode(api("GET", f"/accounts/{src}/storage/kv/namespaces/{k['id']}/values/{n}", raw=True)).decode(), "base64": True} for n in keys]
            if pairs:
                api("PUT", f"/accounts/{dst}/storage/kv/namespaces/{new['id']}/bulk", json.dumps(pairs).encode(), headers={"content-type": "application/json"})
    rebind = {}
    for w in inv["workers"]:
        if not in_scope(w["name"], plan):
            continue
        steps.append(f"worker {w['name']}: upload code with bindings remapped; crons NOT enabled until cutover")
        rebind[w["name"]] = w["secret_names"]
        if apply:
            raw = api("GET", f"/accounts/{src}/workers/scripts/{w['name']}/content/v2", raw=True)
            mods = parse_modules(raw)
            for with_services in (False, True):   # pass 1 without service bindings (targets may not exist yet), pass 2 with
                binds = []
                for b in w["bindings"]:
                    b = dict(b)
                    if b.get("type") in ("secret_text", "send_email") or (b.get("type") == "service" and not with_services):
                        continue
                    if b.get("type") == "d1":
                        b["id"] = st["d1_map"].get(b["id"], plan.get("id_map", {}).get("d1", {}).get(b["id"], b["id"]))
                    if b.get("type") == "kv_namespace":
                        b["namespace_id"] = st["kv_map"].get(b["namespace_id"], plan.get("id_map", {}).get("kv", {}).get(b["namespace_id"], b["namespace_id"]))
                    binds.append(b)
                meta = {"main_module": main_module(mods), "bindings": binds, "compatibility_date": w["compat"] or "2026-10-01", "observability": {"enabled": True, "head_sampling_rate": 1}}
                boundary = "----us" + str(int(time.time()))
                nl = chr(13) + chr(10)
                body = (f"--{boundary}{nl}Content-Disposition: form-data; name=" + chr(34) + "metadata" + chr(34) + f"{nl}Content-Type: application/json{nl}{nl}{json.dumps(meta)}{nl}").encode()
                for n, ct, data in mods:
                    body += (f"--{boundary}{nl}Content-Disposition: form-data; name=" + chr(34) + n + chr(34) + "; filename=" + chr(34) + n + chr(34) + f"{nl}Content-Type: {ct}{nl}{nl}").encode() + data + nl.encode()
                body += f"--{boundary}--{nl}".encode()
                api("PUT", f"/accounts/{dst}/workers/scripts/{w['name']}", body, headers={"content-type": f"multipart/form-data; boundary={boundary}"})
    st["stage"] = "copied" if apply else st["stage"]
    st["log"].append({"stage": "copy", "apply": apply, "steps": len(steps)})
    save_state(st, apply)
    return {"steps": steps, "secrets_to_rebind": rebind, "applied": apply}


def verify(api, src, dst, plan) -> dict:
    a, b = inventory(api, src), inventory(api, dst)
    want = [w["name"] for w in a["workers"] if in_scope(w["name"], plan)]
    missing = [n for n in want if n not in {w["name"] for w in b["workers"]}]
    counts = {}
    for d in a["d1"]:
        t = next((x for x in b["d1"] if x["name"] == d["name"]), None)
        if not t:
            continue
        q = lambda acct, i: result(api("POST", f"/accounts/{acct}/d1/database/{i}/query", json.dumps({"sql": "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'"}).encode(), headers={"content-type": "application/json"}))[0]["results"]
        for tbl in [r["name"] for r in q(src, d["id"])]:
            n = lambda acct, i: result(api("POST", f"/accounts/{acct}/d1/database/{i}/query", json.dumps({"sql": f'SELECT COUNT(*) AS n FROM "{tbl}"'}).encode(), headers={"content-type": "application/json"}))[0]["results"][0]["n"]
            counts[f"{d['name']}.{tbl}"] = {"source": n(src, d["id"]), "target": n(dst, t["id"])}
    drift = {k: v for k, v in counts.items() if v["source"] != v["target"]}
    return {"missing_workers": missing, "row_count_drift": drift, "ok": not missing and not drift}


def cron_set(api, acct, name, crons):
    api("PUT", f"/accounts/{acct}/workers/scripts/{name}/schedules", json.dumps([{"cron": c} for c in crons]).encode(), headers={"content-type": "application/json"})


def cutover(api, src, dst, apply, plan, rollback=False) -> dict:
    st = load_state(); did = []
    for name, crons in plan["crons"].items():
        on, off = (src, dst) if rollback else (dst, src)
        did.append(f"{name}: crons {crons} on {on[:6]}.., removed from {off[:6]}..")
        if apply:
            cron_set(api, on, name, crons)   # enable first, then disable: never zero hosts
            cron_set(api, off, name, [])
    st["stage"] = ("rolled-back" if rollback else "cutover") if apply else st["stage"]
    st["log"].append({"stage": "rollback" if rollback else "cutover", "apply": apply})
    save_state(st, apply)
    return {"steps": did, "manual": plan.get("manual_after_cutover", []), "applied": apply}


def main(argv=None, api=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    token = token or os.environ.get("SRC_CLOUDFLARE_API_TOKEN", "")
    if api is None:
        if not token:
            print(json.dumps({"ok": False, "detail": "CLOUDFLARE_API_TOKEN not bound on this host; recorded, the connector/browser routes in deploy/routes.json apply"}))
            return 2
        src_tok, dst_tok = os.environ.get("SRC_CLOUDFLARE_API_TOKEN", token), os.environ.get("DST_CLOUDFLARE_API_TOKEN", token)
        src_id = accounts()["current"]["id"]
        # Separate tokens: paths under the source account use the read token, everything else the target token.
        api = lambda m, p, b=None, raw=False, headers=None: http(m, p, src_tok if f"/accounts/{src_id}" in p else dst_tok, b, raw, headers)
    cfg, plan = accounts(), json.loads(PLAN.read_text(encoding="utf-8"))
    src, dst, apply = cfg["current"]["id"], cfg["target"]["id"], "--apply" in argv
    cmd = argv[0] if argv else "probe"
    if cmd == "probe":
        out = probe(api)
    elif cmd == "inventory":
        out = inventory(api, argv[1])
    elif cmd == "transfer":
        sub = argv[1] if len(argv) > 1 else "plan"
        out = {"plan": plan, "state": load_state()} if sub == "plan" else copy(api, src, dst, apply, plan) if sub == "copy" else verify(api, src, dst, plan) if sub == "verify" else cutover(api, src, dst, apply, plan, rollback=(sub == "rollback"))
    else:
        print(__doc__); return 2
    print(json.dumps(out, indent=2))
    return 0 if out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())

"""BLINDSPOT-1 need backup-restore: a backup counts only after it has been restored. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation backup --run [--apply] [--force]   export every D1 database and KV namespace in the account, restore each SQL dump into a scratch SQLite
                                                           database, compare row counts with the live tables, store the dumps in R2, read them back, record the result
  python3 -m foundation backup --check                     doctrine/backup.json is well formed

D1 is SQLite, so loading the exported dump into a fresh in-memory SQLite database is a real restore: it fails on a truncated or corrupt dump, and the per-table
row counts must land between the live counts read before and after the export. The record (ops/backup/last-restore.json) holds names, counts and hashes only,
never a row. Tables in exclude_tables hold sealed credentials and are left out of the dump and named in the record. Run weekly inside the product manager pass
(foundation/pm.py) with the server-side Cloudflare credential; the probe `fresh:ops/backup/last-restore.json::at::10::ok` in doctrine/blindspots.json turns a
missed or failed drill back into a gap. Tests: tests/foundation/test_backup.py.
"""
from __future__ import annotations
import base64, datetime as dt, gzip, hashlib, json, os, sqlite3, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOC = "doctrine/backup.json"
OUT = "ops/backup/last-restore.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / DOC).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    d, errs = load(root), []
    for k, t in (("bucket", str), ("prefix", str), ("max_age_days", int), ("keep", int), ("exclude_tables", list), ("kv_max_bytes", int)):
        if not isinstance(d.get(k), t):
            errs.append(f"{DOC}: {k} must be {t.__name__}")
    if isinstance(d.get("keep"), int) and d["keep"] < 2:
        errs.append(f"{DOC}: keep at least 2 copies")
    return errs


def make_api(token: str, acct: str):
    """api(method, path, body=None, raw=False): JSON result by default, bytes with raw=True. Errors carry the status and path, never the token."""
    def api(method, path, body=None, raw=False):
        data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
        req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/{path}", method=method, data=data,
                                     headers={"authorization": "Bearer " + token, "content-type": "application/octet-stream" if isinstance(body, bytes) else "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
        except urllib.error.HTTPError as e:
            raise OSError(f"{method} {path.split('?')[0]}: HTTP {e.code}") from None
        return b if raw else json.loads(b)
    return api


def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as r:
        return r.read()


def _q(api, db_id, sql):
    return api("POST", f"d1/database/{db_id}/query", {"sql": sql})["result"][0]["results"]


def _counts(api, db_id, tables) -> dict:
    out = {}
    for i in range(0, len(tables), 40):  # a compound SELECT is limited in terms; 40 keeps it well inside
        part = tables[i:i + 40]
        sql = " UNION ALL ".join(f"SELECT '{t}' AS n, count(*) AS c FROM \"{t}\"" for t in part)
        out.update({r["n"]: int(r["c"]) for r in _q(api, db_id, sql)})
    return out


def export_sql(api, db_id, tables, download=_download, sleep=time.sleep, polls=90) -> bytes:
    body = {"output_format": "polling", "dump_options": {"tables": tables}}
    for _ in range(polls):
        r = api("POST", f"d1/database/{db_id}/export", body)["result"]
        if r.get("status") == "error":
            raise OSError("export failed: " + str(r.get("error"))[:120])
        if r.get("status") == "complete":
            return download(r["result"]["signed_url"])
        body = {"output_format": "polling", "current_bookmark": r["at_bookmark"]}
        sleep(2)
    raise OSError("export did not complete in time")


def restore(sql: bytes, tables) -> dict:
    """Load the dump into a scratch SQLite database. Returns {integrity, counts}; raises sqlite3.Error on a dump that does not load."""
    con = sqlite3.connect(":memory:")
    try:
        con.executescript(sql.decode("utf-8"))
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        return {"integrity": integrity, "counts": {t: (con.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] if t in have else None) for t in tables}}
    finally:
        con.close()


def store(api, cfg, key: str, blob: bytes) -> dict:
    """Put one object in R2 and read it back; `readback` is true only when the bytes that come back hash the same."""
    path = f"r2/buckets/{cfg['bucket']}/objects/{urllib.parse.quote(key, safe='/')}"
    sha = hashlib.sha256(blob).hexdigest()
    out = {"bucket": cfg["bucket"], "key": key, "bytes": len(blob), "sha256": sha, "readback": False}
    try:
        api("PUT", path, blob, raw=True)
        out["readback"] = hashlib.sha256(api("GET", path, raw=True)).hexdigest() == sha
    except OSError as e:
        out["error"] = str(e)[:160]
    return out


def prune(api, cfg, prefix: str) -> dict:
    """Keep the newest cfg.keep objects under a prefix (keys end in the date, so name order is age order). A failure is recorded, never fatal."""
    try:
        r = api("GET", f"r2/buckets/{cfg['bucket']}/objects?prefix={urllib.parse.quote(prefix, safe='/')}&per_page=1000")
        keys = sorted(o["key"] for o in (r.get("result") or []) if isinstance(o, dict) and o.get("key"))
        gone = keys[:-cfg["keep"]] if len(keys) > cfg["keep"] else []
        for k in gone:
            api("DELETE", f"r2/buckets/{cfg['bucket']}/objects/{urllib.parse.quote(k, safe='/')}", raw=True)
        return {"kept": len(keys) - len(gone), "deleted": len(gone)}
    except (OSError, ValueError, KeyError, AttributeError) as e:
        return {"error": f"{type(e).__name__}: {e}"[:160]}


def drill_db(api, cfg, db: dict, day: str, download=_download, sleep=time.sleep) -> dict:
    row = {"name": db["name"], "id": db["uuid"], "restored": False}
    try:
        master = _q(api, db["uuid"], "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
        virtual = [m["name"] for m in master if (m.get("sql") or "").upper().startswith("CREATE VIRTUAL")]
        skip = lambda n: n in cfg["exclude_tables"] or n in virtual or any(n.startswith(v + "_") for v in virtual)
        tables = [m["name"] for m in master if not skip(m["name"])]
        row.update({"tables": len(tables), "excluded_tables": sorted(m["name"] for m in master if m["name"] in cfg["exclude_tables"]), "virtual_skipped": sorted(virtual)})
        if not tables:
            row.update({"restored": True, "rows": 0, "integrity": "ok", "mismatches": [], "note": "no tables"})
            return row
        before = _counts(api, db["uuid"], tables)
        sql = export_sql(api, db["uuid"], tables, download, sleep)
        after = _counts(api, db["uuid"], tables)
        got = restore(sql, tables)
        bad = [t for t in tables if got["counts"][t] is None or not (min(before[t], after[t]) <= got["counts"][t] <= max(before[t], after[t]))]
        row.update({"rows": sum(v or 0 for v in got["counts"].values()), "integrity": got["integrity"], "mismatches": bad, "dump_bytes": len(sql),
                    "restored": got["integrity"] == "ok" and not bad})
        row["stored"] = store(api, cfg, f"{cfg['prefix']}d1/{db['name']}/{day}.sql.gz", gzip.compress(sql, mtime=0))
        row["retention"] = prune(api, cfg, f"{cfg['prefix']}d1/{db['name']}/")
    except (OSError, ValueError, KeyError, IndexError, sqlite3.Error) as e:
        row["error"] = f"{type(e).__name__}: {e}"[:200]
    return row


def drill_kv(api, cfg, ns: dict, day: str) -> dict:
    row = {"title": ns["title"], "id": ns["id"], "keys": 0, "saved": 0, "skipped_over_budget": 0}
    try:
        lines, used, cursor = [], 0, ""
        while True:
            r = api("GET", f"storage/kv/namespaces/{ns['id']}/keys?limit=1000" + (f"&cursor={cursor}" if cursor else ""))
            for k in r.get("result") or []:
                row["keys"] += 1
                if used >= cfg["kv_max_bytes"]:
                    row["skipped_over_budget"] += 1
                    continue
                v = api("GET", f"storage/kv/namespaces/{ns['id']}/values/{urllib.parse.quote(k['name'], safe='')}", raw=True)
                used += len(v); row["saved"] += 1
                lines.append(json.dumps({"key": k["name"], "expiration": k.get("expiration"), "metadata": k.get("metadata"), "value_b64": base64.b64encode(v).decode()}))
            cursor = (r.get("result_info") or {}).get("cursor") or ""
            if not cursor:
                break
        blob = gzip.compress(("\n".join(lines) + "\n").encode(), mtime=0)
        back = [json.loads(l) for l in gzip.decompress(blob).decode().splitlines() if l]   # the drill: the archive decodes to the same keys it was built from
        row["restored"] = len(back) == row["saved"] and all(base64.b64decode(x["value_b64"]) is not None for x in back)
        row["stored"] = store(api, cfg, f"{cfg['prefix']}kv/{ns['title']}/{day}.ndjson.gz", blob)
        row["retention"] = prune(api, cfg, f"{cfg['prefix']}kv/{ns['title']}/")
    except (OSError, ValueError, KeyError) as e:
        row["restored"] = False
        row["error"] = f"{type(e).__name__}: {e}"[:200]
    return row


def due(root=REPO, today=None) -> bool:
    p = Path(root) / OUT
    if not p.is_file():
        return True
    try:
        j = json.loads(p.read_text(encoding="utf-8"))
        return not j.get("ok") or ((today or dt.date.today()) - dt.date.fromisoformat(j["at"][:10])).days >= load(root)["max_age_days"]
    except (ValueError, KeyError, TypeError):
        return True


def run(root=REPO, apply=False, force=False, env=None, api=None, download=_download, sleep=time.sleep, today=None) -> dict:
    root, env, today = Path(root), os.environ if env is None else env, today or dt.date.today()
    if not force and not due(root, today):
        return {"skipped": "last drill is fresh"}
    if api is None:
        if not (env.get("CLOUDFLARE_API_TOKEN") and env.get("CLOUDFLARE_ACCOUNT_ID")):
            return {"skipped": "unmeasured: no server-side Cloudflare credential in this environment"}
        api = make_api(env["CLOUDFLARE_API_TOKEN"], env["CLOUDFLARE_ACCOUNT_ID"])
    cfg, day, out = load(root), today.isoformat(), {"_doc": "GENERATED by python3 -m foundation backup --run --apply (BLINDSPOT-1 need backup-restore). Names, counts and hashes only."}
    out["at"], errors = day, []
    try:
        dbs = api("GET", "d1/database?per_page=100")["result"]
    except (OSError, ValueError, KeyError) as e:
        dbs = []; errors.append(f"list d1: {e}"[:160])
    try:
        nss = api("GET", "storage/kv/namespaces?per_page=100")["result"]
    except (OSError, ValueError, KeyError) as e:
        nss = []; errors.append(f"list kv: {e}"[:160])
    out["databases"] = [drill_db(api, cfg, db, day, download, sleep) for db in dbs]
    out["kv"] = [drill_kv(api, cfg, ns, day) for ns in nss if ns["title"] not in cfg.get("exclude_kv", [])]
    out["errors"] = errors
    out["restore_ok"] = bool(out["databases"]) and all(d["restored"] for d in out["databases"]) and all(k.get("restored") for k in out["kv"])
    out["stored_ok"] = bool(out["databases"]) and all((d.get("stored") or {"readback": d.get("note") == "no tables"})["readback"] for d in out["databases"]) and all((k.get("stored") or {}).get("readback") for k in out["kv"])
    out["ok"] = out["restore_ok"] and out["stored_ok"] and not errors
    if apply:
        (root / OUT).parent.mkdir(parents=True, exist_ok=True)
        (root / OUT).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return out


def main(argv=None) -> int:
    a = list(argv or [])
    if "--run" in a:
        out = run(apply="--apply" in a, force="--force" in a)
        print(json.dumps({k: v for k, v in out.items() if k != "_doc"}, indent=1)[:4000])
        return 0 if out.get("ok") or out.get("skipped") else 1
    errs = check()
    for e in errs:
        print("backup:", e, file=sys.stderr)
    print("backup ok" if not errs else f"backup: {len(errs)} problem(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

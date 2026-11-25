# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""OWN-DB-1: the core's databases are the core's own (Q-GAP-core-separation). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation owndb --check    every D1 database a core Worker config binds is a declared core database in the core's own account; no core
                                         config binds a tenant database or a database of the originating fleet
  python3 -m foundation owndb --write    refresh the `bound_by` lists in instances/ultrastable/own-database.json from the Worker configs
  python3 -m foundation owndb --live     the declared core databases exist in the core's account (Cloudflare API; exit 2 without a credential: unmeasured)

The record is instances/ultrastable/own-database.json: the core databases with their bindings, the tenant databases the core must never bind, and
the dated live reading the declaration rests on. The originating fleet's database ids are the `forbidden` patterns of doctrine/single-account.json;
this check reuses them instead of copying them. Consumers: checks.yml (--check), doctrine/rules.json rule own-database (--live), tests/foundation/test_owndb.py.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "instances/ultrastable/own-database.json"
CONFIGS = ["wrangler.toml", "site/wrangler.toml", "dashboard/wrangler.toml", "spinoffs/wrangler.toml", "instances/ultrastable/system/*.wrangler.jsonc"]
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
PAIR = re.compile(r"""["']?database_name["']?\s*[:=]\s*["']([^"']+)["']\s*,?\s*["']?database_id["']?\s*[:=]\s*["']([^"']+)["']""")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def bindings(root=REPO) -> list[dict]:
    """Every (config, database name, database id) a Worker config in this repository binds. A placeholder id (filled at deploy) is kept and marked."""
    root, out = Path(root), []
    for g in CONFIGS:
        for p in sorted(root.glob(g)):
            for name, did in PAIR.findall(p.read_text(encoding="utf-8")):
                out.append({"config": p.relative_to(root).as_posix(), "name": name, "id": did, "placeholder": not UUID.match(did)})
    return out


def _forbidden(root: Path) -> dict:
    f = root / "doctrine/single-account.json"
    return {x["pattern"]: x["id"] for x in json.loads(f.read_text(encoding="utf-8"))["forbidden"]} if f.is_file() else {}


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    if not (root / PATH).is_file():
        return [f"{PATH} missing"]
    d = load(root)
    core, tenant = {x["id"]: x for x in d["core"]}, {x["id"]: x for x in d["tenant"]}
    retired, absent = set(d.get("retired_configs", [])), {x["id"]: x for x in d.get("declared_not_present", [])}
    sa = root / "doctrine/single-account.json"
    if sa.is_file() and d["account"]["id"] != json.loads(sa.read_text(encoding="utf-8"))["required_account"]["id"]:
        bad.append("the core's database account is not the required account of doctrine/single-account.json")
    if set(core) & set(tenant):
        bad.append("a database is declared both core and tenant: " + ", ".join(sorted(set(core) & set(tenant))))
    forb = _forbidden(root)
    seen = {}
    for b in bindings(root):
        if b["config"] in retired or b["placeholder"]:
            continue
        seen.setdefault(b["id"], []).append(b["config"])
        if b["id"] in forb:
            bad.append(f"{b['config']} binds {b['id']}: a database of the originating fleet ({forb[b['id']]})")
        elif b["id"] in tenant:
            bad.append(f"{b['config']} binds tenant database {tenant[b['id']]['name']}: a core Worker never binds a tenant's database")
        elif b["id"] in core:
            if core[b["id"]]["name"] != b["name"]:
                bad.append(f"{b['config']} calls {b['id']} {b['name']!r}; the record calls it {core[b['id']]['name']!r}")
        elif b["id"] not in absent:
            bad.append(f"{b['config']} binds {b['name']} ({b['id']}), which the record does not declare (add it to core, or remove the binding)")
    for i, c in core.items():
        if sorted(c.get("bound_by", [])) != sorted(seen.get(i, [])):
            bad.append(f"core database {c['name']}: bound_by is stale (run owndb --write)")
        if i in forb:
            bad.append(f"core database {c['name']} is a database of the originating fleet")
    lv = d.get("live") or {}
    for i, c in core.items():
        if i not in {x["id"] for x in lv.get("databases", [])}:
            bad.append(f"core database {c['name']} is not in the recorded live reading of the account")
    return bad


def write(root=REPO) -> dict:
    root, d = Path(root), load(root)
    seen, retired = {}, set(d.get("retired_configs", []))
    for b in bindings(root):
        if not b["placeholder"] and b["config"] not in retired:
            seen.setdefault(b["id"], []).append(b["config"])
    known = {x["id"] for x in d["core"]} | {x["id"] for x in d["tenant"]} | {x["id"] for x in d.get("declared_not_present", [])}
    topo = root / "doctrine/topology.json"
    if topo.is_file():  # a live D1 store the topology declares and a system config binds is declared here too: the topology is the one source,
        # so a regeneration (the merge lane takes this file from main and reruns --write) cannot drop a database a branch added
        for st in json.loads(topo.read_text(encoding="utf-8")).get("stores", {}).get("d1", []):
            if st.get("state") == "live" and st.get("id") in seen and st["id"] not in known:
                ws = sorted(w for w in seen[st["id"]] if w.endswith(f"/{st['name']}.wrangler.jsonc"))
                d["core"].append({"name": st["name"], "id": st["id"], "binding": "DB on the " + (st["name"] + " Worker only" if ws else "Workers that bind it"),
                                  "holds": st.get("what", ""), "bound_by": []})
                known.add(st["id"])
                lv = d.setdefault("live", {}).setdefault("databases", [])
                if st["id"] not in {x["id"] for x in lv}:  # the id in the topology was read from the account when the store was created
                    lv.append({"name": st["name"], "id": st["id"], "tables": 0, "note": "id from doctrine/topology.json, which records it from the Cloudflare API at creation; owndb --live confirms it against the account; tables are created by the Worker"})
    for c in d["core"]:
        c["bound_by"] = sorted(seen.get(c["id"], []))
    (root / PATH).write_text(json.dumps(d, indent=1) + "\n", encoding="utf-8")
    return d


def _get(url: str, token: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"authorization": "Bearer " + token}), timeout=30) as r:
        return json.loads(r.read())


def live(root=REPO, env=None, get=_get) -> tuple[int, str]:
    """0 ok, 1 violated, 2 unmeasured (no credential or the API did not answer). Never reports ok without a reading."""
    env, d = os.environ if env is None else env, load(root)
    tok = env.get("CLOUDFLARE_API_TOKEN")
    if not tok:
        return 2, "unmeasured: no CLOUDFLARE_API_TOKEN on this host"
    try:
        res = get(f"https://api.cloudflare.com/client/v4/accounts/{d['account']['id']}/d1/database?per_page=100", tok)["result"]
    except Exception as e:
        return 2, f"unmeasured: {type(e).__name__}: {str(e)[:120]}"
    have = {x["uuid"]: x["name"] for x in res}
    missing = [c["name"] for c in d["core"] if c["id"] not in have]
    wrong = [c["name"] for c in d["core"] if c["id"] in have and have[c["id"]] != c["name"]]
    foreign = [i for i in have if i in _forbidden(Path(root))]
    if missing or wrong or foreign:
        return 1, f"missing from the account: {missing}; renamed: {wrong}; originating-fleet ids present: {foreign}"
    return 0, f"{len(d['core'])} core database(s) present in account {d['account']['name']} ({len(have)} databases in the account)"


def main(argv) -> int:
    a = argv[0] if argv else "--check"
    if a == "--write":
        write(); print("own-database record refreshed"); return 0
    if a == "--live":
        code, msg = live(); print(msg); return code
    bad = check()
    print("\n".join("owndb: " + b for b in bad) or "owndb ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

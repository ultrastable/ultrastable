"""SYS-1: the whole system as one declared topology (doctrine/topology.json), and what that gives you.

  python3 -m foundation topology --check              references, states and secrets hygiene of the declaration
  python3 -m foundation topology --render [--out DIR] one wrangler config per worker (default deploy/wrangler/), bindings only to live targets
  python3 -m foundation topology --bindings WORKER    the Workers-API metadata bindings for a worker (used by deploy/deploy-site.mjs)
  python3 -m foundation topology --drift              compare the declaration with the live Cloudflare account (needs CLOUDFLARE_API_TOKEN)
  python3 -m foundation topology --emit-system       regenerate doctrine/system.json (SYSTEM-1 shape) from the declaration
  python3 -m foundation topology --summary            counts and pending parts as JSON

A system is an integrated collection of parts. This file says which parts exist (state live) and which are being built (state planned); the renderer turns the
declaration into deployable configs, the deploy script reads the same bindings, and drift files nothing silently: every difference is returned. Variable values
and secrets never live here, only their names.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH, OUT = "doctrine/topology.json", "deploy/wrangler"
STORE_KINDS = {"d1": "d1", "kv": "kv", "queues": "queues", "vectorize": "vectorize", "workflows": "workflows", "r2": "r2"}
SECRETISH = re.compile(r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|sk-[A-Za-z0-9_-]{16,}|Bearer\s|[\w.+-]+@[\w-]+\.[\w.-]+|[0-9a-f]{40,})")


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def stores(t) -> dict:
    return {k: {s["name"]: s for s in t["stores"].get(k, [])} for k in STORE_KINDS}


def check(root=REPO) -> list[str]:
    t, bad = load(root), []
    st, ws = stores(t), {w["id"]: w for w in t["workers"]}
    if len(ws) != len(t["workers"]):
        bad.append("duplicate worker id")
    for k, group in st.items():
        for n, s in group.items():
            if not n.startswith(t["prefix"]):
                bad.append(f"{k} {n}: name does not start with {t['prefix']}")
            if s.get("state") not in ("live", "planned"):
                bad.append(f"{k} {n}: state must be live or planned")
    for q in st["queues"].values():
        if q.get("dlq") and q["dlq"] not in st["queues"]:
            bad.append(f"queue {q['name']}: dead-letter queue {q['dlq']} is not declared")
    for w in ws.values():
        b, wid = w.get("bindings", {}), w["id"]
        if w.get("state") not in ("live", "planned"):
            bad.append(f"worker {wid}: state must be live or planned")
        if not w.get("source") and not (REPO / w["main"]).exists() and w["state"] == "live":  # a tenant worker builds from its own repository (TENANT-REPO-1)
            bad.append(f"worker {wid}: main {w['main']} does not exist in the repository")
        for kind, key in (("d1", "d1"), ("kv", "kv"), ("vectorize", "vectorize"), ("r2", "r2")):
            for bn, target in (b.get(key) or {}).items():
                if target not in st[kind]:
                    bad.append(f"worker {wid}: binding {bn} -> {kind} {target} is not declared")
        for bn, target in (b.get("queues_producer") or {}).items():
            if target not in st["queues"]:
                bad.append(f"worker {wid}: producer {bn} -> queue {target} is not declared")
        for target in b.get("queues_consumer") or []:
            if target not in st["queues"]:
                bad.append(f"worker {wid}: consumer of queue {target} is not declared")
        for bn, target in (b.get("workflows") or {}).items():
            if target not in st["workflows"]:
                bad.append(f"worker {wid}: workflow binding {bn} -> {target} is not declared")
        for bn, target in (b.get("services") or {}).items():
            if target not in ws:
                bad.append(f"worker {wid}: service binding {bn} -> {target} is not a declared worker")
        for vn, v in (b.get("vars") or {}).items():
            if SECRETISH.search(str(v)):
                bad.append(f"worker {wid}: var {vn} looks like a secret or an address; keep values out of the topology")
        if w.get("public") and not w.get("routes"):
            bad.append(f"worker {wid}: public but has no routes")
    sp = Path(root) / "doctrine/system.json"
    if sp.is_file() and json.loads(sp.read_text(encoding="utf-8")) != emit_system(root):
        bad.append("doctrine/system.json is stale: run python3 -m foundation topology --emit-system (the topology is the one source)")
    return bad


def _live(t, kind, name) -> bool:
    return stores(t)[kind].get(name, {}).get("state") == "live"


def bindings(t, wid: str, only_live=True) -> tuple[list[dict], list[str]]:
    """Workers-API binding objects for a worker and the pending ones (declared but not deployable yet)."""
    w = next(x for x in t["workers"] if x["id"] == wid)
    b, out, pending = w.get("bindings", {}), [], []
    st = stores(t)
    for bn, tg in (b.get("d1") or {}).items():
        (out.append({"type": "d1", "name": bn, "id": st["d1"][tg]["id"]}) if _live(t, "d1", tg) or not only_live else pending.append(f"d1 {bn} -> {tg}"))
    for bn, tg in (b.get("kv") or {}).items():
        (out.append({"type": "kv_namespace", "name": bn, "namespace_id": st["kv"][tg]["id"]}) if _live(t, "kv", tg) or not only_live else pending.append(f"kv {bn} -> {tg}"))
    for bn, tg in (b.get("r2") or {}).items():
        (out.append({"type": "r2_bucket", "name": bn, "bucket_name": tg}) if _live(t, "r2", tg) or not only_live else pending.append(f"r2 {bn} -> {tg}"))
    for bn in b.get("ai") or []:
        out.append({"type": "ai", "name": bn})
    for bn in b.get("send_email") or []:
        out.append({"type": "send_email", "name": bn})
    for bn, tg in (b.get("queues_producer") or {}).items():
        (out.append({"type": "queue", "name": bn, "queue_name": tg}) if _live(t, "queues", tg) or not only_live else pending.append(f"queue {bn} -> {tg}"))
    for bn, tg in (b.get("vectorize") or {}).items():
        (out.append({"type": "vectorize", "name": bn, "index_name": tg}) if _live(t, "vectorize", tg) or not only_live else pending.append(f"vectorize {bn} -> {tg}"))
    for bn, tg in (b.get("workflows") or {}).items():
        wf = st["workflows"][tg]
        (out.append({"type": "workflow", "name": bn, "workflow_name": tg, "class_name": wf.get("class_name"), "script_name": wf.get("script")}) if wf["state"] == "live" or not only_live else pending.append(f"workflow {bn} -> {tg}"))
    live_workers = {x["id"] for x in t["workers"] if x["state"] == "live"}
    for bn, tg in (b.get("services") or {}).items():
        (out.append({"type": "service", "name": bn, "service": tg}) if tg in live_workers or not only_live else pending.append(f"service {bn} -> {tg}"))
    for bn, cls in (b.get("durable_objects") or {}).items():
        out.append({"type": "durable_object_namespace", "name": bn, "class_name": cls})
    for vn, v in (b.get("vars") or {}).items():
        out.append({"type": "plain_text", "name": vn, "text": v})
    return out, pending


def wrangler_config(t, w: dict) -> dict:
    live, pending = bindings(t, w["id"])
    c: dict = {"$schema": "node_modules/wrangler/config-schema.json", "name": w["id"], "main": "../../" + w["main"], "compatibility_date": w["compatibility_date"], "workers_dev": not w.get("public"),
               "observability": {"enabled": True}}
    if w.get("crons"):
        c["triggers"] = {"crons": w["crons"]}
    if w.get("routes"):
        c["routes"] = [{"pattern": r, "custom_domain": True} for r in w["routes"]]
    c["d1_databases"] = [{"binding": b["name"], "database_name": next(n for n, s in stores(t)["d1"].items() if s["id"] == b["id"]), "database_id": b["id"]} for b in live if b["type"] == "d1"]
    c["kv_namespaces"] = [{"binding": b["name"], "id": b["namespace_id"]} for b in live if b["type"] == "kv_namespace"]
    c["r2_buckets"] = [{"binding": b["name"], "bucket_name": b["bucket_name"]} for b in live if b["type"] == "r2_bucket"]
    if any(b["type"] == "ai" for b in live):
        c["ai"] = {"binding": next(b["name"] for b in live if b["type"] == "ai")}
    c["services"] = [{"binding": b["name"], "service": b["service"]} for b in live if b["type"] == "service"]
    prod = [b for b in live if b["type"] == "queue"]
    cons = [q for q in (w.get("bindings", {}).get("queues_consumer") or []) if _live(t, "queues", q)]
    if prod or cons:
        c["queues"] = {"producers": [{"binding": b["name"], "queue": b["queue_name"]} for b in prod], "consumers": [{"queue": q, "dead_letter_queue": stores(t)["queues"][q].get("dlq")} for q in cons]}
    if any(b["type"] == "vectorize" for b in live):
        c["vectorize"] = [{"binding": b["name"], "index_name": b["index_name"]} for b in live if b["type"] == "vectorize"]
    if any(b["type"] == "workflow" for b in live):
        c["workflows"] = [{"binding": b["name"], "name": b["workflow_name"], "class_name": b["class_name"]} for b in live if b["type"] == "workflow"]
    if any(b["type"] == "send_email" for b in live):
        c["send_email"] = [{"name": b["name"]} for b in live if b["type"] == "send_email"]
    if any(b["type"] == "durable_object_namespace" for b in live):
        c["durable_objects"] = {"bindings": [{"name": b["name"], "class_name": b["class_name"]} for b in live if b["type"] == "durable_object_namespace"]}
        c["migrations"] = w.get("bindings", {}).get("migrations") or []
    vars_ = {b["name"]: b["text"] for b in live if b["type"] == "plain_text"}
    if vars_:
        c["vars"] = vars_
    c["_secrets"] = w.get("bindings", {}).get("secrets", [])
    c["_vars_set_at_deploy"] = w.get("bindings", {}).get("var_names", [])
    c["_pending"] = pending
    c["_state"] = w["state"]
    return {k: v for k, v in c.items() if v not in ([], {}, None)}


def render(root=REPO, out=None) -> list[str]:
    t, dest, written = load(root), Path(out or (Path(root) / OUT)), []
    dest.mkdir(parents=True, exist_ok=True)
    for w in t["workers"]:
        p = dest / f"{w['id']}.json"
        p.write_text(json.dumps(wrangler_config(t, w), indent=2) + "\n", encoding="utf-8")
        written.append(str(p))
    return written


def emit_system(root=REPO) -> dict:
    """doctrine/system.json (SYSTEM-1's shape: resources by key, workers with bindings by key) generated from this declaration, so there is one source of truth."""
    t, st = load(root), stores(load(root))
    key = lambda kind, name: st[kind][name]["key"]
    res = {"d1": {s["key"]: {"name": s["name"], "id": s["id"]} for s in t["stores"]["d1"]}, "kv": {s["key"]: {"title": s["name"]} for s in t["stores"]["kv"]},
           "queues": {s["key"]: {"name": s["name"]} for s in t["stores"]["queues"]},
           "vectorize": {s["key"]: {"name": s["name"], "dimensions": s["dimensions"], "metric": s["metric"]} for s in t["stores"]["vectorize"]}}
    workers = {}
    for w in t["workers"]:
        b, o = w.get("bindings", {}), {}
        if b.get("d1"): o["d1"] = {k: key("d1", v) for k, v in b["d1"].items()}
        if b.get("ai"): o["ai"] = list(b["ai"])
        if b.get("kv"): o["kv"] = {k: key("kv", v) for k, v in b["kv"].items()}
        if b.get("queues_producer"): o["queue_producers"] = {k: key("queues", v) for k, v in b["queues_producer"].items()}
        if b.get("queues_consumer"): o["queue_consumers"] = [key("queues", q) for q in b["queues_consumer"]]
        if b.get("vectorize"): o["vectorize"] = {k: key("vectorize", v) for k, v in b["vectorize"].items()}
        if b.get("services"): o["services"] = dict(b["services"])
        workers[w["id"]] = {"main": w["main"], **({"source": w["source"]} if w.get("source") else {}), "role": w["role"], "crons": w.get("crons", []), "bindings": o}
    return {"_doc": "GENERATED by python3 -m foundation topology --emit-system from doctrine/topology.json. Do not edit; edit the topology. SYSTEM-1 (owner directive 2026-11-12): the one running system as data; `python3 -m foundation system --render` writes one wrangler config per worker to instances/ultrastable/system/; `--check` fails when the rendered files drift, a service binding names no worker, or a queue has no consumer. deploy/deploy-system.mjs deploys workers from the same data and probes /agents/probe.",
            "name": "ultrastable", "compatibility_date": t["system_compatibility_date"], "resources": res, "workers": workers, "edit_path": t["edit_path"], "deploy_counter": t["deploy_counter"]}


def summary(root=REPO) -> dict:
    t = load(root)
    st = stores(t)
    counts = {k: {"live": sum(1 for s in g.values() if s["state"] == "live"), "planned": sum(1 for s in g.values() if s["state"] == "planned")} for k, g in st.items()}
    counts["workers"] = {"live": sum(1 for w in t["workers"] if w["state"] == "live"), "planned": sum(1 for w in t["workers"] if w["state"] == "planned")}
    pend = [f"{w['id']}: {p}" for w in t["workers"] for p in bindings(t, w["id"])[1]]
    return {"parts": counts, "pending_bindings": pend, "workers": [{"id": w["id"], "state": w["state"], "role": w["role"], "public": bool(w.get("public"))} for w in t["workers"]]}


def _get(token, acct, path, fetch=None):
    if fetch:
        return fetch(path)
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/{path}", headers={"authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def drift(root=REPO, token=None, fetch=None) -> list[str]:
    """Differences between the declaration and the live account. Empty list = the account matches. Planned parts that do not exist yet are not drift."""
    t = load(root)
    token = token or os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token and not fetch:
        return ["no CLOUDFLARE_API_TOKEN on this host: drift not measured"]
    acct, st, out = t["account_id"], stores(t), []

    def names(path, key=None, field="name"):
        r = _get(token, acct, path, fetch).get("result")
        r = r.get(key) if isinstance(r, dict) and key else r
        return {x.get(field) or x.get("title") or x.get("id") or x.get("queue_name") for x in (r or [])}
    live = {"d1": names("d1/database?per_page=100"), "kv": names("storage/kv/namespaces?per_page=100"), "r2": names("r2/buckets", "buckets"), "queues": names("queues"),
            "vectorize": names("vectorize/v2/indexes"), "workflows": names("workflows"), "workers": names("workers/scripts", field="id")}
    for kind in ("d1", "kv", "r2", "queues", "vectorize", "workflows"):
        for n, s in st[kind].items():
            if s["state"] == "live" and n not in live[kind]:
                out.append(f"{kind} {n} is declared live but missing from the account")
            if s["state"] == "planned" and n in live[kind]:
                out.append(f"{kind} {n} exists in the account but is still declared planned: mark it live")
        for n in live[kind]:
            if n and n.startswith(t["prefix"]) and n not in st[kind]:
                out.append(f"{kind} {n} exists in the account but is not declared")
    for w in t["workers"]:
        if w["state"] == "live" and w["id"] not in live["workers"]:
            out.append(f"worker {w['id']} is declared live but missing from the account")
        if w["state"] == "planned" and w["id"] in live["workers"]:
            out.append(f"worker {w['id']} exists in the account but is still declared planned: mark it live")
        if w["state"] == "live" and w["id"] in live["workers"]:
            have = {(b["type"], b["name"]) for b in (_get(token, acct, f"workers/scripts/{w['id']}/settings", fetch).get("result") or {}).get("bindings", [])}
            want = {(b["type"], b["name"]) for b in bindings(t, w["id"])[0] if b["type"] != "plain_text"}
            for ty, n in sorted(want - have):
                out.append(f"worker {w['id']}: binding {n} ({ty}) is declared but not deployed")
            for ty, n in sorted(have - want - {("plain_text", n) for _, n in have}):
                out.append(f"worker {w['id']}: binding {n} ({ty}) is deployed but not declared")
    for n in sorted(live["workers"]):
        if n and n.startswith(t["prefix"]) and n not in {w["id"] for w in t["workers"]}:
            out.append(f"worker {n} exists in the account but is not declared")
    return out


def main(argv) -> int:
    a = list(argv)
    if "--render" in a:
        out = a[a.index("--out") + 1] if "--out" in a else None
        print("\n".join(render(REPO, out)))
        return 0
    if "--emit-system" in a:
        Path(REPO / "doctrine/system.json").write_text(json.dumps(emit_system(), indent=2) + chr(10), encoding="utf-8")
        print("wrote doctrine/system.json")
        return 0
    if "--bindings" in a:
        print(json.dumps(bindings(load(), a[a.index("--bindings") + 1])[0]))
        return 0
    if "--summary" in a:
        print(json.dumps(summary(), indent=1))
        return 0
    if "--drift" in a:
        d = drift()
        print("\n".join(d) if d else "topology matches the account")
        return 1 if d and not d[0].startswith("no CLOUDFLARE_API_TOKEN") else 0
    bad = check()
    print("\n".join(bad) if bad else "topology ok: " + json.dumps(summary()["parts"]))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

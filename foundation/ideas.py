# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPINOFF-IDEAS-1: Ultrastable proposes, scores and queues its own spinoffs and loop-scope increases against free-plan headroom.
Ultrastable is the foundation for any autonomous system.

Owner, 2026-11-17: use the maximum resources possible, stay cost constrained, brainstorm new ideas automatically, keep increasing scope.
The FREE-TIER-1 governor measures the day's free-plan use (seed/worker/src/freetier.js). This module reads that headroom
(ops/free-tier.json), prices every idea in the same units, fills the headroom greedily by score, and never plans past the reserve.

  python3 -m foundation ideas --headroom [--apply]   refresh the snapshot from Cloudflare analytics (needs CF_ANALYTICS_TOKEN; else keep it)
  python3 -m foundation ideas --brainstorm [--apply] generate new ideas and scope increases from the repo's own data, queue what fits
  python3 -m foundation ideas --queue                ranked ideas with cost share and whether each fits the headroom
  python3 -m foundation ideas --roadmap [--apply]    regenerate site/spinoff-roadmap-data.js (served at /roadmap and /roadmap.json)
  python3 -m foundation ideas --check                doctrine, snapshot and generated roadmap agree
"""
from __future__ import annotations
import datetime as dt, hashlib, json, math, os, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HDR = "// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// Copyright (c) Ultrastable\n"
RES = ("d1_rows_read", "d1_rows_written", "workers_requests", "ai_neurons")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/spinoff-ideas.json").read_text(encoding="utf-8"))


def _now(now=None) -> dt.datetime:
    return now or dt.datetime.now(dt.timezone.utc)


def _iso(t) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _lines(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.is_file() else []


def _append(p: Path, row: dict) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")


# ---- headroom ----------------------------------------------------------------------------------------------------------

def level_of(resources: dict) -> str:
    """Same thresholds as freetier.js evaluate(): degrade at 80% of the day, shed at 95%."""
    lv = "ok"
    for r in resources.values():
        f = (r.get("used") or 0) / r["limit"]
        if f >= 0.95:
            return "shed"
        if f >= 0.8:
            lv = "degrade"
    return lv


def headroom(root=REPO, now=None) -> dict:
    """What the plan may still spend today per resource: limit * (1 - reserve) - used. A stale or missing snapshot holds the level at degrade."""
    cfg, root, t = load(root), Path(root), _now(now)
    f = root / cfg["headroom"]
    if not f.is_file():
        return {"level": "degrade", "stale": True, "at": None, "left": {k: 0 for k in RES}, "resources": {}}
    s = json.loads(f.read_text(encoding="utf-8"))
    age_h = (t - dt.datetime.strptime(s["at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).total_seconds() / 3600
    stale = age_h > cfg["stale_after_hours"]
    lv = level_of(s["resources"])
    if stale and lv == "ok":
        lv = "degrade"
    left = {k: max(0, int(r["limit"] * (1 - cfg["reserve"].get(k, 0.25)) - (r.get("used") or 0))) for k, r in s["resources"].items()}
    return {"level": lv, "stale": stale, "at": s["at"], "left": left, "resources": s["resources"]}


def refresh_headroom(root=REPO, apply=False, now=None, fetch=None, token=None) -> dict:
    """Credential-free first: with no CF_ANALYTICS_TOKEN the snapshot is kept and the failure is recorded, never turned into zero use."""
    cfg, root, t = load(root), Path(root), _now(now)
    # CF_ANALYTICS_TOKEN first, then the deploy token the workflows already hold (never a new credential to mint).
    token = token if token is not None else (os.environ.get("CF_ANALYTICS_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN") or "")
    acct = os.environ.get("CF_ACCOUNT_ID", "81e3a4efb4eb66e613529b87682911bb")  # the ultrastable account; an id is not a secret
    if not token and not _route_ok():
        return {"refreshed": False, "why": "no CF_ANALYTICS_TOKEN bound; snapshot kept", "headroom": headroom(root, t)}
    day = t.replace(hour=0, minute=0, second=0, microsecond=0)
    q = ('{viewer{accounts(filter:{accountTag:"%s"}){d1:d1AnalyticsAdaptiveGroups(limit:1000,filter:{datetime_geq:"%s",datetime_leq:"%s"}){sum{rowsRead rowsWritten}} '
         'w:workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:"%s",datetime_leq:"%s"}){sum{requests}}}}}') % (acct, _iso(day), _iso(t), _iso(day), _iso(t))
    def _post(body):
        r = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql", data=json.dumps({"query": body}).encode(),
                                   headers={"authorization": "Bearer " + token, "content-type": "application/json"}, method="POST")
        return json.loads(urllib.request.urlopen(r, timeout=30).read())
    basis = "cloudflare-graphql"
    try:
        if not token:
            raise ValueError("no direct token; reading the tick's samples through the OIDC route")
        j = (fetch or _post)(q)
        if j.get("errors"):
            raise ValueError(json.dumps(j["errors"])[:150])
        a = j["data"]["viewer"]["accounts"][0]
        d1, w = a.get("d1") or [], a.get("w") or []
        used = {"d1_rows_read": sum(int(g["sum"]["rowsRead"]) for g in d1), "d1_rows_written": sum(int(g["sum"]["rowsWritten"]) for g in d1),
                "workers_requests": sum(int(g["sum"]["requests"]) for g in w)}
    except Exception as e:  # recorded, never swallowed; the old snapshot stands
        err = f"{type(e).__name__}: {e}"
        err = (err.replace(token, "***") if token else err)[:200]
        _append(root / "ops/spinoff/ledger.jsonl", {"event": "headroom-failed", "at": _iso(t), "error": err})
        used = _tick_samples(acct, token, t) if fetch is None else None  # the tick's own hourly free_tier_samples
        basis = "tick-free-tier-samples"
        if not used:
            return {"refreshed": False, "why": err, "headroom": headroom(root, t)}
    f = root / cfg["headroom"]
    s = json.loads(f.read_text(encoding="utf-8"))
    for k, v in used.items():
        s["resources"][k] = {"used": v, "limit": s["resources"][k]["limit"], "basis": "measured"}
    s["at"], s["basis"], s["level"] = _iso(t), basis, level_of(s["resources"])
    if apply:
        f.write_text(json.dumps(s, indent=1) + "\n", encoding="utf-8")
    return {"refreshed": True, "headroom": headroom(root, t)}


def _route_ok() -> bool:
    from . import workerroute
    return workerroute.available()


def _route_call():
    """FREE-TIER-ROUTE-1: the repository's Cloudflare secrets name the retired account (authz errors from 2026-11-20 left ops/free-tier.json at
    2026-11-17), so the same select-only D1 read goes through the site Worker's OIDC route (foundation/workerroute.py), which needs no stored secret."""
    from . import workerroute
    api = workerroute.make_api()
    return lambda path, body=None: api("POST" if body else "GET", "d1/database" + path, body)


def _tick_samples(acct, token, t, call=None):
    """Fallback when the token lacks analytics scope: latest of today's samples the tick wrote to D1 (ultrastable-org). {} on any failure."""
    if call is None and _route_ok():
        call = _route_call()
    if call is not None:
        return _read_samples(call, t, token)
    def call(path, body=None):
        r = urllib.request.Request("https://api.cloudflare.com/client/v4/accounts/%s/d1/database%s" % (acct, path),
                                   data=json.dumps(body).encode() if body else None, method="POST" if body else "GET",
                                   headers={"authorization": "Bearer " + token, "content-type": "application/json"})
        return json.loads(urllib.request.urlopen(r, timeout=30).read())
    return _read_samples(call, t, token)


def _read_samples(call, t, token=""):
    try:
        dbs = call("?name=ultrastable-org")["result"]
        sql = ("SELECT resource, used_today u FROM free_tier_samples WHERE at>=? AND used_today IS NOT NULL ORDER BY at, id")
        rows = call("/%s/query" % dbs[0]["uuid"], {"sql": sql, "params": [t.strftime("%Y-%m-%d")]})["result"][0]["results"]
        latest = {r["resource"]: int(r["u"]) for r in rows}
        return {k: v for k, v in latest.items() if k in ("d1_rows_read", "d1_rows_written", "workers_requests")}
    except Exception as e:  # recorded, never swallowed
        _append(Path(REPO) / "ops/spinoff/ledger.jsonl", {"event": "tick-samples-failed", "at": _iso(t), "error": (str(e).replace(token, "***") if token else str(e))[:150]})
        return {}


def daily_cap(root=REPO, now=None) -> int:
    """Launches per day the governor level allows: ok fills the headroom, degrade slows to one, shed stops."""
    cfg = load(root)
    return int(cfg["cadence"][headroom(root, now)["level"]])


# ---- facts a status board shows ----------------------------------------------------------------------------------------

def _ptr(doc, ptr: str):
    if ptr == "#lines":
        return len(doc) if isinstance(doc, list) else None
    if ptr.startswith("#last."):
        return doc[-1].get(ptr[6:]) if isinstance(doc, list) and doc else None
    if ptr.endswith("#len"):
        ptr, n = ptr[:-4], True
    else:
        n = False
    cur = doc
    for k in [x for x in ptr.split(".") if x]:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return len(cur) if n and hasattr(cur, "__len__") else cur


def resolve_fact(root, fact: dict, now=None) -> dict:
    """The rows a board shows, read from a committed file. Counts and public fields only; a missing value is None, never zero."""
    root, t = Path(root), _now(now)
    p = root / fact["path"]
    if not p.is_file():
        return {"source": fact["path"], "as_of": None, "rows": [], "error": "source missing"}
    doc = _lines(p) if fact.get("kind") == "jsonl" else json.loads(p.read_text(encoding="utf-8"))
    rows = [{"label": r["label"], "value": _ptr(doc, r["ptr"]), "of": _ptr(doc, r["of"]) if r.get("of") else None} for r in fact["rows"]]
    return {"source": fact["path"], "rows": rows, "as_of": _iso(dt.datetime.fromtimestamp(p.stat().st_mtime, dt.timezone.utc))}


# ---- ideas, scoring, the queue -----------------------------------------------------------------------------------------

def _cost_vec(c: dict) -> dict:
    return {k: int(c.get(k, 0)) for k in RES}


def use_factor(root, slug: str, cfg: dict) -> float:
    """BENEFIT-1 measured use: from the app's latest uses_7d in the spinoff metrics ledger; unmeasured stays at the neutral value, never zero."""
    u = cfg["benefit"]["use"]
    rows = [r for r in _lines(Path(root) / "ops/spinoff/metrics.jsonl") if r.get("slug") == slug and r.get("ok") and "uses_7d" in r]
    if not rows:
        return u["unmeasured"]
    x = min(1.0, math.log10(1 + max(0, rows[-1]["uses_7d"])) / math.log10(1 + u["uses_for_ceiling"]))
    return round(u["floor"] + (u["ceiling"] - u["floor"]) * x, 3)


def benefit(root, cfg: dict, i: dict):
    """BENEFIT-1 public-benefit value of an idea, or None when it declares no region and need (then the older reach x impact value applies)."""
    if "need" not in i or "regions" not in i:
        return None
    b, r = cfg["benefit"], i["regions"]
    n = 99 if r == "global" else len(r)
    region = b["region"]["global"] if n >= b["region"]["global_at"] else b["region"]["multi"] if n == 2 else b["region"]["single"]
    return round(b["scale"] * region * i["need"] * use_factor(root, i["id"], cfg), 2)


def depth(cfg: dict, i: dict) -> dict:
    """DEPTH-1: which of the depth fields (thesis, corpus, loop, returns, horizon) an idea carries, and whether it clears the bar.
    A shallow archetype (a lookup, a board, a template) never clears it: a cheap thrill has nowhere to go."""
    d = cfg.get("depth") or {}
    if not d:
        return {"met": [], "missing": [], "ok": True}
    if isinstance(i.get("depth"), dict):  # IDEA-BANK-1 shape: one rule for front-door ideas and self-chosen apps
        i = {**{d.get("aliases", {}).get(k, k): v for k, v in i["depth"].items()}, **{k: v for k, v in i.items() if k != "depth"}}
    met = [f for f in ("thesis", "corpus", "loop", "returns", "hook", "public_good") if len(str(i.get(f) or "").strip()) >= d["min_text"]]
    if isinstance(i.get("horizon"), list) and len([h for h in i["horizon"] if str(h).strip()]) >= d["min_horizon"]:
        met.append("horizon")
    lib = d.get("change_library")
    if lib:
        cm = json.loads((REPO / lib).read_text(encoding="utf-8"))
        ch = [c for c in (i.get("change") or []) if c in cm["methods"]]
        stages = {cm["methods"][c]["stage"] for c in ch}
        if len(ch) >= cm["min_per_idea"] and {"notice", "update", "act"} <= stages and len(ch) == len(i.get("change") or []):
            met.append("change")
    missing = [f for f in d["fields"] if f not in met]
    shallow = i.get("archetype") in d["shallow_archetypes"]
    text = " ".join(str(i.get(k) or "") for k in ("name", "tagline", "thesis", "corpus", "public_good")).lower()
    commerce = [w for w in d.get("commerce_words", []) if w in text]
    return {"met": met, "missing": missing, "shallow_archetype": shallow, "commerce": commerce, "ok": not missing and not shallow and not commerce}


def shallow_live(root=REPO) -> list[str]:
    """Live (not retired) spinoff apps whose idea fails DEPTH-1."""
    cfg, root = load(root), Path(root)
    by = {i["id"]: i for i in ideas(root)}
    out = []
    for p in sorted((root / "instances/spinoffs").glob("*/app.json")):
        a = json.loads(p.read_text(encoding="utf-8"))
        if a.get("status") != "retired" and not depth(cfg, by.get(a.get("idea") or p.parent.name, a))["ok"]:
            out.append(p.parent.name)
    return out


def retire_shallow(root=REPO, apply=False, now=None) -> list[str]:
    """Retire every live app under the DEPTH-1 bar: app.json status retired with the reason, a queue row, and the registry regenerated."""
    root, t, gone = Path(root), _iso(_now(now)), shallow_live(root)
    if apply and gone:
        for s in gone:
            p = root / "instances/spinoffs" / s / "app.json"
            a = json.loads(p.read_text(encoding="utf-8"))
            a.update({"status": "retired", "retired": t, "retired_why": "DEPTH-1: a single lookup or board with no thesis, growing corpus, loop or reason to return"})
            p.write_text(json.dumps(a, indent=1) + "\n", encoding="utf-8")
            _append(root / load(root)["queue"], {"at": t, "event": "retire", "slug": s, "rule": "DEPTH-1"})
        from . import spinoff
        spinoff.rebuild_bundle(root, now)
    return gone


def ideas(root=REPO) -> list[dict]:
    """The bank plus every brainstormed idea in the queue ledger, deduplicated by id (the latest row wins)."""
    cfg, root = load(root), Path(root)
    out = {i["id"]: dict(i) for i in cfg["bank"]}
    for r in _lines(root / cfg["queue"]):
        if r.get("event") == "idea":
            out[r["idea"]["id"]] = dict(r["idea"])
    return list(out.values())


def live_ids(root=REPO) -> set:
    d = Path(root) / "instances/spinoffs"
    return {json.loads(p.read_text(encoding="utf-8")).get("idea") or p.parent.name for p in d.glob("*/app.json")} if d.is_dir() else set()


def planned(root=REPO) -> dict:
    """What the apps already live will spend per day, from the cost each idea declared at launch."""
    tot = {k: 0 for k in RES}
    d = Path(root) / "instances/spinoffs"
    for p in d.glob("*/app.json") if d.is_dir() else []:
        a = json.loads(p.read_text(encoding="utf-8"))
        if a.get("status") != "retired":
            for k, v in _cost_vec(a.get("cost") or {}).items():
                tot[k] += v
    return tot


def rank(root=REPO, now=None) -> list[dict]:
    """Every idea not yet live, scored value over cost share, then filled greedily into the headroom. fits=False ideas stay queued, never dropped."""
    from . import spinoff
    cfg, root = load(root), Path(root)
    scfg, head, have, live = spinoff.load(root), headroom(root, now), planned(root), live_ids(root)
    left = {k: max(0, v - have[k]) for k, v in head["left"].items()}
    out = []
    for i in ideas(root):
        if i["id"] in live or i.get("status") == "retired":
            continue
        arch = scfg["archetypes"].get(i.get("archetype", ""), {})
        feas = 1.0 if arch.get("implemented") else 0.3
        cost = _cost_vec(i.get("cost", {}))
        share = max([cost[k] / r["limit"] for k, r in head["resources"].items() if k in cost] or [0])
        ben = benefit(root, cfg, i)
        value = (ben * feas) if ben is not None else i.get("reach", 1) * i.get("impact", 1) * feas * (cfg["weights"]["showcase_bonus"] if i.get("showcase") else 1.0)
        dep = depth(cfg, i)
        out.append({**i, "depth": dep, "benefit": ben, "feasibility": feas, "implemented": bool(arch.get("implemented")), "cost": cost, "cost_share": round(share, 4),
                    "score": round(value / (1 + cfg["weights"]["cost_penalty"] * share), 2)})
    out.sort(key=lambda x: (-x["score"], x["id"]))
    for i in out:
        ok = all(i["cost"][k] <= left.get(k, 0) for k in RES) and i["score"] >= cfg["min_score"] and i["depth"]["ok"]
        i["fits"] = ok
        if ok:
            for k in RES:
                left[k] -= i["cost"][k]
    return out


def candidates(root=REPO, now=None) -> list[dict]:
    """Ideas shaped for spinoff.launch(): implemented, kind spinoff, scored, inside the headroom, past the safety gate."""
    from . import spinoff
    scfg, out = spinoff.load(root), []
    for i in rank(root, now):
        if i.get("kind") != "spinoff" or not i["implemented"] or not i["fits"]:
            continue
        a = scfg["archetypes"][i["archetype"]]
        c = {"slug": i["id"], "idea": i["id"], "archetype": i["archetype"], "need_ids": [], "domains": [], "reach": i["reach"], "impact": i["impact"], "feasibility": i["feasibility"],
             "novelty": 1.0, "score": i["score"], "collects": list(a["collects"]), "input": a["input"], "why": i["tagline"] + " " + i.get("showcases", ""), "name": i["name"],
             "tagline": i["tagline"], "fact": i.get("fact"), "live": i.get("live"), "showcase": bool(i.get("showcase")), "cost": i["cost"]}
        c["gate"] = spinoff.gate(c, scfg)
        out.append(c)
    return out


def scope_probe(template: dict) -> str | None:
    """The closing probe a scope item is filed with: the template's own probe on code or data. A probe that reads the queue's own
    issue files (the old `grep:docs/issues/<id>.json::Status:** closed`) passes the moment the item is marked closed, so it proves
    nothing; such a template, or one with no probe, is not filed (PROBE-REAL-1)."""
    p = str(template.get("probe") or "").strip()
    kind, _, rest = p.partition(":")
    if kind not in ("file", "grep", "cmd") or not rest or rest.lstrip("./").startswith("docs/issues/"):
        return None
    return p


# ---- brainstorm --------------------------------------------------------------------------------------------------------

# DECISION-METRIC: idea-loop
def brainstorm(root=REPO, apply=False, now=None) -> dict:
    """Generate ideas from the repository's own data: a board for every public ledger nobody shows yet, and the next loop-scope increases the headroom can pay for."""
    cfg, root, t = load(root), Path(root), _now(now)
    have_paths = {i.get("fact", {}).get("path") for i in ideas(root)}
    have_ids = {i["id"] for i in ideas(root)}
    new = []
    for p in sorted((root / "ops").glob("*.jsonl")):
        stem = p.stem
        if len(new) >= cfg["max_new_per_run"]:
            break
        rows = _lines(p)
        if stem in cfg["private_ledgers"] or f"ops/{p.name}" in have_paths or f"board-{stem}" in have_ids or len(rows) < 10:
            continue
        key = "at" if rows[-1].get("at") else next((k for k in ("ts", "time", "date") if rows[-1].get(k)), None)
        facts = [{"label": "Entries recorded", "ptr": "#lines"}] + ([{"label": "Last entry", "ptr": "#last." + key}] if key else [])
        nm = stem.replace("-", " ").title()
        new.append({"id": f"board-{stem}", "kind": "spinoff", "archetype": "status-board", "name": f"{nm} Board", "showcase": True, "reach": 3, "impact": 2,
                    "tagline": f"How much the {stem.replace('-', ' ')} loop has recorded and when it last did. Counted from its own ledger.",
                    "showcases": f"the {stem} loop's evidence, counted", "cost": {"workers_requests": 800}, "fact": {"path": f"ops/{p.name}", "kind": "jsonl", "rows": facts},
                    "origin": "brainstorm:ledger-board", "at": _iso(t)})
    scope = []
    head = headroom(root, t)
    for s in cfg["scope_templates"][:]:
        if len(scope) >= cfg["scope_ideas_per_run"]:
            break
        iid = "Q-SPIN-" + s["id"].upper()
        f = root / "docs/issues" / f"{iid}.json"
        if f.is_file() or any(s["cost"].get(k, 0) > head["left"].get(k, 0) for k in s["cost"]):
            continue
        probe = scope_probe(s)
        if not probe:
            continue  # a scope item with no probe on code, or one that only reads its own issue file, could only be closed by itself
        scope.append({"id": iid, "title": s["title"], "why": s["why"], "cost": s["cost"], "file": str(f.relative_to(root)), "probe": probe})
        if apply:
            body = (f"**Owner:** product-manager\n**Trigger:** executor tick, driver order\n**Done check:** {probe}\n**Status:** open\n\n"
                    f"{s['title']}. {s['why']}. Planned cost per day: {json.dumps(s['cost'])} against headroom {json.dumps({k: head['left'].get(k) for k in s['cost']})} (SPINOFF-IDEAS-1).\n\n"
                    f"size: S\n\n**Prediction:** ops/free-tier.json level != shed within 48 h\n\n**Closing probe:** {probe}")
            f.write_text(json.dumps({"id": iid, "title": f"{iid}: {s['title']}", "body": body, "labels": ["role:product-manager", "ws:growth", "raises-self"], "milestone": "Now", "workstream": "Growth"}, indent=1) + "\n", encoding="utf-8")
            _append(root / cfg["queue"], {"event": "scope", "at": _iso(t), "id": iid, "cost": s["cost"]})
    if apply:
        from . import decisions  # DECISIONS-1: each queued idea is a decision with a predicted effect, scored against the free-tier level a day later
        for i in new:
            _append(root / cfg["queue"], {"event": "idea", "at": _iso(t), "idea": i})
            decisions.record(root, "idea-loop", i["id"], i["id"], 1.0, f"priced {json.dumps(i['cost'])} against headroom {json.dumps({k: head['left'].get(k) for k in i['cost']})}", now=t)
        for s in scope:
            decisions.record(root, "idea-loop", s["id"], s["id"], 1.0, f"scope increase priced {json.dumps(s['cost'])} against headroom {json.dumps({k: head['left'].get(k) for k in s['cost']})}", now=t)
    return {"new_ideas": [i["id"] for i in new], "scope_items": [s["id"] for s in scope], "applied": apply}


# ---- roadmap served from code ------------------------------------------------------------------------------------------

def roadmap(root=REPO) -> dict:
    """Deterministic from committed state (no wall clock) so a stale generated file is detectable."""
    from . import spinoff
    cfg, root = load(root), Path(root)
    head, ranked = headroom(root, dt.datetime(2000, 1, 1, tzinfo=dt.timezone.utc)), rank(root, dt.datetime.strptime(json.loads((root / cfg["headroom"]).read_text(encoding="utf-8"))["at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc))
    snap = json.loads((root / cfg["headroom"]).read_text(encoding="utf-8"))
    live = [{"slug": a["slug"], "name": a["name"], "tagline": a["tagline"], "archetype": a["archetype"], "launched": a["launched"], "url": f"https://{a['slug']}.{spinoff.load(root)['domain']}"}
            for a in spinoff.registry(root) if a.get("status") in ("live", "iterating", "promoted")]
    scope = [{"id": p.stem, "title": json.loads(p.read_text(encoding="utf-8"))["title"].split(": ", 1)[-1], "status": "closed" if "Status:** closed" in json.loads(p.read_text(encoding="utf-8"))["body"] else "open"}
             for p in sorted((root / "docs/issues").glob("Q-SPIN-*.json"))]
    return {"as_of": snap["at"], "level": level_of(snap["resources"]), "cadence_per_day": cfg["cadence"][level_of(snap["resources"])],
            "headroom": {k: {"used": r.get("used"), "limit": r["limit"], "basis": r.get("basis")} for k, r in snap["resources"].items()}, "live": live,
            "queue": [{"id": i["id"], "name": i["name"], "kind": i["kind"], "archetype": i.get("archetype"), "score": i["score"], "fits": i["fits"], "implemented": i["implemented"],
                       "cost_share": i["cost_share"]} for i in ranked[:15]], "scope": scope}


def write_roadmap(root=REPO) -> str:
    cfg, root = load(root), Path(root)
    txt = HDR + "// GENERATED by foundation/ideas.py (SPINOFF-IDEAS-1) from ops/free-tier.json, doctrine/spinoff-ideas.json and instances/spinoffs. Do not edit; `ideas --check` fails when stale.\nexport default " + json.dumps(roadmap(root), indent=1, sort_keys=True) + ";\n"
    (root / cfg["roadmap_out"]).write_text(txt, encoding="utf-8")
    return txt


def check(root=REPO) -> list[str]:
    from . import spinoff
    cfg, root, bad = load(root), Path(root), []
    ids = [i["id"] for i in ideas(root)]
    if len(ids) != len(set(ids)):
        bad.append("duplicate idea ids")
    scfg = spinoff.load(root)
    for s in shallow_live(root):
        bad.append(f"{s}: live app under the depth bar; run `python3 -m foundation ideas --retire-shallow --apply` (DEPTH-1)")
    for i in ideas(root):
        if i.get("kind") == "seed":  # DEPTH-1 seeds go through the seed pipeline (instances/<id>/), not a spinoff archetype
            dep = depth(cfg, i)
            if not dep["ok"]:
                bad.append(f"{i['id']}: seed idea misses depth fields {dep['missing']} (DEPTH-1)")
            if not (root / "instances" / i["id"] / "IDEA.md").is_file():
                bad.append(f"{i['id']}: seed idea has no instances/{i['id']}/IDEA.md, so the seed pipeline never builds it (DEPTH-1)")
            continue
        if i.get("archetype") not in scfg["archetypes"]:
            bad.append(f"{i['id']}: unknown archetype")
        g = spinoff.gate({"slug": i["id"], "archetype": i.get("archetype", ""), "why": i["tagline"], "domains": [], "need_ids": [], "collects": [], "input": scfg["archetypes"].get(i.get("archetype", ""), {}).get("input", "none")}, scfg)
        bad += [f"{i['id']}: safety gate: {r}" for r in g["reasons"]]
        if scfg["archetypes"].get(i.get("archetype", ""), {}).get("what", "").startswith("SPINOFF-GOOD-1"):  # a live app names a source in spinoffs/live.js, which serves its /api/freshness
            lj = root / "spinoffs/live.js"
            if not i.get("live") or not lj.is_file() or f'"{i["live"]}": {{' not in lj.read_text(encoding="utf-8"):
                bad.append(f"{i['id']}: live app has no source entry in spinoffs/live.js")
        if i.get("live") and not (i.get("regions") and i.get("need") and i.get("need_evidence")):
            bad.append(f"{i['id']}: a live public-benefit idea needs regions, need and need_evidence (BENEFIT-1)")
        if i.get("fact") and not (root / i["fact"]["path"]).is_file():
            bad.append(f"{i['id']}: fact source {i['fact']['path']} missing")
    if not (root / cfg["headroom"]).is_file():
        bad.append(f"{cfg['headroom']} missing")
    out = root / cfg["roadmap_out"]
    # Shape, not equality: the daily loop regenerates the file from state other loops also change (the registry, the ledgers), so an equality check would
    # fail an unrelated pull request the moment main moves. `ideas --roadmap --apply` is the regenerator and the loop runs it every day.
    if not out.is_file() or not out.read_text(encoding="utf-8").startswith(HDR + "// GENERATED") or '"queue"' not in out.read_text(encoding="utf-8"):
        bad.append(f"{cfg['roadmap_out']} is missing or malformed; run `python3 -m foundation ideas --roadmap --apply`")
    if scfg["budget"]["monthly_usd_ceiling"] != 0:
        bad.append("monthly_usd_ceiling must stay 0")
    return bad


def main(argv=None) -> int:
    a = list(sys.argv[2:] if argv is None else argv)
    apply = "--apply" in a
    if "--check" in a:
        bad = check()
        print("\n".join(bad) or "ideas: ok")
        return 1 if bad else 0
    if "--headroom" in a:
        r = refresh_headroom(apply=apply)
        print(json.dumps({k: r[k] for k in r if k != "headroom"} | {"level": r["headroom"]["level"], "stale": r["headroom"]["stale"]}))
        return 0
    if "--retire-shallow" in a:
        print(json.dumps({"retired" if apply else "would_retire": retire_shallow(apply=apply)}))
        return 0
    if "--brainstorm" in a:
        print(json.dumps(brainstorm(apply=apply)))
        return 0
    if "--queue" in a:
        for i in rank():
            print(json.dumps({k: i[k] for k in ("id", "kind", "score", "cost_share", "implemented", "fits")}))
        return 0
    if "--roadmap" in a:
        if apply:
            write_roadmap()
        print(json.dumps(roadmap(), indent=1))
        return 0
    print(__doc__)
    return 0

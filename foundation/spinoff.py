# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPINOFF-1: Ultrastable generates its own seeds. Ultrastable is the foundation for any autonomous system.

An unsupervised loop: ideate from the system's own records, score for expected reach and impact, pass a safety gate, launch on
*.ultrastable.app, generate each app's own metrics and targets, then a portfolio manager scores measured value and keeps, iterates,
promotes or retires every app. Every decision is a provenance row and a ledger row with a logged prediction.

  python3 -m foundation spinoff --ideate            ranked candidates with scores and gate verdicts
  python3 -m foundation spinoff --launch [--apply]  launch the best candidate within the weekly cap (writes registry, bundle, ledgers)
  python3 -m foundation spinoff --metrics SLUG      the metric set and targets generated for an app
  python3 -m foundation spinoff --collect [--apply] pull each live app's aggregate metrics (public, no personal data) into the ledger
  python3 -m foundation spinoff --promote [--apply] submit each live app's host to IndexNow (credential-free promotion)
  python3 -m foundation spinoff --tick [--apply]    portfolio: value, decision (iterate/promote/retire), budget share, bandit update
  python3 -m foundation spinoff --check             the doctrine, registry, bundle and safety gate agree
"""
from __future__ import annotations
import datetime as dt, hashlib, json, math, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUNDLE = "spinoffs/registry.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/spinoff.json").read_text(encoding="utf-8"))


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


# ---- sources: what the system itself says is missing --------------------------------------------------------------------

def needs(root=REPO) -> list[dict]:
    """Needs drawn from the system's own records. Each need: {id, domain, why, source}."""
    root, out = Path(root), []
    bp = root / "doctrine/blindspots.json"
    if bp.is_file():
        for n in json.loads(bp.read_text(encoding="utf-8"))["needs"]:
            out.append({"id": n["id"], "domain": n["domain"], "why": n["why"], "source": "blindspots"})
    return out


# ---- ideation and scoring -----------------------------------------------------------------------------------------------

def registry(root=REPO) -> list[dict]:
    d = Path(root) / load(root)["registry"]
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*/app.json"))] if d.is_dir() else []


def bandit(root, cfg, archetype: str) -> float:
    """Weight per archetype from settled outcomes: kept and promoted raise it, retired lowers it, within the floor and ceiling."""
    b, w = cfg["score"]["bandit"], 1.0
    for o in _lines(Path(root) / cfg["outcomes_ledger"]):
        if o.get("archetype") == archetype:
            w += b["step"] if o.get("decision") in ("promote", "keep") else -b["step"] if o.get("decision") == "retire" else 0
    return max(b["floor"], min(b["ceiling"], w))


def candidates(root=REPO) -> list[dict]:
    cfg, root = load(root), Path(root)
    ns = {n["id"]: n for n in needs(root)}
    seen = {n for a in registry(root) for n in a.get("need_ids", [])}
    out = []
    for arch, ids in cfg["need_archetype"].items():
        have = [ns[i] for i in ids if i in ns]
        if not have:
            continue
        a = cfg["archetypes"][arch]
        impact = round(sum(cfg["domain_impact"].get(n["domain"], 2) for n in have) / len(have))
        reach = round((a["audience"] + sum(cfg["domain_reach"].get(n["domain"], 2) for n in have) / len(have)) / 2)
        fresh = [n for n in have if n["id"] not in seen]
        novelty = len(fresh) / len(have)
        apps = registry(root)
        if apps and sum(1 for x in apps if x["archetype"] == arch) / len(apps) > cfg["score"]["diversity_cap"]:
            novelty *= 0.5  # IDEA-DIVERSITY-CAP-1, kept from QNFO's idea hub: no one kind of app takes more than the cap of the portfolio
        feas = 1.0 if a["implemented"] else 0.3
        sc = reach * impact * feas * novelty * bandit(root, cfg, arch) / (1 + a["cost_per_use"])
        slug = "blindspot" if arch == "domain-check" else arch.split("-")[0] + "-" + hashlib.sha256("|".join(sorted(n["id"] for n in have)).encode()).hexdigest()[:6]
        c = {"slug": slug, "archetype": arch, "need_ids": [n["id"] for n in have], "domains": sorted({n["domain"] for n in have}), "reach": reach, "impact": impact,
             "feasibility": feas, "novelty": round(novelty, 2), "score": round(sc, 2), "collects": list(a["collects"]), "input": a["input"],
             "why": "; ".join(n["why"] for n in have[:2])}
        c["gate"] = gate(c, cfg)
        out.append(c)
    return sorted(out, key=lambda c: (-int(c["gate"]["ok"]), -c["score"], c["slug"]))


def gate(c: dict, cfg: dict) -> dict:
    """Safety gate: fails closed. Returns {ok, reasons}."""
    s, why = cfg["safety"], []
    hay = " ".join([c["slug"], c["archetype"], c.get("why", ""), " ".join(c.get("domains", [])), " ".join(c.get("need_ids", []))]).lower()
    why += [f"denied domain: {d}" for d in s["deny_domains"] if d in hay]
    why += [f"collects {x}" for x in c.get("collects", []) if x in s["deny_collect"]]
    if c.get("collects"):
        why.append("an app may collect nothing beyond aggregate counts")
    if c.get("input") not in s["allowed_inputs"]:
        why.append(f"input not allowed: {c.get('input')}")
    if c["archetype"] not in cfg["archetypes"]:
        why.append("unknown archetype")
    return {"ok": not why, "reasons": why}


# ---- metrics generated per app -----------------------------------------------------------------------------------------

def metric_set(app: dict, cfg: dict) -> dict:
    """Each app declares its own reach, impact and guard metrics and targets, generated from its archetype and its score."""
    a = cfg["archetypes"][app["archetype"]]
    if app.get("fact"):  # a status board has no visitors-with-a-gap; it is measured by the freshness of what it shows (and by requests, once the platform meters them)
        return {"reach": ["board_age_hours"], "impact": [], "guard": ["error_share"], "targets": {"board_age_hours": 30}, "showcase": True,
                "value": "a showcase board is kept while its facts stay fresh and its cost inside the headroom", "prediction": "board_age_hours <= 30 within 48 h", "input": a["input"]}
    reach_target = 10 ** max(1, app.get("reach", 3) - 3)  # reach 5 -> 100 uses a week as the first bar; the portfolio re-tunes it
    return {"reach": cfg["reach_metrics"], "impact": cfg["impact_metrics"], "guard": cfg["guard_metrics"],
            "targets": {"uses_7d": reach_target, "visitors_with_a_gap_7d": max(5, reach_target // 2), "verified_fixes_7d": max(3, reach_target // 5), "return_share": 0.2},
            "gap": "share of checked public safeguards that are missing", "value": cfg["value"]["definition"][:120],
            "prediction": f"verified_fixes_7d >= {max(3, reach_target // 5)} within 336 h", "input": a["input"]}


# ---- launch --------------------------------------------------------------------------------------------------------------

def _checks(c: dict, cfg: dict) -> list[dict]:
    want = set(c["need_ids"])
    return [{k: x[k] for k in ("id", "title", "fix")} for x in cfg["check_library"] if want & set(x["needs"])]


def rebuild_bundle(root=REPO, now=None) -> dict:
    cfg, root = load(root), Path(root)
    from . import ideas
    apps = [a for a in registry(root) if a.get("status") in ("live", "iterating", "promoted")]
    b = {"domain": cfg["domain"], "apps": {a["slug"]: {k: a[k] for k in ("slug", "name", "tagline", "archetype", "checks", "showcase") if k in a} for a in apps},
         "retired": sorted(a["slug"] for a in registry(root) if a.get("status") == "retired"), "caps": cfg["budget"],
         "built_at": _iso(_now(now)), "boards": {a["slug"]: ideas.resolve_fact(root, a["fact"], now) for a in apps if a.get("fact")}}
    txt = json.dumps(b, indent=1, sort_keys=True)
    (root / BUNDLE).write_text(txt + "\n", encoding="utf-8")
    (root / "spinoffs/registry.js").write_text("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// Copyright (c) Ultrastable\n// generated by foundation/spinoff.py; do not edit\nexport default " + txt + ";\n", encoding="utf-8")
    return b


def launch(root=REPO, apply=False, now=None) -> dict:
    cfg, root, t = load(root), Path(root), _now(now)
    live = [a for a in registry(root) if a.get("status") in ("live", "iterating", "promoted")]
    launches = [r for r in _lines(root / cfg["ledger"]) if r.get("event") == "launch"]
    week = [r for r in launches if r.get("at", "") >= _iso(t - dt.timedelta(days=7))]
    day = [r for r in launches if r.get("at", "") >= _iso(t - dt.timedelta(days=1))]
    from . import ideas  # SPINOFF-IDEAS-1: the governor level sets the daily count, so launches fill free headroom and stop at the reserve
    day_cap = min(cfg["budget"]["max_launches_per_day"], ideas.daily_cap(root, t))
    if len(live) >= cfg["budget"]["max_live"]:
        return {"launched": None, "why": f"live cap {cfg['budget']['max_live']} reached"}
    if len(week) >= cfg["budget"]["max_launches_per_week"]:
        return {"launched": None, "why": f"weekly launch cap {cfg['budget']['max_launches_per_week']} reached"}
    if len(day) >= day_cap:
        return {"launched": None, "why": f"daily launch cap {day_cap} reached (free-tier level sets it)"}
    ranked = sorted(candidates(root) + ideas.candidates(root, t), key=lambda c: (-int(c["gate"]["ok"]), -c["score"], c["slug"]))
    for c in ranked:
        floor = 0 if c.get("idea") else cfg["score"]["min_score"]  # idea scores are already floored and headroom-checked by ideas.rank
        if not cfg["archetypes"][c["archetype"]]["implemented"] or c["score"] < floor or c["novelty"] == 0:
            continue
        if not c["gate"]["ok"]:
            _append(root / cfg["ledger"], {"event": "rejected", "at": _iso(t), "slug": c["slug"], "reasons": c["gate"]["reasons"]}) if apply else None
            continue
        meta = {"slug": c["slug"], "name": c.get("name") or ("Blindspot Check" if c["slug"] == "blindspot" else c["slug"].replace("-", " ").title()),
                "tagline": c.get("tagline") or ("What does your website not tell people? Type a domain, see the gaps in a minute." if c["slug"] == "blindspot" else c["why"][:100]),
                "archetype": c["archetype"], "status": "live", "launched": _iso(t), "need_ids": c["need_ids"], "reach": c["reach"], "impact": c["impact"],
                "score": c["score"], "checks": _checks(c, cfg)}
        if c.get("idea"):
            meta.update({"idea": c["idea"], "fact": c.get("fact"), "showcase": bool(c.get("showcase")), "cost": c.get("cost")})
        meta["metrics"] = metric_set(meta, cfg)
        if apply:
            d = root / cfg["registry"] / c["slug"]
            d.mkdir(parents=True, exist_ok=True)
            (d / "app.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
            rebuild_bundle(root, t)
            _append(root / cfg["ledger"], {"event": "launch", "at": _iso(t), "slug": c["slug"], "score": c["score"], "reach": c["reach"], "impact": c["impact"],
                                           "needs": c["need_ids"], "prediction": meta["metrics"]["prediction"], "url": f"https://{c['slug']}.{cfg['domain']}"})
            try:
                from . import provenance
                provenance.record(root, {"class": "loop", "actor": "spinoff", "channel": "loop-run"}, "decision",
                                  f"launched {c['slug']}.{cfg['domain']}: score {c['score']} (reach {c['reach']}, impact {c['impact']}) from needs {', '.join(c['need_ids'])}; prediction {meta['metrics']['prediction']}",
                                  tenant="ultrastable", ref=f"spinoff:{c['slug']}", affected=[f"{cfg['registry']}/{c['slug']}"], public=True)
            except (ValueError, OSError) as e:  # a provenance failure is recorded, never swallowed
                _append(root / cfg["ledger"], {"event": "provenance-failed", "at": _iso(t), "slug": c["slug"], "error": str(e)})
        return {"launched": meta, "applied": apply}
    return {"launched": None, "why": "no candidate passed score, novelty, implementation and the safety gate", "ranked": [(c["slug"], c["score"], c["gate"]["ok"]) for c in ranked]}


def promote(root=REPO, apply=False, now=None, post=None) -> list[dict]:
    """Credential-free promotion of every live app: submit its host to IndexNow (the key file is served by the app Worker). Outcomes feed the app's own referrer metric."""
    cfg, root, t = load(root), Path(root), _now(now)
    key = "ultrastable-indexnow-7f3a9c2e4b1d"  # public by design; same key as site/promote.js
    def _post(body):
        r = urllib.request.Request("https://api.indexnow.org/indexnow", data=json.dumps(body).encode(), headers={"content-type": "application/json; charset=utf-8"}, method="POST")
        return urllib.request.urlopen(r, timeout=20).status
    post, rows = post or _post, []
    for a in registry(root):
        if a.get("status") == "retired":
            continue
        host = f"{a['slug']}.{cfg['domain']}"
        body = {"host": host, "key": key, "keyLocation": f"https://{host}/{key}.txt", "urlList": [f"https://{host}/", f"https://{host}/llms.txt"]}
        try:
            row = {"event": "promote", "at": _iso(t), "slug": a["slug"], "channel": "indexnow", "status": post(body)}
        except Exception as e:  # recorded, never swallowed
            row = {"event": "promote", "at": _iso(t), "slug": a["slug"], "channel": "indexnow", "status": 0, "error": f"{type(e).__name__}: {e}"[:200]}
        rows.append(row)
        if apply:
            _append(root / cfg["ledger"], row)
    return rows


# ---- measurement and portfolio -------------------------------------------------------------------------------------------

def collect(root=REPO, apply=False, now=None, fetch=None) -> list[dict]:
    cfg, root, t = load(root), Path(root), _now(now)
    fetch = fetch or (lambda u: json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"user-agent": "ultrastable-spinoff"}), timeout=20).read()))
    rows = []
    for a in registry(root):
        if a.get("status") == "retired":
            continue
        u = f"https://{a['slug']}.{cfg['domain']}/api/metrics"
        try:
            m = fetch(u)
            row = {"at": _iso(t), "slug": a["slug"], "ok": True, **{k: m.get(k, 0) for k in cfg["reach_metrics"] + cfg["impact_metrics"] + cfg["guard_metrics"]},
                   **({"board_age_hours": m["board_age_hours"]} if "board_age_hours" in m else {})}
        except Exception as e:  # an unreachable app is a measured fact, never a zero
            row = {"at": _iso(t), "slug": a["slug"], "ok": False, "error": f"{type(e).__name__}: {e}"[:200]}
        rows.append(row)
        if apply:
            _append(root / cfg["metrics_ledger"], row)
    return rows


def value(m: dict, app: dict, cfg: dict) -> float:
    """Measured value 0..1 (doctrine value.definition): verified gap closed, retention, and reach to people who had the gap.
    Impressions, page views and money are excluded by doctrine; each part is progress toward the app's own target."""
    tg, w = app.get("metrics", {}).get("targets", {}), cfg["value"]["weights"]
    prog = lambda x, t: min(1.0, math.log1p(max(0, x)) / math.log1p(max(1, t)))
    closed = prog(m.get("verified_fixes_7d", 0), tg.get("verified_fixes_7d", 10))
    kept = min(1.0, m.get("return_share", 0) / max(0.01, tg.get("return_share", 0.2)))
    reached = prog(m.get("visitors_with_a_gap_7d", 0), tg.get("visitors_with_a_gap_7d", 20))
    return round(w["gap_closed"] * closed + w["retained"] * kept + w["reached_with_gap"] * reached, 3)


def tick(root=REPO, apply=False, now=None) -> list[dict]:
    cfg, root, t = load(root), Path(root), _now(now)
    latest = {}
    for r in _lines(root / cfg["metrics_ledger"]):
        if r.get("ok"):
            latest[r["slug"]] = r
    p, decisions = cfg["portfolio"], []
    for a in registry(root):
        if a.get("status") == "retired":
            continue
        age = (t - dt.datetime.strptime(a["launched"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).days
        m = latest.get(a["slug"])
        if a.get("showcase"):  # SPINOFF-IDEAS-1: a showcase board is judged by freshness, not gap closure; unmeasured gap value is never read as zero
            stale = m is not None and m.get("board_age_hours", 0) > 72
            d = {"decision": "iterate" if stale else "keep", "value": None,
                 "why": "board facts older than 72 h: refresh the bundle" if stale else "showcase board kept while its facts are fresh and its cost is inside the headroom"}
        elif m is None:
            d = {"decision": "measure", "value": None, "why": "no successful measurement yet; unmeasured is never scored as zero"}
        else:
            v = value(m, a, cfg)
            if age < p["min_age_days"]:
                d = {"decision": "keep", "value": v, "why": f"age {age}d under the {p['min_age_days']}d trial"}
            elif v < p["kill_below_value"]:
                d = {"decision": "retire", "value": v, "why": f"value {v} under {p['kill_below_value']} after {age}d"}
            elif v >= p["promote_above_value"]:
                d = {"decision": "promote", "value": v, "why": f"value {v} at or above {p['promote_above_value']}"}
            else:
                d = {"decision": "iterate", "value": v, "why": f"value {v} between {p['kill_below_value']} and {p['promote_above_value']}: file the weakest metric as an improvement"}
        d.update({"slug": a["slug"], "archetype": a["archetype"], "at": _iso(t), "age_days": age})
        decisions.append(d)
    scored = [d for d in decisions if d["value"] is not None and d["decision"] != "retire"]
    tot = sum(d["value"] for d in scored) or 0
    for d in decisions:
        d["budget_share"] = round(max(p["budget_share_floor"], (d["value"] or 0) / tot), 3) if tot and d["decision"] != "retire" else (p["budget_share_floor"] if d["decision"] != "retire" else 0)
    if apply:
        for d in decisions:
            _append(root / cfg["ledger"], {"event": "decision", **d})
            if d["decision"] in ("retire", "promote"):
                _append(root / cfg["outcomes_ledger"], {"at": d["at"], "slug": d["slug"], "archetype": d["archetype"], "decision": d["decision"], "value": d["value"]})
            if d["decision"] == "retire":
                f = root / cfg["registry"] / d["slug"] / "app.json"
                meta = json.loads(f.read_text(encoding="utf-8"))
                meta["status"], meta["retired"], meta["retired_why"] = "retired", d["at"], d["why"]
                f.write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
                rebuild_bundle(root)
            try:
                from . import provenance
                provenance.record(root, {"class": "loop", "actor": "spinoff", "channel": "loop-run"}, "decision", f"{d['slug']}: {d['decision']} ({d['why']})",
                                  tenant="ultrastable", ref=f"spinoff:{d['slug']}", public=True)
            except (ValueError, OSError) as e:
                _append(root / cfg["ledger"], {"event": "provenance-failed", "at": d["at"], "slug": d["slug"], "error": str(e)})
    return decisions


# ---- check ---------------------------------------------------------------------------------------------------------------

def check(root=REPO) -> list[str]:
    cfg, root, bad = load(root), Path(root), []
    apps = registry(root)
    for a in apps:
        if a["archetype"] not in cfg["archetypes"]:
            bad.append(f"{a['slug']}: unknown archetype {a['archetype']}")
            continue
        g = gate({"slug": a["slug"], "archetype": a["archetype"], "why": a.get("tagline", ""), "domains": [], "need_ids": a.get("need_ids", []), "collects": cfg["archetypes"][a["archetype"]]["collects"],
                  "input": cfg["archetypes"][a["archetype"]]["input"]}, cfg)
        bad += [f"{a['slug']}: safety gate: {r}" for r in g["reasons"]]
        if not a.get("metrics", {}).get("prediction"):
            bad.append(f"{a['slug']}: no generated metrics or prediction")
    live = [a for a in apps if a.get("status") in ("live", "iterating", "promoted")]
    if len(live) > cfg["budget"]["max_live"]:
        bad.append(f"{len(live)} live apps exceed the cap {cfg['budget']['max_live']}")
    b = Path(root) / BUNDLE
    if not b.is_file() or json.loads(b.read_text(encoding="utf-8"))["apps"].keys() != {a["slug"] for a in live}:
        bad.append(f"{BUNDLE} does not match the live registry; run `python3 -m foundation spinoff --launch --apply` or rebuild")
    if cfg["budget"]["monthly_usd_ceiling"] != 0:
        bad.append("monthly_usd_ceiling must stay 0 until cost.json records headroom")
    return bad


def main(argv=None) -> int:
    a = list(sys.argv[2:] if argv is None else argv)
    apply = "--apply" in a
    if "--check" in a:
        bad = check()
        print("\n".join(bad) or "spinoff: ok")
        return 1 if bad else 0
    if "--ideate" in a:
        for c in candidates():
            print(json.dumps({k: c[k] for k in ("slug", "archetype", "score", "reach", "impact", "novelty", "feasibility", "gate")}))
        return 0
    if "--rebuild" in a:  # refreshes every status board's facts and built_at from committed files
        rebuild_bundle()
        print("spinoff: bundle rebuilt")
        return 0
    if "--launch" in a:
        print(json.dumps(launch(apply=apply), indent=1))
        return 0
    if "--metrics" in a:
        cfg = load()
        app = next((x for x in registry() if x["slug"] == a[a.index("--metrics") + 1]), None)
        print(json.dumps(metric_set(app, cfg), indent=1) if app else "no such app")
        return 0 if app else 1
    if "--promote" in a:
        for r in promote(apply=apply):
            print(json.dumps(r))
        return 0
    if "--collect" in a:
        for r in collect(apply=apply):
            print(json.dumps(r))
        return 0
    if "--tick" in a:
        for d in tick(apply=apply):
            print(json.dumps(d))
        return 0
    print(__doc__)
    return 0

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DECISIONS-1 (Rowan, 2026-11-18): measure what we improve and improve what we measure. Ultrastable is the foundation for any autonomous system.

Every autonomous decision point (doctrine/decisions.json) declares the metric it optimizes. Each decision it makes is logged with its predicted effect
(ops/decisions/ledger.jsonl) and scored later against the measured outcome (ops/decisions/outcomes.jsonl). Worker-side points log to D1 (seed/worker/src/decisions.js).
  python3 -m foundation decisions --check              registry complete; every marked code path registered; no new unmarked decision-shaped function
  python3 -m foundation decisions --settle [--apply]   score every decision whose window has passed against the measured value
  python3 -m foundation decisions --backfill [--apply] log the decisions the existing ledgers already hold (marked backfill)
  python3 -m foundation decisions --probe              outcomes are being scored (exit 0 ok, 1 violated, 2 unmeasured)
  python3 -m foundation decisions --status             per point: decisions, scored, hit rate, calibration, trend
  python3 -m foundation decisions --page [--apply]     regenerate site/decisions-data.js (served at /decisions and /api/decisions)
  python3 -m foundation decisions --baseline           record decision-shaped functions with no marker (shrink-only)
Unmeasured is never healthy: a point whose source cannot be read reports unmeasured.
Consumers: .github/workflows/checks.yml, doctrine/rules.json (every-decision-measured), scripts/regen_generated.py, site/worker.js, tests/foundation/test_decisions.py."""
from __future__ import annotations
import datetime as dt, hashlib, json, re, sys, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REG = "doctrine/decisions.json"
OPS = {">=": lambda a, b: a >= b, ">": lambda a, b: a > b, "<=": lambda a, b: a <= b, "<": lambda a, b: a < b, "=": lambda a, b: a == b}
HDR = "// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// Copyright (c) Ultrastable\n"


def load(root=REPO) -> dict:
    """The registry is code configuration: a scratch or partial root without its own copy reads the repository's."""
    p = Path(root) / REG
    return json.loads((p if p.is_file() else REPO / REG).read_text(encoding="utf-8"))


def _now(now=None) -> dt.datetime:
    return now or dt.datetime.now(dt.timezone.utc)


def _iso(t) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _lines(p: Path) -> list[dict]:
    out = []
    if p.is_file():
        for l in p.read_text(encoding="utf-8").splitlines():
            if l.strip():
                try:
                    out.append(json.loads(l))
                except ValueError:
                    continue
    return out


def _append(p: Path, row: dict) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")


def point(cfg: dict, pid: str) -> dict:
    for p in cfg["points"]:
        if p["id"] == pid:
            return p
    raise KeyError(f"decision point {pid} is not in {REG}")


# ---- record ------------------------------------------------------------------------------------------------------------
def record(root, pid: str, chosen: str, ref: str, predicted: float, basis: str, alternatives: int = 0, now=None, backfill: bool = False) -> dict | None:
    """Log one decision of a registered point: what was chosen, the metric it optimizes, the predicted effect and why. Idempotent per (point, ref, chosen)."""
    root, cfg, t = Path(root), None, _now(now)
    cfg = load(root)
    p = point(cfg, pid)
    did = "d-" + hashlib.sha256(f"{pid}|{ref}|{chosen}".encode()).hexdigest()[:12]
    if any(r["id"] == did for r in _lines(root / cfg["ledger"])):
        return None
    row = {"id": did, "at": _iso(t), "point": pid, "chosen": chosen, "ref": ref, "metric": p["metric"], "op": p["op"], "target": p["target"],
           "predicted": predicted, "window_h": p["window_h"], "basis": basis[:300], "alternatives": alternatives}
    if backfill:
        row["backfill"] = True
    _append(root / cfg["ledger"], row)
    return row


# ---- measure -----------------------------------------------------------------------------------------------------------
def _closed_item(root: Path, ref: str):
    f = root / "docs/issues" / f"{ref}.json"
    if f.is_file():
        try:
            if re.search(r"Status:\*\* closed", json.loads(f.read_text(encoding="utf-8")).get("body", "")):
                return 1.0
        except ValueError:
            return None
    for r in _lines(root / "ops/executor-log.jsonl"):
        if str(r.get("issue")) == str(ref) and r.get("result") in ("verified-no-change", "merged", "closed", "pr-opened"):
            return 1.0
    return 0.0


def measure(root, cfg: dict, row: dict, due: bool):
    """The measured value for a decision, or None when it cannot be read (never guessed). Only called once the window has passed."""
    root, p = Path(root), point(cfg, row["point"])
    m = p["measure"]
    k = m["kind"]
    if k == "free_tier_not_shed":
        f = root / "ops/free-tier.json"
        if not f.is_file():
            return None
        try:
            return 0.0 if json.loads(f.read_text(encoding="utf-8")).get("level") == "shed" else 1.0
        except ValueError:
            return None
    if k == "jsonl_latest":
        rows = [r for r in _lines(root / m["path"]) if r.get(m["match"]) == row["ref"] and m["field"] in r]
        return float(rows[-1][m["field"]]) if rows else None
    if k == "item_closed":
        return _closed_item(root, row["ref"])
    if k == "improvement_kept":
        for r in _lines(root / "ops/improvements.jsonl"):
            if r.get("ev") == "verdict" and r.get("loop") == row["ref"] and r.get("at", "") >= row["at"]:
                return 1.0 if r.get("kept") else 0.0
        return None
    return None


def holds(op: str, measured: float, target: float) -> bool:
    return OPS[op](measured, target)


def settle(root=REPO, apply=False, now=None) -> dict:
    """Score every repo-stored decision whose window has passed. An unreadable source leaves the decision overdue; it is never scored as a miss or a hit."""
    root, t = Path(root), _now(now)
    cfg = load(root)
    done = {r["id"] for r in _lines(root / cfg["outcomes"])}
    scored, overdue = [], []
    for r in _lines(root / cfg["ledger"]):
        if r["id"] in done or point(cfg, r["point"])["store"] != "repo":
            continue
        if t < _parse(r["at"]) + dt.timedelta(hours=r["window_h"]):
            continue
        v = measure(root, cfg, r, True)
        if v is None:
            overdue.append(r["id"])
            continue
        o = {"id": r["id"], "point": r["point"], "at": _iso(t), "measured": v, "hit": holds(r["op"], v, r["target"]), "predicted": r["predicted"], "decided_at": r["at"]}
        scored.append(o)
        if apply:
            _append(root / cfg["outcomes"], o)
    return {"scored": len(scored), "overdue_unmeasurable": len(overdue), "applied": apply}


# ---- status ------------------------------------------------------------------------------------------------------------
def _trend(outs: list[dict], tcfg: dict) -> dict:
    """Did the decisions improve the metric? Compare the mean measured value of the older half of scored decisions with the newer half."""
    n = len(outs)
    if n < tcfg["min_settled_to_judge"]:
        return {"verdict": "insufficient", "need": tcfg["min_settled_to_judge"], "have": n}
    outs = sorted(outs, key=lambda o: o["decided_at"])
    h = n // 2
    a, b = [o["measured"] for o in outs[:h]], [o["measured"] for o in outs[h:]]
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    base = abs(ma) or 1.0
    d = (mb - ma) / base
    return {"verdict": "improving" if d > tcfg["flat_band"] else "worse" if d < -tcfg["flat_band"] else "flat", "older_mean": round(ma, 4), "newer_mean": round(mb, 4)}


def status(root=REPO, now=None, d1: dict | None = None) -> dict:
    """Per point: decisions made, scored, hit rate, mean absolute prediction error, daily series and the improvement verdict. d1 = the Worker's /api/decisions body for the D1 points."""
    root, t = Path(root), _now(now)
    cfg = load(root)
    rows, outs = _lines(root / cfg["ledger"]), _lines(root / cfg["outcomes"])
    byid = {o["id"]: o for o in outs}
    pts = []
    for p in cfg["points"]:
        mine = [r for r in rows if r["point"] == p["id"]]
        sc = [byid[r["id"]] for r in mine if r["id"] in byid]
        entry = {"id": p["id"], "name": p["name"], "store": p["store"], "metric": p["metric"], "metric_says": p["metric_says"], "target": f"{p['op']} {p['target']}",
                 "predict": p["predict"], "why": p["why"], "window_h": p["window_h"], "decisions": len(mine), "scored": len(sc),
                 "overdue": sum(1 for r in mine if r["id"] not in byid and t >= _parse(r["at"]) + dt.timedelta(hours=r["window_h"]))}
        if p["store"] == "d1":
            live = ((d1 or {}).get("points") or {}).get(p["id"])
            if live:
                entry.update(decisions=live["decisions"], scored=live["scored"], hits=live["hits"], hit_rate=live["hit_rate"], mean_abs_error=live.get("mean_abs_error"),
                             last_at=live.get("last_at"), by_day=live.get("by_day", []), trend=live.get("trend", {"verdict": "insufficient"}), source="live D1 (7-day window; older rows are hash-chained archives)")
            else:
                entry.update(hits=0, hit_rate=None, mean_abs_error=None, last_at=None, by_day=[], trend={"verdict": "unmeasured"}, source="live D1 not reachable from this build")
        else:
            hits = sum(1 for o in sc if o["hit"])
            entry.update(hits=hits, hit_rate=round(hits / len(sc), 3) if sc else None,
                         mean_abs_error=round(sum(abs(o["measured"] - o["predicted"]) for o in sc) / len(sc), 3) if sc else None,
                         last_at=max((r["at"] for r in mine), default=None), trend=_trend(sc, cfg["trend"]), source=cfg["ledger"])
            days: dict = {}
            for r in mine:
                dd = days.setdefault(r["at"][:10], {"day": r["at"][:10], "decisions": 0, "scored": 0, "hits": 0})
                dd["decisions"] += 1
                o = byid.get(r["id"])
                if o:
                    dd["scored"] += 1
                    dd["hits"] += 1 if o["hit"] else 0
            entry["by_day"] = sorted(days.values(), key=lambda x: x["day"])[-14:]
        pts.append(entry)
    return {"as_of": _iso(t), "points": pts}


# ---- backfill: the decisions the ledgers already hold -------------------------------------------------------------------
def backfill(root=REPO, apply=False, now=None) -> dict:
    root = Path(root)
    n = 0
    out = []
    for r in _lines(root / "ops/spinoff/ledger.jsonl"):
        if r.get("event") == "launch" and r.get("slug"):
            out.append(("spinoff-launch", r["slug"], r["slug"], float(r.get("reach") or 1), f"score {r.get('score')} (reach {r.get('reach')}, impact {r.get('impact')}); prior was {r.get('prediction')}", r["at"]))
    for r in _lines(root / "ops/executor-log.jsonl"):
        if r.get("issue") is not None and r.get("result") not in (None, "idle"):
            out.append(("work-queue-priority", f"issue {r['issue']}", str(r["issue"]), 1.0, f"picked in driver order; logged {r.get('prediction')}", r["at"]))
    for r in _lines(root / "ops/improvements.jsonl"):
        if r.get("ev") == "prediction":
            out.append(("plussing", r["loop"], r["loop"], 1.0, f"predicted {r.get('metric')} {r.get('op')} baseline {r.get('baseline')}", r["at"]))
    for pid, chosen, ref, pred, basis, at in out:
        if apply:
            if record(root, pid, chosen, ref, pred, basis, now=_parse(at), backfill=True):
                n += 1
        else:
            n += 1
    return {"candidates": len(out), "logged" if apply else "would_log": n}


# ---- check -------------------------------------------------------------------------------------------------------------
def _scan(root: Path, cfg: dict):
    d = cfg["discover"]
    py, js = re.compile(d["py_pattern"], re.M), re.compile(d["js_pattern"])
    marked, shaped = {}, []
    for g in d["globs"]:
        for p in sorted(root.glob(g)):
            rel = p.relative_to(root).as_posix()
            t = p.read_text(encoding="utf-8", errors="replace")
            ids = re.findall(re.escape(d["marker"]) + r"\s*([a-z0-9-]+)", t)
            if ids:
                marked[rel] = set(ids)
            if (py if rel.endswith(".py") else js).search(t):
                shaped.append(rel)
    return marked, shaped


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    cfg = load(root)
    ids = [p["id"] for p in cfg["points"]]
    bad += [f"point {i} duplicated" for i in set(ids) if ids.count(i) > 1]
    for p in cfg["points"]:
        for k in ("name", "metric", "metric_says", "op", "target", "predict", "why", "measure", "files", "store", "window_h"):
            if k not in p or p[k] in ("", None, []):
                bad.append(f"{p['id']}: missing {k}")
        if p.get("op") not in OPS:
            bad.append(f"{p['id']}: op {p.get('op')} unknown")
        for f in p.get("files", []):
            fp = root / f
            if not fp.is_file():
                bad.append(f"{p['id']}: file {f} does not exist")
            elif f"{cfg['discover']['marker']} {p['id']}" not in fp.read_text(encoding="utf-8", errors="replace"):
                bad.append(f"{p['id']}: {f} lacks the marker `{cfg['discover']['marker']} {p['id']}`")
    marked, shaped = _scan(root, cfg)
    for rel, found in marked.items():
        bad += [f"{rel}: marker names unregistered decision point {i}" for i in sorted(found - set(ids))]
    base = cfg.get("uninstrumented", {})
    nd = cfg.get("not_decisions", {})
    for rel, why in nd.items():
        if len(str(why).split()) < 6:
            bad.append(f"{rel}: not_decisions needs a reason of at least six words")
        if rel in marked:
            bad.append(f"{rel}: is now instrumented; remove it from not_decisions")
        elif rel in base:
            bad.append(f"{rel}: is in both uninstrumented and not_decisions")
        elif rel not in shaped:
            bad.append(f"{rel}: no longer has a decision-shaped function; remove it from not_decisions")
    for rel in shaped:
        if rel not in marked and rel not in base and rel not in nd:
            bad.append(f"{rel}: has a decision-shaped function with no declared metric; add `{cfg['discover']['marker']} <point>` (and register the point) or, if it is not a decision, list it with a reason")
    for rel in base:
        if rel in marked:
            bad.append(f"{rel}: is now instrumented; remove it from uninstrumented (shrink-only)")
        elif rel not in shaped:
            bad.append(f"{rel}: no longer has a decision-shaped function; remove it from uninstrumented")
    if base and not (root / "docs/issues" / f"{cfg['gap_item']}.json").is_file():
        bad.append(f"{len(base)} uninstrumented file(s) but gap item {cfg['gap_item']} is not filed (owner, trigger, probe)")
    pg = root / cfg["page_data"]
    if not pg.is_file():
        bad.append(f"{cfg['page_data']} missing: run `python3 -m foundation decisions --page --apply`")
    else:
        have = re.findall(r'"id": "([a-z0-9-]+)",\s*"name"', pg.read_text(encoding="utf-8"))
        if have != ids:
            bad.append(f"{cfg['page_data']} lists {have}, registry has {ids}: run `python3 -m foundation decisions --page --apply`")
    return bad


def baseline(root=REPO) -> dict:
    root = Path(root)
    cfg = load(root)
    marked, shaped = _scan(root, cfg)
    nd = cfg.get("not_decisions", {})
    cfg["uninstrumented"] = {rel: "decision-shaped function with no declared metric yet; owner staff, trigger executor tick, probe `python3 -m foundation decisions --check` (Q-DECISION-COVERAGE-1)"
                             for rel in shaped if rel not in marked and rel not in nd}
    (root / REG).write_text(json.dumps(cfg, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"uninstrumented": len(cfg["uninstrumented"])}


# ---- probe -------------------------------------------------------------------------------------------------------------
def _fetch(url: str):
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None


def probe(root=REPO, now=None, fetch=_fetch) -> tuple[str, str]:
    """Are outcomes being scored, not just logged? Repo points: the share of due decisions that were scored. D1 points: the live endpoint reports scored decisions."""
    root, t = Path(root), _now(now)
    cfg, pc = load(root), None
    pc = cfg["probe"]
    st = status(root, t)
    bad, unmeasured = [], []
    for p in st["points"]:
        if p["store"] == "repo":
            raw = [r for r in _lines(root / cfg["ledger"]) if r["point"] == p["id"]]
            due = [r for r in raw if t >= _parse(r["at"]) + dt.timedelta(hours=r["window_h"] + pc["grace_h"])]
            if not raw:
                unmeasured.append(f"{p['id']}: no decision logged yet")
            elif len(due) >= pc["min_due_to_judge"] and (p["scored"] / max(1, len(due))) < pc["min_settled_share"]:
                bad.append(f"{p['id']}: {p['scored']} of {len(due)} due decisions scored (min share {pc['min_settled_share']})")
        else:
            live = fetch(pc["live_url"])
            lp = ((live or {}).get("points") or {}).get(p["id"])
            if live is None:
                unmeasured.append(f"{p['id']}: {pc['live_url']} unreachable")
            elif not lp or lp["decisions"] == 0:
                unmeasured.append(f"{p['id']}: the Worker logged no decision in 7 days")
            elif lp["decisions"] >= pc["min_due_to_judge"] and lp["scored"] == 0:
                bad.append(f"{p['id']}: {lp['decisions']} decisions logged, none scored")
    if bad:
        return "violated", "; ".join(bad)[:300]
    if unmeasured:
        return "unmeasured", "; ".join(unmeasured)[:300]
    return "ok", f"every one of {len(st['points'])} decision points logs and scores its outcomes"


# ---- page data ---------------------------------------------------------------------------------------------------------
def page(root=REPO, apply=False, now=None) -> str:
    root = Path(root)
    cfg = load(root)
    st = status(root, now, _fetch(cfg["probe"]["live_url"]) if apply else None)
    txt = HDR + "// GENERATED by foundation/decisions.py (DECISIONS-1) from ops/decisions/*.jsonl and doctrine/decisions.json. Do not edit; regenerated after every merge.\nexport default " + json.dumps(st, indent=1, sort_keys=False) + ";\n"
    if apply:
        (root / cfg["page_data"]).write_text(txt, encoding="utf-8")
    return txt


def main(argv) -> int:
    a = argv[:1]
    ap = "--apply" in argv
    if a == ["--check"]:
        bad = check()
        print("decisions ok" if not bad else "\n".join(bad))
        return 1 if bad else 0
    if a == ["--settle"]:
        print(json.dumps(settle(REPO, ap), indent=1)); return 0
    if a == ["--backfill"]:
        print(json.dumps(backfill(REPO, ap), indent=1)); return 0
    if a == ["--probe"]:
        s, d = probe(); print(f"{s}: {d}"); return {"ok": 0, "violated": 1}.get(s, 2)
    if a == ["--status"]:
        print(json.dumps(status(REPO), indent=1)); return 0
    if a == ["--page"]:
        page(REPO, ap); print("decisions page data " + ("written" if ap else "ok")); return 0
    if a == ["--baseline"]:
        print(json.dumps(baseline(REPO))); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

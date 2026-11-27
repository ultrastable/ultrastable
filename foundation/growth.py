"""GROWTH-1: the product manager's growth loop as code. Measures the growth share of shipped work and the growth metrics, and steers the executor toward growth.

  python3 -m foundation growth [--report|--check]

Mix: the last `window_merges` merge subjects on main are classified fix / growth / maintenance (doctrine/growth.json). When the growth share is below the target and a
growth item (label `growth`) is takeable, the executor picks from the growth items first, so the backlog cannot devolve into bug fixes. Metrics: first-party hits in D1
(seed/analytics) read over the Cloudflare API when a token is bound. Targets and triggers are data; a metric below target is a breach the product manager answers with a
growth item.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/growth.json"


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def _names(labels) -> list[str]:
    return [l["name"] if isinstance(l, dict) else l for l in labels or []]


def classify(title: str, labels=(), cfg=None) -> str:
    cfg = cfg or load()
    if cfg["label"] in _names(labels):
        return "growth"
    if re.search(cfg["classify"]["fix"], title, re.I):
        return "fix"
    if re.search(cfg["classify"]["growth"], title, re.I):
        return "growth"
    return "maintenance"


def mix(subjects: list[str], cfg=None) -> dict:
    cfg = cfg or load()
    c = {"growth": 0, "fix": 0, "maintenance": 0}
    for s in subjects[: cfg["window_merges"]]:
        c[classify(s, (), cfg)] += 1
    n = sum(c.values())
    return {**c, "total": n, "growth_share": round(c["growth"] / n, 3) if n else None, "target": cfg["target_growth_share"]}


def recent_subjects(root=REPO, n=None) -> list[str]:
    n = n or load(root)["window_merges"]
    try:
        r = subprocess.run(["git", "-C", str(root), "log", f"-{n}", "--format=%s", "--first-parent"], capture_output=True, text=True, timeout=30, encoding="utf-8")
        return [l for l in r.stdout.splitlines() if l]
    except (OSError, subprocess.SubprocessError):
        return []


def prefer(issues: list[dict], root=REPO, subjects=None) -> list[dict]:
    """Executor hook: when the recent mix is below the growth target and a growth item is takeable, only growth items are candidates."""
    cfg = load(root)
    m = mix(subjects if subjects is not None else recent_subjects(root), cfg)
    if m["growth_share"] is None or m["growth_share"] >= cfg["target_growth_share"]:
        return issues
    g = [i for i in issues if cfg["label"] in _names(i.get("labels"))]
    return g or issues


def hits_metrics(token: str, acct: str, db: str, now: float | None = None) -> dict:
    from . import clock
    now = int(now or time.time())
    q = lambda sql: clock._cf(f"d1/database/{db}/query", {"sql": sql}, token, acct)["result"][0]["results"][0]
    w = int((now - 7 * 86400) * 1000)  # hits.at is epoch milliseconds (seed/analytics record() writes Date.now()); a bound in seconds read every raw row
    a = q(f"SELECT COUNT(*) AS pv, COUNT(DISTINCT vid) AS v FROM hits WHERE bot=0 AND name='pageview' AND at>={w}")
    b = q(f"SELECT COUNT(*) AS n FROM hits WHERE bot=1 AND at>={w}")
    c = q(f"SELECT COUNT(*) AS n FROM hits WHERE bot=0 AND name='pageview' AND path LIKE '/pilot%' AND at>={w}")
    return {"pageviews_7d": a["pv"], "visitors_7d": a["v"], "agent_hits_7d": b["n"], "pilot_page_views_7d": c["n"]}


HITS_URL = "https://ultrastable.io/api/growth/hits"


def hits_public(url=HITS_URL, fetch=None) -> dict:
    import json as _j, urllib.request
    if fetch is None:
        req = urllib.request.Request(url, headers={"user-agent": "ultrastable-growth/1"})
        with urllib.request.urlopen(req, timeout=20) as r:
            body = _j.loads(r.read())
    else:
        body = fetch(url)
    keys = ("pageviews_7d", "visitors_7d", "agent_hits_7d", "pilot_page_views_7d")
    if not all(isinstance(body.get(k), int) for k in keys):
        raise ValueError("hits endpoint answered without counts")
    return {k: body[k] for k in keys}


def evaluate(metrics: dict, cfg=None) -> list[dict]:
    cfg = cfg or load()
    out = []
    for m in cfg["metrics"]:
        v = metrics.get(m["id"])
        hit = None if v is None else (v < m["target"] if m["direction"] == ">=" else v > m["target"])
        out.append({"id": m["id"], "what": m["what"], "value": v, "target": m["target"], "breach": hit})
    return out


def snapshot(root=REPO, use_live=True, env=None) -> dict:
    env, cfg = os.environ if env is None else env, load(root)
    d: dict = {"mix": mix(recent_subjects(root), cfg), "target_growth_share": cfg["target_growth_share"]}
    try:
        from . import queue as qmod
        items = qmod.takeable(root)
        d["growth_items_takeable"] = sum(1 for i in items if cfg["label"] in _names(i.get("labels")))
        d["items_takeable"] = len(items)
    except Exception as e:  # recorded
        d["queue_error"] = str(e)[:120]
    metrics = {}
    if use_live and env.get("CLOUDFLARE_API_TOKEN"):
        try:
            metrics = hits_metrics(env["CLOUDFLARE_API_TOKEN"], "81e3a4efb4eb66e613529b87682911bb", "5cd83b52-864a-4510-b062-fc0d9402d06c")
        except Exception as e:  # recorded: an unmeasured metric is a finding
            d["metrics_error"] = type(e).__name__ + ": " + str(e)[:120]
    if use_live and not metrics:  # GROWTH-HITS-1: second route, no credential: the site Worker serves the same aggregates from its own D1 binding
        try:
            metrics = hits_public()
        except Exception as e:  # recorded: an unmeasured metric is a finding
            d["metrics_error"] = (d.get("metrics_error", "") + " | public: " + type(e).__name__ + ": " + str(e)[:120]).strip(" |")
    d["metrics"] = evaluate(metrics, cfg)
    d["breaches"] = [m["id"] for m in d["metrics"] if m["breach"]]
    return d


def check(root=REPO) -> list[str]:
    cfg, bad = load(root), []
    for k in ("target_growth_share", "window_merges", "label", "classify", "metrics"):
        if k not in cfg:
            bad.append(f"{PATH}: missing {k}")
    for m in cfg.get("metrics", []):
        if m.get("baseline") is None or not cfg.get("bank", {}).get(m.get("id")):
            bad.append(f"metric {m.get('id')}: needs a baseline and at least one idea in the bank (the product manager files the next experiment from it)")
        if not m.get("trigger"):
            bad.append(f"metric {m.get('id')}: registered without a trigger (a metric is registered together with its trigger)")
    bad += check_products(root, cfg)
    return bad


POLICIES = ("seed/autonomy/policy.json", "agents/autonomy-policy.json")


def check_products(root=REPO, cfg=None) -> list[str]:
    """GROWTH-PM-1: every product has growth metrics and an owner loop, and the policy values the roster runs on agree with this file."""
    cfg, bad, root = cfg or load(root), [], Path(root)
    pols = [json.loads((root / p).read_text(encoding="utf-8")).get("growth") if (root / p).is_file() else None for p in POLICIES]
    pol = pols[0] or {}
    for p, g in zip(POLICIES, pols):
        if not g:
            bad.append(f"{p}: missing the growth block (growth_share_floor, min_metrics_per_product, owner_role, enforced_by)")
    if pols[0] != pols[1]:
        bad.append("growth policy differs between " + " and ".join(POLICIES))
    if pol and pol.get("growth_share_floor") != cfg.get("target_growth_share"):
        bad.append(f"policy growth_share_floor {pol.get('growth_share_floor')} != {PATH} target_growth_share {cfg.get('target_growth_share')}")
    need = int(pol.get("min_metrics_per_product", 2))
    known = {m.get("id") for m in cfg.get("metrics", [])}
    try:
        loops = {l.get("id"): l for l in json.loads((root / "instances/ultrastable/loop-registry.json").read_text(encoding="utf-8")).get("loops", [])}
    except FileNotFoundError:
        loops = {}
    prods = cfg.get("products") or []
    if not prods:
        bad.append(f"{PATH}: no products (each product names its growth metrics and an owner loop)")
    covered = set()
    for pr in prods:
        ms = [m for m in pr.get("metrics", []) if m in known]
        covered |= set(ms)
        if len(ms) < need:
            bad.append(f"product {pr.get('id')}: {len(ms)} growth metrics, needs at least {need}")
        lp = loops.get(pr.get("owner_loop"))
        if not lp:
            bad.append(f"product {pr.get('id')}: owner loop {pr.get('owner_loop')!r} is not in the loop registry")
        elif pol.get("owner_role") and lp.get("owner") != pol["owner_role"]:
            bad.append(f"product {pr.get('id')}: owner loop {lp.get('id')} is owned by {lp.get('owner')}, not {pol['owner_role']}")
    for m in sorted(known - covered):
        bad.append(f"metric {m}: belongs to no product")
    return bad


def main(argv) -> int:
    if "--report" in argv:
        print(json.dumps(snapshot(), indent=1))
        return 0
    bad = check()
    print(chr(10).join(bad) if bad else "growth ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

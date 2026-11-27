# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REACH-1: promotion and outreach as a closed loop that needs only the owner's ideas.

  python3 -m foundation reach [--check | --run [--apply] | --report]

GENERATE  posts from events the system already records (public changelog, settled insight findings, evergreen facts); every number must occur in the event.
PUBLISH   social/calendar.json is drained by scripts/social_post.py (owned accounts, when their bindings exist); /feed.xml and IndexNow need no account.
MEASURE   doctrine/reach.json targets, read from first-party hits (referrals by host, feed, Practical Solutions, suggestions) into ops/reach/metrics.jsonl.
LEARN     arm weights move toward the arm whose landing page outsiders reach; a change that lowers total reach is reverted next run.
ACT       a breached target files a growth item (Q-REACH-<id>). Cold outreach to individuals is out of scope.
"""
from __future__ import annotations
import hashlib, json, os, re, sys, time, datetime as dt
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/reach.json"
D = "ops/reach"


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def _rj(root, name, default):
    p = Path(root) / D / name
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default


def _wj(root, name, obj):
    p = Path(root) / D / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=1) + "\n", encoding="utf-8")


def _blocked(root):
    p = Path(root) / "social/guard.json"
    return json.loads((p if p.is_file() else REPO / "social/guard.json").read_text())["blocked_patterns"]


def clean(summary: str) -> str:
    s = re.sub(r"\s*\(#\d+\)\s*$", "", summary or "")
    s = re.sub(r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\s*[:,]\s*", "", s)
    return s.strip().rstrip(".")


def guard(text: str, event_text: str, root=REPO, limit=300) -> list[str]:
    bad, low = [], text.lower()
    if len(text) > limit:
        bad.append("too long")
    for p in _blocked(root):
        if re.search(p, low):
            bad.append("blocked pattern: " + p)
    if mentions(text):
        bad.append("mentions a person")
    for n in re.findall(r"\d+", re.sub(r"https?://\S+", "", text)):
        if n not in event_text:
            bad.append("number not in the event: " + n)
    return bad


def _hid(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:12]


def candidates(root=REPO, now=None) -> list[dict]:
    cfg, now = load(root), now or dt.datetime.now(dt.timezone.utc)
    out, site = [], cfg["site"]
    cl = Path(root) / "ops/changelog.json"
    for e in (json.loads(cl.read_text()).get("entries", []) if cl.is_file() else []):
        if e.get("tenant") != "ultrastable" or e.get("effect") != "kept" or e.get("kind") != "change":
            continue
        try:
            age = (now - dt.datetime.fromisoformat(e["at"])).days
        except (KeyError, ValueError):
            continue
        s = clean(e.get("summary", ""))
        if age > cfg["lookback_days"] or len(s) < 25 or s.startswith("Merge"):
            continue
        out.append({"id": e["id"], "arm": "shipped", "event": s, "text": f"Shipped by the system itself: {s}. {site}{cfg['arms']['shipped']['path']}"})
    st = Path(root) / "ops/insight/findings.json"
    for f in (json.loads(st.read_text()).get("findings", []) if st.is_file() else []):
        if f.get("verdict") == "held" and f.get("kind") == "rising" and f.get("path"):
            ev = f"{f['path']} held its readers"
            out.append({"id": "in-" + str(f.get("id", _hid(f["path"]))), "arm": "proof", "event": ev, "text": f"A page readers kept coming back to, and the prediction about it held: {site}{f['path']}"})
    out += evidence_candidates(root, now)
    for g in cfg["evergreen"]:
        out.append({"id": g["id"], "arm": g["arm"], "event": g["text"], "text": f"{g['text']} {site}{cfg['arms'][g['arm']]['path']}"})
    return out


def evidence_candidates(root=REPO, now=None) -> list[dict]:
    """ATTENTION-1: one post a week from the deploy record. Counts deploys whose live code matched their commit; claims self-origin only for rows marked so."""
    cfg, now = load(root), now or dt.datetime.now(dt.timezone.utc)
    att = cfg.get("attention") or {}
    win = int(att.get("evidence_window_days", 7))
    p = Path(root) / "ops/deploys.jsonl"
    if not p.is_file() or "evidence" not in cfg["arms"]:
        return []
    n = selfn = 0; workers = set(); shas = set()
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line); t = dt.datetime.fromisoformat(r["at"].replace("Z", "+00:00"))
        except (ValueError, KeyError):
            continue
        if (now - t).days < win and r.get("live_matches_commit") is True:
            n += 1; workers.add(r.get("worker")); shas.add(r.get("sha"))
            selfn += r.get("origin") in att.get("self_origins", [])
    if n == 0:
        return []
    wk = now.isocalendar()
    site, path = cfg["site"], cfg["arms"]["evidence"]["path"]
    own = f" {selfn} of them it started itself." if selfn else ""
    ev = f"{len(shas)} versions {n} deploys {len(workers)} services {win} days {selfn}"
    text = f"In the last {win} days Ultrastable put {len(shas)} new versions live ({n} deploys across {len(workers)} services) and checked each deploy against its code.{own} {site}{path}"
    return [{"id": f"evd-{wk[0]}-w{wk[1]:02d}", "arm": "evidence", "event": ev, "text": text}]


def mentions(text: str) -> bool:
    """ATTENTION-1: a post never addresses or names a person (no @handles)."""
    return bool(re.search(r"(^|\s)@[A-Za-z0-9_.-]+", text))


def weights(root=REPO) -> dict:
    return _rj(root, "weights.json", {"weights": {}, "history": []})["weights"]


def pick(cands: list[dict], w: dict, counts: dict) -> list[dict]:
    """Highest weight first; an arm with under two posts is explored first (UCB-style bonus)."""
    def score(c):
        n = counts.get(c["arm"], 0)
        return -(w.get(c["arm"], 1.0) * (1 + 1 / (1 + n) ** 0.5))
    return sorted(cands, key=score)


def refill(root=REPO, now=None, apply=False) -> list[dict]:
    cfg, now = load(root), now or dt.datetime.now(dt.timezone.utc)
    cp = Path(root) / "social/calendar.json"
    cal = json.loads(cp.read_text()) if cp.is_file() else {"posts": []}
    have = {p["id"] for p in cal["posts"]}
    counts: dict = {}
    for p in cal["posts"]:
        if p.get("arm"):
            counts[p["arm"]] = counts.get(p["arm"], 0) + 1
    added = []
    for c in pick([c for c in candidates(root, now) if "ev:" + c["id"] not in have], weights(root), counts):
        if len(added) >= cfg["max_new_per_run"]:
            break
        if guard(c["text"], c["event"], root):
            continue
        row = {"id": "ev:" + c["id"], "date": now.date().isoformat(), "text": c["text"], "source": "ops/changelog.json" if c["arm"] == "shipped" else "doctrine/reach.json",
               "arm": c["arm"], "kind": "event", "tag": "EVENT"}
        cal["posts"].append(row); added.append(row)
        counts[c["arm"]] = counts.get(c["arm"], 0) + 1
    if apply and added:
        cp.write_text(json.dumps(cal, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return added


# ---- measurement ----

def classify_ref(ref: str, cfg: dict) -> str:
    h = (ref or "").lower()
    if not h or any(h == d or h.endswith("." + d) for d in cfg["owned_domains"]):
        return "none"
    if any(h == d or h.endswith("." + d) for d in cfg["social_hosts"]):
        return "social"
    if any(h == d or h.endswith("." + d) for d in cfg["search_hosts"]):
        return "search"
    return "other"


def measure_rows(rows: list[dict], cfg: dict, posts_7d: int = 0, suggestions=None, now=None) -> dict:
    """rows: human hits {ref, path, name} for 7 days plus bot rows flagged bot=1 (only /feed.xml is read from those)."""
    m = {"external_referrals_7d": 0, "social_referrals_7d": 0, "search_referrals_7d": 0, "feed_hits_7d": 0, "ps_page_views_7d": 0, "posts_published_7d": posts_7d,
         "suggestions_7d": suggestions}
    by_path: dict = {}
    for r in rows:
        c = int(r.get("n", 1) or 1)  # ATTENTION-1: /api/reach rows are grouped counts
        if r.get("path") in ("/feed.xml", "/progress.atom"):
            m["feed_hits_7d"] += c
        if r.get("bot") or r.get("name") != "pageview":
            continue
        k = classify_ref(r.get("ref", ""), cfg)
        if k != "none":
            m["external_referrals_7d"] += c
            by_path[r["path"]] = by_path.get(r["path"], 0) + c
        if k == "social":
            m["social_referrals_7d"] += c
        if k == "search":
            m["search_referrals_7d"] += c
        if any(r["path"].startswith(p) for p in cfg["ps_path_prefixes"]):
            m["ps_page_views_7d"] += c
    m["by_path"] = by_path
    return m


def live_rows(env, now=None):
    from . import clock
    now = int(now or time.time()); w = int((now - 7 * 86400) * 1000)  # hits.at is epoch milliseconds; a bound in seconds read every raw row
    q = lambda sql: clock._cf("d1/database/5cd83b52-864a-4510-b062-fc0d9402d06c/query", {"sql": sql}, env["CLOUDFLARE_API_TOKEN"], "81e3a4efb4eb66e613529b87682911bb")["result"][0]["results"]
    return q(f"SELECT ref, path, name, bot FROM hits WHERE at>={w} AND (bot=0 OR path='/feed.xml') LIMIT 20000")


def site_rows(cfg, fetch=None):
    """Grouped 7-day counts the site Worker computes from its own D1 binding (GET /api/reach). Raises when unmeasured."""
    import urllib.request
    url = (cfg.get("attention") or {}).get("reach_url") or cfg["site"] + "/api/reach"
    if fetch is None:
        req = urllib.request.Request(url, headers={"user-agent": "ultrastable-reach"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read())
    else:
        body = fetch(url)
    rows = body.get("rows")
    if not isinstance(rows, list):
        raise ValueError("reach not measured yet")
    return rows


def posts_7d(root, now=None) -> int:
    p = Path(root) / "social/state.json"
    if not p.is_file():
        return 0
    now = now or dt.datetime.now(dt.timezone.utc)
    return sum(1 for x in json.loads(p.read_text()).get("posted", []) if (now.date() - dt.date.fromisoformat(x["date"])).days < 7)


def target_value(t: dict, st: dict) -> float:
    return st.get("targets", {}).get(t["id"], t["floor"])


def learn(root, cfg, m: dict, now_iso: str) -> dict:
    """Move arm weights toward the landing page outsiders reach; revert a change that lowered total reach."""
    wst = _rj(root, "weights.json", {"weights": {}, "history": []})
    hist = wst["history"]
    total = m["external_referrals_7d"]
    if hist and hist[-1].get("changed") and not hist[-1].get("settled"):
        prev = hist[-1]
        prev["settled"] = True
        if total < prev["total_before"] * cfg["revert_if_total_below"]:
            wst["weights"] = prev["weights_before"]; prev["verdict"] = "reverted"
        else:
            prev["verdict"] = "kept"
    cal = Path(root) / "social/calendar.json"
    posted = json.loads((Path(root) / "social/state.json").read_text()).get("posted", []) if (Path(root) / "social/state.json").is_file() else []
    arm_of = {p["id"]: p.get("arm") for p in (json.loads(cal.read_text())["posts"] if cal.is_file() else [])}
    n: dict = {}
    for p in posted:
        a = arm_of.get(p["id"])
        if a:
            n[a] = n.get(a, 0) + 1
    lo, hi = cfg["weight_bounds"]
    new = dict(wst["weights"])
    for a, spec in cfg["arms"].items():
        if n.get(a, 0) >= 2:  # no learning from fewer than two posts
            ext = m["by_path"].get(spec["path"], 0)
            new[a] = round(min(hi, max(lo, (1 + ext) / (1 + n[a]))), 3)
    changed = new != wst["weights"]
    if changed:
        hist.append({"at": now_iso, "weights_before": wst["weights"], "weights_after": new, "total_before": total, "changed": True,
                     "prediction": f"external_referrals_7d >= {int(total * cfg['revert_if_total_below'])} within 168 h"})
        wst["weights"] = new
    wst["history"] = hist[-30:]
    return wst


def write_feed(root=REPO, now=None) -> int:
    """site/feed-data.js from the public changelog (newest first, kept changes of this tenant, guarded like a post)."""
    cl = Path(root) / "ops/changelog.json"
    es = []
    for e in (json.loads(cl.read_text()).get("entries", []) if cl.is_file() else []):
        s = clean(e.get("summary", ""))
        if e.get("tenant") == "ultrastable" and e.get("effect") == "kept" and e.get("kind") == "change" and len(s) >= 25 and not guard(s, s, root):
            # CONTENT-DRIFT-1: every entry carries a text, read by /feed.json (content_text) and judged by foundation/contentdrift.py; it was empty
            areas = ", ".join(e.get("affected") or []) or "the platform"
            es.append({"id": e["id"], "at": e["at"], "title": s,
                       "summary": f"Shipped {e['at'][:10]} and kept: {s.rstrip('.')}. Parts changed: {areas}. Every entry here is a merged change read from the public changelog."})
    es.sort(key=lambda x: x["at"], reverse=True)
    seen: set = set()
    es = [x for x in es if not (x["title"].lower() in seen or seen.add(x["title"].lower()))]  # CONTENT-DRIFT-1: a repeated title is kept once, newest
    (Path(root) / "site/feed-data.js").write_text("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// Copyright (c) Ultrastable\n// GENERATED by python3 -m foundation reach --run --apply from ops/changelog.json. Do not edit.\nexport const FEED_ENTRIES = " + json.dumps(es[:40], indent=1) + ";\n", encoding="utf-8")
    return len(es[:40])


def run(root=REPO, apply=False, env=None, now=None, rows=None) -> dict:
    env = os.environ if env is None else env
    cfg, now = load(root), now or dt.datetime.now(dt.timezone.utc)
    rep: dict = {"feed_entries": write_feed(root) if apply else None, "at": now.isoformat(), "added": [{"id": a["id"], "arm": a["arm"]} for a in refill(root, now, apply)]}
    if rows is None and env.get("CLOUDFLARE_API_TOKEN"):
        try:
            rows = live_rows(env)
        except Exception as e:  # an unmeasured metric is a finding, never a zero
            rep["metrics_error"] = type(e).__name__ + ": " + str(e)[:120]
    if rows is None and env.get("REACH_OFFLINE") != "1":  # ATTENTION-1: second route, measured by the site Worker itself (no credential)
        try:
            rows = site_rows(cfg)
            rep["metrics_route"] = "site"
        except Exception as e:
            rep["metrics_error_site"] = type(e).__name__ + ": " + str(e)[:120]
    st = _rj(root, "status.json", {"targets": {}, "met_runs": {}})
    if rows is None:
        rep["metrics"] = "unmeasured"
    else:
        m = measure_rows(rows, cfg, posts_7d(root, now))
        rep["metrics"] = {k: v for k, v in m.items() if k != "by_path"}
        breaches, filed = [], []
        for t in cfg["targets"]:
            v, tv = m.get(t["id"]), target_value(t, st)
            if v is None:
                continue
            if v < tv:
                breaches.append(t["id"]); st["met_runs"][t["id"]] = 0
                filed.append({"id": f"Q-REACH-{t['id']}", "title": f"Q-REACH-{t['id']}: reach target missed ({t['what']}: {v} < {tv})",
                              "body": f"**Owner:** marketing-manager\n**Trigger:** reach --run\n**Done check:** grep:ops/reach/metrics.jsonl::\"{t['id']}\"\n**Prediction:** {t['id']} >= {tv} within 168 h\n**Status:** open\n\nRead ops/reach/weights.json and the arm outcomes, post more of the arm that works or add a surface (feed, listing, page). Owned channels only; no cold outreach to individuals.",
                              "labels": ["role:marketing-manager", "growth", "reach"], "milestone": "Next", "workstream": "Growth"})
            else:
                st["met_runs"][t["id"]] = st["met_runs"].get(t["id"], 0) + 1
                if st["met_runs"][t["id"]] >= cfg["raise_when_met_runs"]:
                    st["targets"][t["id"]] = round(tv * cfg["raise_factor"]); st["met_runs"][t["id"]] = 0
        rep["breaches"] = breaches
        wst = learn(root, cfg, m, now.isoformat())
        if apply:
            _wj(root, "weights.json", wst)
            with (Path(root) / D / "metrics.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps({"at": now.isoformat(), **rep["metrics"]}) + "\n")
            for it in filed:
                p = Path(root) / "docs/issues" / (it["id"] + ".json")
                p.parent.mkdir(parents=True, exist_ok=True)
                if not p.exists():
                    p.write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
            rep["filed"] = [i["id"] for i in filed]
    have = {k: all(os.environ.get(s) for s in a["secrets"]) if env is os.environ else all(env.get(s) for s in a["secrets"]) for a in cfg["acquisition"] for k in [a["channel"]]}
    rep["channels"] = {k: ("publishing" if v else "awaiting-account") for k, v in have.items()}
    if apply:
        _wj(root, "status.json", {**st, "last": rep})
    return rep


def check(root=REPO) -> list[str]:
    cfg, bad = load(root), []
    for a in cfg["arms"].values():
        if not a["path"].startswith("/"):
            bad.append("arm path must start with /")
    for g in cfg["evergreen"]:
        if g["arm"] not in cfg["arms"]:
            bad.append("evergreen " + g["id"] + ": unknown arm")
        if guard(g["text"], g["text"], root):
            bad.append("evergreen " + g["id"] + " fails the guard: " + "; ".join(guard(g["text"], g["text"], root)))
    for g in cfg["evergreen"]:
        if mentions(g["text"]):
            bad.append("evergreen " + g["id"] + " mentions a person")
    for t in cfg["targets"]:
        if t.get("floor") is None:
            bad.append("target " + t["id"] + " has no floor")
    return bad


def main(argv) -> int:
    if "--check" in argv:
        b = check(); print("\n".join(b) or "reach ok"); return 1 if b else 0
    rep = run(REPO, apply="--apply" in argv)
    print(json.dumps(rep, indent=1)); return 0

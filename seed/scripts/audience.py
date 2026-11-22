# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AUDIENCE-1 (Rowan, 2026-11-22): every system builds a returning audience. Ultrastable is the foundation for any autonomous system.

"Every ultra-stable app, every tenant, every platform needs to be sticky and give people a reason to come back. So we need breadth, depth,
diversity ... Fresh content is what builds audiences, and promoting that content too. That's where the social and the outreach comes."

One engine, carried by every seeded system (rules: autonomy/audience.json in a seed, doctrine/audience.json on the platform). Four stages, each
measured, each breach a finding with its own closing probe:

  SUPPLY    breadth (sections that published in the window / sections declared), depth (median words per new item), diversity (1 - Herfindahl
            index of new items across sections), freshness (days since the newest item, overall and per section), cadence (new items per week)
  PROMOTE   share of new items whose link was put on the social calendar (the posting loop and its consent gate do the sending)
  HOOK      the reason to engage, not only read: each system declares its hooks (a quiz, a tool, a live result the reader acts on) in its rules,
            pages fire window.ultrastableEvent(name), and engagement_7d is hook events per daily visitor. A system with no hook fails --check.
  ATTENTION depth and diversity of reading (pages per daily visitor, spread of views), from the cookieless analytics (analytics/analytics.js)
  RETURN    feed subscribers reported by aggregators, feed requests, followers on public profiles, inner pages reached with no referrer; growth is
            judged against the reading N days earlier in the series, and a target that holds for `ratchet_days` is raised by `ratchet` (the loop
            sets its own next goal)

Nothing is stored in a visitor's browser and no person is identified: the return signals are aggregates the platforms already publish.

  python3 scripts/audience.py --run [--apply]   measure, append ops/audience/series.jsonl, write ops/audience/state.json (targets, findings)
  python3 scripts/audience.py --probe METRIC    exit 0 when METRIC is within its target in the latest reading (closing probe of a Q-AUD item)
  python3 scripts/audience.py --check           the rules file is well formed
Sources the engine cannot read are reported as unmeasured, never as met."""
from __future__ import annotations
import datetime as dt, glob as _glob, json, os, re, statistics, subprocess, sys, urllib.parse, urllib.request
from pathlib import Path

RULES = ("doctrine/audience.json", "autonomy/audience.json")
OUT = "ops/audience"
DAY = 86400
WORD = re.compile(r"[A-Za-z][A-Za-z'-]+")


def rules(root) -> dict:
    for r in RULES:
        p = Path(root) / r
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
    raise FileNotFoundError("no audience rules (" + " or ".join(RULES) + ")")


def _now(today=None) -> float:
    return dt.datetime.fromisoformat(today).replace(tzinfo=dt.timezone.utc).timestamp() if today else dt.datetime.now(dt.timezone.utc).timestamp()


def _git_added(root, path) -> float | None:
    """When a file first entered the history (first commit that added it); None outside a git checkout."""
    try:
        out = subprocess.run(["git", "log", "--diff-filter=A", "--follow", "--format=%ct", "--", path], cwd=root, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"audience: git log failed for {path}: {e}", file=sys.stderr)
        return None
    ts = [int(x) for x in out.stdout.split() if x.isdigit()]
    return float(ts[-1]) if ts else None


def _at(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) / (1000 if v > 1e11 else 1)
    s = str(v).strip().replace("Z", "+00:00")
    try:
        d = dt.datetime.fromisoformat(s if "T" in s or "+" in s else s[:10])
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)).timestamp()


def items(root, section: dict) -> list[dict]:
    """New content of one section: [{at, words, url}]. kind glob: files (date from git, else mtime); kind json: a list in a JSON file."""
    root = Path(root)
    out = []
    if section["kind"] == "glob":
        for f in sorted(_glob.glob(str(root / section["glob"]), recursive=True)):
            rel = os.path.relpath(f, root)
            at = _git_added(root, rel) or os.path.getmtime(f)
            text = Path(f).read_text(encoding="utf-8", errors="replace")
            slug = Path(f).stem
            out.append({"at": at, "words": len(WORD.findall(text)), "url": section.get("url", "").replace("{slug}", slug)})
    elif section["kind"] == "json":
        p = root / section["path"]
        if not p.is_file():
            return []
        t = p.read_text(encoding="utf-8")
        if section.get("js_export"):
            t = t[t.index(section["js_export"]) + len(section["js_export"]):].strip().rstrip(";")
        d = json.loads(t)
        for k in section.get("list", "").split(".") if section.get("list") else []:
            d = d[k]
        for e in d:
            at = _at(e.get(section.get("date", "at")))
            if at is None:
                continue
            text = " ".join(str(e.get(k, "")) for k in section.get("text", ["title"]))
            out.append({"at": at, "words": len(WORD.findall(text)), "url": str(e.get(section.get("url_field", "url"), "") or "")})
    return out


def supply(root, cfg, now) -> dict:
    win = cfg["window_days"] * DAY
    per, fresh_all, new_all = {}, None, []
    for s in cfg["sections"]:
        its = [i for i in items(root, s) if i["at"] <= now]  # scheduled posts are not published yet
        new = [i for i in its if now - i["at"] <= win]
        latest = max((i["at"] for i in its), default=None)
        per[s["id"]] = {"items": len(its), "new": len(new), "fresh_days": None if latest is None else round((now - latest) / DAY, 1), "max_fresh_days": s.get("max_fresh_days")}
        new_all += [dict(i, section=s["id"]) for i in new]
        fresh_all = latest if fresh_all is None or (latest and latest > fresh_all) else fresh_all
    n = len(new_all)
    hhi = sum((per[k]["new"] / n) ** 2 for k in per) if n else 1.0
    return {"sections": per, "new": new_all,
            "values": {"breadth": round(sum(1 for k in per if per[k]["new"]) / max(1, len(per)), 3),
                       "depth_words": statistics.median([i["words"] for i in new_all]) if new_all else 0,
                       "content_diversity": round(1 - hhi, 3),
                       "fresh_days": None if fresh_all is None else round((now - fresh_all) / DAY, 1),
                       "cadence_per_week": round(n / (cfg["window_days"] / 7), 2)}}


def promoted_share(root, cfg, new) -> float | None:
    p = Path(root) / cfg["promotion"]["calendar"]
    urls = [i["url"] for i in new if i["url"]]
    if not p.is_file() or not urls:
        return None
    blob = p.read_text(encoding="utf-8")
    return round(sum(1 for u in urls if u in blob) / len(urls), 3)


# ---- attention and return: sources that read the outside world ----

def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"user-agent": "ultrastable-audience/1 (+https://ultrastable.io/research)", "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def followers(cfg, get=_get) -> dict:
    """Public follower counts; no credential. {channel:handle: n or None}."""
    out = {}
    for a in cfg.get("followers", []):
        key = a["channel"] + ":" + a["handle"]
        try:
            if a["channel"] == "bluesky":
                out[key] = int(get("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=" + urllib.parse.quote(a["handle"]))["followersCount"])
            elif a["channel"] == "mastodon":
                user, inst = a["handle"].lstrip("@").split("@", 1)
                out[key] = int(get(f"https://{inst}/api/v1/accounts/lookup?acct={urllib.parse.quote(user)}")["followers_count"])
            else:
                out[key] = None
        except Exception as e:  # a missing profile or a network error is unmeasured, never zero
            print(f"audience: followers {key} unmeasured: {e}", file=sys.stderr)
            out[key] = None
    return out


ATTENTION_SQL = ("SELECT SUM(CASE WHEN name='pageview' AND bot=0 THEN 1 ELSE 0 END) pv, SUM(CASE WHEN name='feed' THEN 1 ELSE 0 END) feeds, "
                 "COUNT(DISTINCT CASE WHEN name='pageview' AND bot=0 THEN vid||substr(datetime(at/1000,'unixepoch'),1,10) END) vis, "
                 "SUM(CASE WHEN name='pageview' AND bot=0 AND ref='' AND path<>'/' THEN 1 ELSE 0 END) deep, "
                 "SUM(CASE WHEN name LIKE 'ev:%%' AND bot=0 THEN 1 ELSE 0 END) ev FROM hits WHERE at>=%d")
PATHS_SQL = "SELECT path, COUNT(*) v FROM hits WHERE name='pageview' AND bot=0 AND at>=%d GROUP BY host, path"
SUBS_SQL = "SELECT value FROM analytics_meta WHERE key LIKE 'subs:%'"


def attention(query, now) -> dict:
    """query(sql) -> rows, over the analytics tables (D1 over the Cloudflare API, or sqlite in tests). Same definitions as analytics.js measure()."""
    w = int((now - 7 * DAY) * 1000)
    a = (query(ATTENTION_SQL % w) or [{}])[0]
    pv, vis = int(a.get("pv") or 0), int(a.get("vis") or 0)
    paths = query(PATHS_SQL % w)
    hhi = sum((int(r["v"]) / pv) ** 2 for r in paths) if pv else 1.0
    subs = 0
    for r in query(SUBS_SQL):
        try:
            o = json.loads(r["value"])
        except (ValueError, TypeError) as e:
            print(f"audience: subscriber row unreadable: {e}", file=sys.stderr)
            continue
        if now * 1000 - o.get("at", 0) < 14 * DAY * 1000:
            subs += int(o.get("n", 0))
    return {"pageviews_7d": pv, "depth_7d": round(pv / vis, 2) if vis else 0, "diversity_7d": round(1 - hhi, 3),
            "direct_deep_share_7d": round(int(a.get("deep") or 0) / pv, 3) if pv else 0, "feed_fetches_7d": int(a.get("feeds") or 0), "feed_subscribers": subs,
            "engagement_7d": round(int(a.get("ev") or 0) / vis, 3) if vis else 0}


def d1_query(env=os.environ):
    tok, acct, db = env.get("CLOUDFLARE_API_TOKEN"), env.get("CLOUDFLARE_ACCOUNT_ID"), env.get("ANALYTICS_D1_ID")
    if not (tok and acct and db):
        return None

    def q(sql):
        req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{db}/query", data=json.dumps({"sql": sql}).encode(),
                                     headers={"authorization": "Bearer " + tok, "content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())["result"][0]["results"]
    return q


# ---- judge, ratchet, record ----

def _series(root) -> list[dict]:
    p = Path(root) / OUT / "series.jsonl"
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.is_file() else []


def _earlier(series, metric, now, days):
    for r in reversed(series):
        if now - r["t"] >= days * DAY - 3600 and r["values"].get(metric) is not None:
            return r["values"][metric]
    return None


def judge(values: dict, cfg: dict, targets: dict, series: list, now: float) -> list[dict]:
    out = []
    for m in cfg["metrics"]:
        v, t = values.get(m["id"]), targets.get(m["id"], m.get("target"))
        row = {"id": m["id"], "stage": m["stage"], "value": v, "target": t, "op": m["op"], "remedy": m["remedy"]}
        if v is None:
            row.update(status="unmeasured", why=f"{m['id']}: no source could be read")
        elif m["op"] == "grows":
            prev = _earlier(series, m["id"], now, m.get("over_days", 7))
            row["previous"] = prev
            ok = prev is None or v >= prev
            row.update(status="met" if ok else "breach", why=f"{m['id']} = {v}, {m.get('over_days', 7)} days ago {prev}")
        else:
            ok = v >= t if m["op"] == ">=" else v <= t
            row.update(status="met" if ok else "breach", why=f"{m['id']} = {v} (target {m['op']} {t})")
        out.append(row)
    for sid, s in values.get("_sections", {}).items():
        if s["max_fresh_days"] is not None:
            ok = s["fresh_days"] is not None and s["fresh_days"] <= s["max_fresh_days"]
            out.append({"id": "fresh:" + sid, "stage": "supply", "value": s["fresh_days"], "target": s["max_fresh_days"], "op": "<=",
                        "remedy": next(x.get("producer", "") for x in cfg["sections"] if x["id"] == sid),
                        "status": "met" if ok else "breach", "why": f"section {sid}: newest item {s['fresh_days']} days old (limit {s['max_fresh_days']})"})
    return out


def ratchet(rows, cfg, state, now) -> list[dict]:
    """A >= target met for ratchet_days in a row is raised by ratchet (bounded by cap). Returns the changes, each with its prediction."""
    changes, held = [], state.setdefault("held_since", {})
    for r in rows:
        m = next((x for x in cfg["metrics"] if x["id"] == r["id"]), None)
        if not m or m["op"] != ">=" or "ratchet" not in m or r["status"] != "met":
            if m:
                held.pop(r["id"], None)
            continue
        since = held.setdefault(r["id"], now)
        if now - since >= cfg["ratchet_days"] * DAY:
            new = round(min(m.get("cap", float("inf")), max(r["target"] * m["ratchet"], r["target"] + m.get("step", 0))), 3)
            if new > r["target"]:
                state.setdefault("targets", {})[r["id"]] = new
                held[r["id"]] = now
                changes.append({"id": r["id"], "from": r["target"], "to": new, "prediction": f"{r['id']} >= {new} within {cfg['ratchet_days'] * 24} h"})
    return changes


def run(root, apply=False, today=None, query=None, get=_get, live=True) -> dict:
    root, now = Path(root), _now(today)
    cfg = rules(root)
    sp = supply(root, cfg, now)
    values = dict(sp["values"])
    values["promoted_share"] = promoted_share(root, cfg, sp["new"])
    q = query if query is not None else (d1_query() if live else None)
    try:
        values.update(attention(q, now) if q else {})
    except Exception as e:  # an unreadable analytics source leaves those metrics unmeasured
        print(f"audience: analytics unmeasured: {e}", file=sys.stderr)
    fol = followers(cfg, get) if live else {}
    known = [v for v in fol.values() if v is not None]
    values["followers"] = sum(known) if known else None
    sp_path = root / OUT / "state.json"
    state = json.loads(sp_path.read_text(encoding="utf-8")) if sp_path.is_file() else {}
    series = _series(root)
    rows = judge(dict(values, _sections=sp["sections"]), cfg, state.get("targets", {}), series, now)
    changes = ratchet(rows, cfg, state, now)
    at = dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(timespec="seconds")
    rec = {"at": at, "t": now, "values": values, "followers": fol, "sections": sp["sections"], "rows": rows, "ratchet": changes,
           "findings": [r for r in rows if r["status"] == "breach"], "unmeasured": [r["id"] for r in rows if r["status"] == "unmeasured"]}
    if apply:
        (root / OUT).mkdir(parents=True, exist_ok=True)
        with (root / OUT / "series.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"t": now, "at": at, "values": values}, sort_keys=True) + "\n")
        state.update(at=at, rows=rows, last_ratchet=changes or state.get("last_ratchet", []))
        sp_path.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return rec


def probe(root, metric) -> tuple[bool, str]:
    st = Path(root) / OUT / "state.json"
    if not st.is_file():
        return False, "no audience reading yet"
    row = next((r for r in json.loads(st.read_text(encoding="utf-8")).get("rows", []) if r["id"] == metric), None)
    if not row:
        return False, f"{metric}: not in the latest reading"
    return row["status"] == "met", row["why"] + f" [{row['status']}]"


def check(root) -> list[str]:
    try:
        cfg = rules(root)
    except (FileNotFoundError, ValueError) as e:
        return [str(e)]
    errs = []
    for k in ("window_days", "ratchet_days", "sections", "metrics", "promotion"):
        if k not in cfg:
            errs.append(f"missing {k}")
    stages = {m.get("stage") for m in cfg.get("metrics", [])}
    if not cfg.get("hooks"):
        errs.append("no hooks: declare at least one reason to engage (a quiz, a tool, a live result) with the event its page fires")
    for s in ("supply", "promote", "hook", "attention", "return"):
        if s not in stages:
            errs.append(f"no metric for stage {s}: every stage of the audience loop is measured")
    for m in cfg.get("metrics", []):
        if m.get("op") not in (">=", "<=", "grows") or not m.get("remedy"):
            errs.append(f"metric {m.get('id')}: needs op (>=, <=, grows) and a remedy")
    for s in cfg.get("sections", []):
        if s.get("kind") not in ("glob", "json") or not s.get("producer"):
            errs.append(f"section {s.get('id')}: needs kind glob|json and the producer that keeps it fresh")
    return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    root = Path(os.environ.get("AUDIENCE_ROOT", Path(__file__).resolve().parents[1]))
    if "--check" in a:
        e = check(root)
        print("\n".join(e) or "audience rules ok")
        return 1 if e else 0
    if "--probe" in a:
        ok, why = probe(root, a[a.index("--probe") + 1])
        print(why)
        return 0 if ok else 1
    rec = run(root, apply="--apply" in a)
    print(json.dumps({k: rec[k] for k in ("at", "values", "findings", "unmeasured", "ratchet")}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

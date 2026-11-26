"""INSIGHT-1: analytics as a feedback loop. Per-page trends from the first-party, cookieless hits become findings, growth items, settled outcomes and a self-tuned threshold.

  python3 -m foundation insight [--check | --report | --run [--apply] | --settled ID]

SENSE   the last 7 days of every content page against the 7 before (human page views, outside-referred views, distinct visitors); bots and non-content paths are left out.
DIAGNOSE rising (views at least rise_ratio times the week before and at least the knob), external_pull (outside readers arriving), fading (a page that held the knob and lost most of it).
ACT     at most max_actions_per_day growth items filed per UTC day for rising and external_pull pages, never twice for one page inside cooldown_days of its last filing
        (docs/issues/Q-INSIGHT-*.json; foundation/growth.py prefers growth items while the growth share is under its target).
VERIFY  settle_after_days later each finding is compared with what the page really got: held when the prediction came true, missed otherwise (ops/insight/findings.json is the ledger).
        A week with no human page view at all is unmeasured, never zero: nothing settles or tunes on it.
WRITE-BACK the knob rise_min_views goes up when under raise_below of the last settled rising findings held and down when over lower_above did, bounded, once per new settled finding.

Doctrine and thresholds: doctrine/insight.json. Run by foundation/pm.py inside the product manager pass.
"""
from __future__ import annotations
import hashlib, json, os, re, sys, time
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/insight.json"
STATE = "ops/insight/findings.json"
DAY = 86400


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def read_state(root=REPO) -> dict:
    p = Path(root) / STATE
    if p.is_file():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"rise_min_views": None, "knob_log": [], "findings": []}


def write_state(root, st: dict) -> None:
    p = Path(root) / STATE
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(st, indent=1) + chr(10), encoding="utf-8")


def knob(st: dict, cfg: dict) -> float:
    return float(st.get("rise_min_views") or cfg["rise_min_views"])


# ---- sources: rows of hits (tests, offline) or the live D1 ----

def _ref_host(ref: str) -> str:
    """The host of a referrer. seed/analytics stores a bare host (and '' for the site itself); a full URL is read too."""
    ref = (ref or "").strip().lower()
    if not ref:
        return ""
    if "//" in ref:
        return (urlparse(ref).hostname or "").lower()
    return ref.split("/")[0].split(":")[0]


def _external(ref: str, host: str) -> bool:
    h, host = _ref_host(ref), (host or "").lower()
    return bool(h) and not (h == host or h.endswith("." + host))


class RowsSource:
    """Hits as dicts {at, host, path, ref, bot, vid, name}, `at` in seconds; `ref` a bare host as seed/analytics writes it, or a URL."""

    def __init__(self, rows):
        self.rows = rows

    def trends(self, now: float, cfg: dict) -> list[dict]:
        w = cfg["window_days"] * DAY
        out: dict = {}
        for r in self.rows:
            if r.get("bot") or r.get("name", "pageview") != "pageview" or r["at"] < now - 2 * w or r["at"] > now:
                continue
            t = out.setdefault(r["path"], {"path": r["path"], "v7": 0, "prev7": 0, "ext7": 0, "vis": set()})
            if r["at"] >= now - w:
                t["v7"] += 1
                t["ext7"] += 1 if _external(r.get("ref", ""), r.get("host", "")) else 0
                t["vis"].add(r.get("vid"))
            else:
                t["prev7"] += 1
        return [{"path": t["path"], "v7": t["v7"], "prev7": t["prev7"], "ext7": t["ext7"], "visitors7": len(t["vis"])} for t in out.values()]

    def observed(self, path: str, start: float, end: float) -> int:
        return sum(1 for r in self.rows if r["path"] == path and not r.get("bot") and r.get("name", "pageview") == "pageview" and start <= r["at"] < end)

    def views(self, start: float, end: float) -> int:
        """Human page views on any path in [start, end): zero means the window holds no reading, not a quiet page."""
        return sum(1 for r in self.rows if not r.get("bot") and r.get("name", "pageview") == "pageview" and start <= r["at"] < end)


class LiveSource:
    """Aggregated reads of the hits table in D1 over the Cloudflare API (the same call growth.hits_metrics makes).
    seed/analytics writes `at` as Date.now(), in milliseconds, and `ref` as a bare host ('' for the site itself), so every bound is in ms."""

    def __init__(self, token: str, acct: str, db: str):
        self.token, self.acct, self.db = token, acct, db

    def _q(self, sql: str) -> list[dict]:
        from . import clock
        return clock._cf(f"d1/database/{self.db}/query", {"sql": sql}, self.token, self.acct)["result"][0]["results"]

    def trends(self, now: float, cfg: dict) -> list[dict]:
        w = cfg["window_days"] * DAY
        a, b, e = _ms(now - w), _ms(now - 2 * w), _ms(now)
        rows = self._q(
            "SELECT path, SUM(CASE WHEN at>=%d THEN 1 ELSE 0 END) AS v7, SUM(CASE WHEN at<%d THEN 1 ELSE 0 END) AS prev7, "
            "SUM(CASE WHEN at>=%d AND ref<>'' AND lower(ref)<>lower(host) AND lower(ref) NOT LIKE '%%.'||lower(host) THEN 1 ELSE 0 END) AS ext7, "
            "COUNT(DISTINCT CASE WHEN at>=%d THEN vid END) AS visitors7 "
            "FROM hits WHERE bot=0 AND name='pageview' AND at>=%d AND at<=%d GROUP BY path" % (a, a, a, a, b, e))
        return [{"path": r["path"], "v7": int(r["v7"] or 0), "prev7": int(r["prev7"] or 0), "ext7": int(r["ext7"] or 0), "visitors7": int(r["visitors7"] or 0)} for r in rows]

    def observed(self, path: str, start: float, end: float) -> int:
        p = path.replace("'", "''")
        r = self._q(f"SELECT COUNT(*) AS n FROM hits WHERE bot=0 AND name='pageview' AND path='{p}' AND at>={_ms(start)} AND at<{_ms(end)}")
        return int(r[0]["n"]) if r else 0

    def views(self, start: float, end: float) -> int:
        r = self._q(f"SELECT COUNT(*) AS n FROM hits WHERE bot=0 AND name='pageview' AND at>={_ms(start)} AND at<{_ms(end)}")
        return int(r[0]["n"]) if r else 0


def _ms(t: float) -> int:
    return int(t * 1000)


def source_from_env(cfg: dict, env=None):
    env = os.environ if env is None else env
    if env.get("CLOUDFLARE_API_TOKEN"):
        return LiveSource(env["CLOUDFLARE_API_TOKEN"], cfg["source"]["account"], cfg["source"]["db"])
    return None


# ---- diagnose ----

def content(path: str, cfg: dict) -> bool:
    return not any(re.search(p, path) for p in cfg["ignore_paths"])


def classify(t: dict, min_views: float, cfg: dict) -> str | None:
    if not content(t["path"], cfg):
        return None
    if t["ext7"] >= cfg["external_pull_min"]:
        return "external_pull"
    if t["v7"] >= min_views and t["v7"] >= cfg["rise_ratio"] * max(t["prev7"], 1):
        return "rising"
    if t["prev7"] >= min_views and t["v7"] < cfg["fade_ratio"] * t["prev7"]:
        return "fading"
    return None


def fid(day: str, kind: str, path: str) -> str:
    return hashlib.sha1(f"{day}|{kind}|{path}".encode()).hexdigest()[:10]


def _day(now: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(now))


# ---- verify and write back ----

def settle(st: dict, source, now: float, cfg: dict) -> list[str]:
    """A finding settles settle_after_days after it was recorded, against the page's views in the window_days after it.
    A window in which the source holds no human page view on any path is unmeasured (the collector or the table was down): the finding stays open."""
    done = []
    for f in st["findings"]:
        if f["status"] == "settled" or now - f["at"] < cfg["settle_after_days"] * DAY:
            continue
        start, end = f["at"], f["at"] + cfg["window_days"] * DAY
        if source.views(start, end) == 0:
            continue
        obs = source.observed(f["path"], start, end)
        held = obs <= cfg["fade_hold_ratio"] * f["v7"] if f["kind"] == "fading" else obs >= cfg["hold_ratio"] * f["v7"]
        f.update({"status": "settled", "observed": obs, "outcome": "held" if held else "missed", "settled_at": now})
        done.append(f["id"])
    return done


def tune(st: dict, cfg: dict, now: float) -> dict | None:
    """Raise or lower the rising threshold from the last settled rising findings, once per new settled finding, inside the bounds."""
    k = cfg["knob"]
    rec = sorted([f for f in st["findings"] if f["kind"] == "rising" and f["status"] == "settled"], key=lambda f: f["settled_at"], reverse=True)[:20]
    last = st["knob_log"][-1]["at"] if st["knob_log"] else 0
    if len(rec) < k["min_settled"] or max(f["settled_at"] for f in rec) <= last:
        return None
    rate = sum(1 for f in rec if f["outcome"] == "held") / len(rec)
    cur = knob(st, cfg)
    new = cur
    if rate < k["raise_below"]:
        new = min(k["max"], round(cur * k["raise"]))
    elif rate > k["lower_above"]:
        new = max(k["min"], round(cur * k["lower"]))
    if new == cur:
        return None
    st["rise_min_views"] = new
    entry = {"at": now, "from": cur, "to": new, "held_rate": round(rate, 2), "of": len(rec),
             "prediction": "rising findings held at least %.0f percent over the next 20 settled" % (100 * k["raise_below"] if new > cur else 100 * k["lower_above"])}
    st["knob_log"].append(entry)
    return entry


# ---- act ----

def _action_text(f: dict) -> tuple[str, str]:
    if f["kind"] == "external_pull":
        what = f"outside readers are arriving at `{f['path']}` ({f['ext7']} outside-referred views of {f['v7']} in 7 days)"
        todo = ("Give the page a clear next step (a related page, the interview, the pilot path) and one sentence for a reader who arrived from elsewhere; "
                "then find where they come from (the referrer column of the hits) and make that source easier to follow.")
    else:
        what = f"`{f['path']}` is rising ({f['v7']} views in 7 days against {f['prev7']} the week before)"
        todo = "Extend the page with the next question a reader of it would ask, and link it from the pages that already lead there."
    pred = f"Prediction: `{f['path']}` keeps at least 50 percent of {f['v7']} views over the 7 days after this item is filed."
    return what, todo + "\n\n" + pred


def _filed_at(f: dict) -> float:
    """When the finding's item was filed; a finding filed before the time was stored counts from its own time."""
    return f.get("filed_at") or f["at"]


def act(root, st: dict, cfg: dict, now: float, write=True) -> list[str]:
    """The day's budget counts the items filed on this UTC day (not the findings recorded on it), so a rerun on the same day over a backlog
    of earlier findings files nothing more; the cooldown of a page runs from the day its last item was filed."""
    from . import pm
    today = _day(now)
    used = sum(1 for f in st["findings"] if f.get("item") and _day(_filed_at(f)) == today)
    filed = []
    cand = sorted([f for f in st["findings"] if f["status"] == "open" and f["kind"] in ("rising", "external_pull") and not f.get("item")],
                  key=lambda f: f["ext7"] * 3 + f["v7"], reverse=True)
    for f in cand:
        if used >= cfg["max_actions_per_day"]:
            break
        if any(g.get("item") and g["path"] == f["path"] and now - _filed_at(g) < cfg["cooldown_days"] * DAY for g in st["findings"]):
            continue
        what, todo = _action_text(f)
        iid = f"Q-INSIGHT-{f['id']}"
        probe = f"cmd:python3 -m foundation insight --settled {f['id']}"
        text = (f"Analytics loop finding ({f['kind']}): {what}. Source: first-party cookieless hits, no opt-in gate.\n\n{todo}\n\n"
                f"This item closes when the finding settles (8 days): the measured outcome is written to {STATE}, and the loop tunes its threshold from it.")
        if write:
            pm._write_item(root, iid, f"{f['kind'].replace('_', ' ')} on {f['path']}", probe, text, cfg["item"]["labels"], cfg["item"]["workstream"], cfg["item"]["owner"])
        f["item"] = iid
        f["filed_at"] = now
        f["status"] = "acted"
        used += 1
        filed.append(iid)
    for f in st["findings"]:
        if f["status"] == "open" and f["kind"] == "fading":
            f["status"] = "acted"   # decay is recorded and settled; it tunes the thresholds and is reported, no item is filed for it
    return filed


# ---- the pass ----

def run(root=REPO, apply=False, now=None, source=None, use_live=True, env=None) -> dict:
    now = float(now or time.time())
    cfg, st = load(root), read_state(root)
    source = source or (source_from_env(cfg, env) if use_live else None)
    if source is None:
        return {"generated": _day(now), "measured": False, "why": "no hits source (no CLOUDFLARE_API_TOKEN and no rows)", "filed": []}
    trends = source.trends(now, cfg)
    if not any(t["v7"] for t in trends):
        # BLINDSPOT-RED-1: a reading that is empty is unmeasured, never zero. A week with no human page view on any path means the collector or the
        # table is down, so nothing is settled, tuned, recorded, filed or written.
        return {"generated": _day(now), "measured": False, "why": "the hits source holds no human page view in the last %d days" % cfg["window_days"], "filed": []}
    settled = settle(st, source, now, cfg)
    tuned = tune(st, cfg, now)
    m = knob(st, cfg)
    new = []
    for t in trends:
        kind = classify(t, m, cfg)
        if not kind or any(f["path"] == t["path"] and f["kind"] == kind and now - f["at"] < 7 * DAY for f in st["findings"]):
            continue
        f = {"id": fid(_day(now), kind, t["path"]), "kind": kind, "path": t["path"], "at": now, "v7": t["v7"], "prev7": t["prev7"], "ext7": t["ext7"],
             "visitors7": t.get("visitors7"), "status": "open", "item": None, "observed": None, "outcome": None,
             "predicted": "next7 <= %.1f * v7" % cfg["fade_hold_ratio"] if kind == "fading" else "next7 >= %.1f * v7" % cfg["hold_ratio"]}
        st["findings"].append(f)
        new.append(f)
    filed = act(root, st, cfg, now, write=apply)
    if apply:
        write_state(root, st)
    done = [f for f in st["findings"] if f["status"] == "settled" and f["settled_at"] >= now - 28 * DAY]
    return {"generated": _day(now), "measured": True, "rise_min_views": m, "new": [{k: f[k] for k in ("id", "kind", "path", "v7", "prev7", "ext7")} for f in new],
            "filed": filed, "settled": settled, "tuned": tuned,
            "precision_28d": round(sum(1 for f in done if f["outcome"] == "held") / len(done), 2) if done else None, "open": sum(1 for f in st["findings"] if f["status"] != "settled")}


def check(root=REPO) -> list[str]:
    bad, cfg = [], load(root)
    for k in ("window_days", "rise_min_views", "rise_ratio", "fade_ratio", "external_pull_min", "max_actions_per_day", "cooldown_days", "settle_after_days", "hold_ratio", "fade_hold_ratio", "knob", "ignore_paths", "source", "item"):
        if k not in cfg:
            bad.append(f"{PATH}: missing {k}")
    if bad:
        return bad
    if cfg["settle_after_days"] <= cfg["window_days"]:
        bad.append("settle_after_days must exceed window_days (the analytics of the last day arrive late)")
    if not (cfg["knob"]["min"] <= cfg["rise_min_views"] <= cfg["knob"]["max"]):
        bad.append("rise_min_views is outside the knob bounds")
    if "growth" not in cfg["item"]["labels"]:
        bad.append("filed items must carry the growth label so the executor takes them first")
    try:
        loops = {l.get("id") for l in json.loads((Path(root) / "instances/ultrastable/loop-registry.json").read_text(encoding="utf-8")).get("loops", [])}
        if "insight-loop" not in loops:
            bad.append("insight-loop is not in instances/ultrastable/loop-registry.json")
    except FileNotFoundError:
        bad.append("loop registry missing")
    if "insight" not in (Path(root) / "foundation/pm.py").read_text(encoding="utf-8"):
        bad.append("foundation/pm.py does not run the insight stage")
    return bad


def main(argv) -> int:
    a = list(argv)
    if "--settled" in a:
        i = a.index("--settled")
        fids = {f["id"]: f for f in read_state()["findings"]}
        f = fids.get(a[i + 1] if i + 1 < len(a) else "")
        print(json.dumps({"id": a[i + 1] if i + 1 < len(a) else None, "settled": bool(f and f["status"] == "settled"), "outcome": f and f.get("outcome")}))
        return 0 if f and f["status"] == "settled" else 1
    if "--run" in a or "--report" in a:
        print(json.dumps(run(apply="--apply" in a), indent=1))
        return 0
    bad = check()
    print(chr(10).join(bad) if bad else "insight ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

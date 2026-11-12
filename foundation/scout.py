"""SCOUT-1: the product manager's standing research loop as code (owner, 2026-11-12). Ultrastable is the foundation for any autonomous system.

A product manager keeps looking at what competitors, platforms and best-practice bodies ship, and decides what to adopt. This does that on a schedule, server-side:

  python3 -m foundation scout --run [--apply]   re-read every due source, diff against stored line hashes, file a finding + queue item per relevant change
  python3 -m foundation scout --check           watchlist structure, components exist in market.json, every finding has a queue item, closed items have a disposition
  python3 -m foundation scout --report          per source: kind, age, failures; findings awaiting a disposition
  python3 -m foundation scout --disposition FID adopt|have|reject --why TEXT [--gap GAP_ID]   record the decision (adopt needs an existing market.json gap or feature)
  python3 -m foundation scout --dispositioned FID   closing probe: exit 0 once the finding has a disposition

Data: doctrine/scout.json (watchlist, internal), doctrine/scout-state.json (line hashes, findings, failures; written by --run --apply).
The first read of a source is a baseline and files nothing. A fetch failure is recorded with its error and counted, never skipped silently; three in a row
file a Q-SCOUT-FETCH-<id> item. Excerpts kept in findings are short and internal. Network goes through the injected `http(url) -> (code, text)`.
"""
from __future__ import annotations
import datetime as dt, hashlib, json, re, sys, urllib.error, urllib.request
from pathlib import Path
from . import queue, market

REPO = Path(__file__).resolve().parents[1]
WATCH, STATE = "doctrine/scout.json", "doctrine/scout-state.json"
KINDS = {"competitor", "platform", "best-practice"}
DISPOSITIONS = {"adopt", "have", "reject"}


def load(root=REPO) -> dict:
    return json.loads((Path(root) / WATCH).read_text(encoding="utf-8"))


def load_state(root=REPO) -> dict:
    p = Path(root) / STATE
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {"sources": {}, "findings": {}}


def save_state(root, st) -> None:
    (Path(root) / STATE).write_text(json.dumps(st, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def default_http(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-scout/1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, ""  # recorded as a failed read by run(), with its count


def lines_of(html: str) -> list[str]:
    t = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", html)
    t = re.sub(r"(?i)</?(p|div|li|h[1-6]|tr|br|section|article|ul|ol)\b[^>]*>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    out = []
    for ln in t.split("\n"):
        ln = re.sub(r"\s+", " ", ln).strip()
        if len(ln) >= 25:
            out.append(ln)
    return out


H = lambda s: hashlib.sha256(s.lower().encode()).hexdigest()[:12]


def score(new: list[str], keywords: list[str]) -> tuple[int, list[str]]:
    hits = [ln for ln in new if any(k.lower() in ln.lower() for k in keywords)]
    return len(hits), hits


def _due(src, rec, now) -> bool:
    last = rec.get("last_checked")
    return not last or (now - dt.datetime.fromisoformat(last)).days >= src["cadence_days"]


def run(root=REPO, http=default_http, now=None, apply=False, force=False) -> dict:
    root, now = Path(root), now or dt.datetime.now(dt.timezone.utc)
    d, st = load(root), load_state(root)
    res = {"read": [], "baseline": [], "unchanged": [], "findings": [], "failed": []}
    for s in d["sources"]:
        rec = st["sources"].setdefault(s["id"], {})
        if not force and not _due(s, rec, now):
            continue
        code, text = http(s["url"])
        rec["last_checked"] = now.isoformat(timespec="seconds")
        if code != 200 or not text.strip():
            rec["fail_count"] = rec.get("fail_count", 0) + 1
            rec["last_error"] = f"HTTP {code}" if code != 200 else "empty body"
            res["failed"].append(f"{s['id']}: {rec['last_error']}")
            continue
        rec["fail_count"], rec["last_error"] = 0, ""
        ls = lines_of(text)
        seen = set(rec.get("hashes", []))
        new = [ln for ln in ls if H(ln) not in seen]
        first = "hashes" not in rec
        rec["hashes"] = sorted(seen | {H(ln) for ln in ls})[-4000:]
        res["read"].append(s["id"])
        if first:
            res["baseline"].append(s["id"])
            continue
        n, hits = score(new, s["keywords"])
        if n < d["min_score"]:
            res["unchanged"].append(s["id"])
            continue
        fid = f"{s['id']}-{now:%Y%m%d}"
        if fid in st["findings"]:
            continue
        st["findings"][fid] = {"source": s["id"], "kind": s["kind"], "url": s["url"], "components": s["components"], "score": n,
                               "excerpts": [h[:200] for h in hits[:5]], "found": now.date().isoformat(), "disposition": None}
        res["findings"].append(fid)
    if apply:
        save_state(root, st)
        res["filed"] = _file_items(root, st)
    res["state"] = st
    return res


def _item(root, iid, title, probe, extra, labels) -> bool:
    p = Path(root) / "docs/issues" / f"{iid}.json"
    if p.exists():
        return False
    body = f"**Owner:** product-manager\n**Trigger:** every executor run\n**Done check:** {probe}\n**Status:** open\n\n{extra}"
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": body, "labels": labels, "milestone": "Next", "workstream": "Research"}, indent=2) + "\n", encoding="utf-8")
    return True


def _file_items(root, st) -> list[str]:
    made = []
    for fid, f in st["findings"].items():
        ex = "\n".join(f"- {e}" for e in f["excerpts"])
        if _item(root, "Q-SCOUT-" + fid, f"{f['source']} changed ({f['kind']}); decide adopt, have or reject",
                 f"cmd:python3 -m foundation scout --dispositioned {fid}",
                 f"New text at {f['url']} matched {f['score']} keyword line(s) for components {', '.join(f['components'])}:\n{ex}\n\n"
                 f"Decide by code: `python3 -m foundation scout --disposition {fid} adopt --gap <market.json gap or feature id> --why ...` (file the gap first), "
                 f"`have` (name the feature that already covers it) or `reject` (say why). Source: doctrine/scout.json (SCOUT-1).",
                 ["role:product-manager", "research"]):
            made.append("Q-SCOUT-" + fid)
    for sid, rec in st["sources"].items():
        if rec.get("fail_count", 0) >= 3 and _item(root, f"Q-SCOUT-FETCH-{sid}", f"source {sid} failed {rec['fail_count']} reads ({rec.get('last_error')}); repair or replace it",
                                                    f"cmd:python3 -m foundation scout --fetch-ok {sid}",
                                                    f"Last error: {rec.get('last_error')}. Fix the URL in doctrine/scout.json or replace the source.", ["role:product-manager", "research"]):
            made.append(f"Q-SCOUT-FETCH-{sid}")
    return made


def disposition(root, fid, how, why, gap=None) -> str:
    st = load_state(root)
    if fid not in st["findings"]:
        return f"unknown finding {fid}"
    if how not in DISPOSITIONS or not why.strip():
        return "disposition must be adopt|have|reject with a reason"
    if how == "adopt":
        m = market.load(root)
        known = {g["id"] for g in m["gaps"]} | {f["id"] for f in m["features"]}
        if gap not in known:
            return f"adopt needs --gap naming an existing market.json gap or feature (adoption without code is not adoption); {gap!r} is not one"
    st["findings"][fid]["disposition"] = {"how": how, "why": why.strip(), "gap": gap, "on": dt.date.today().isoformat()}
    save_state(root, st)
    return ""


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    d, st = load(root), load_state(root)
    comps = {c["id"] for c in market.load(root)["components"]}
    ids = [s["id"] for s in d["sources"]]
    if d.get("visibility") != "internal":
        bad.append("scout.json must be internal")
    if len(ids) != len(set(ids)):
        bad.append("duplicate source id")
    for s in d["sources"]:
        if s["kind"] not in KINDS or not s["url"].startswith("https://") or not s["keywords"] or s["cadence_days"] < 1:
            bad.append(f"source {s['id']}: needs kind in {sorted(KINDS)}, https url, keywords and cadence_days >= 1")
        for c in s["components"]:
            if c not in comps:
                bad.append(f"source {s['id']}: unknown component {c}")
    if not KINDS <= {s["kind"] for s in d["sources"]}:
        bad.append("watchlist must cover competitors, platforms and best practice")
    have = {i["id"]: i for i in queue.items(root)}
    for fid, f in st["findings"].items():
        it = have.get("Q-SCOUT-" + fid)
        if not it:
            bad.append(f"finding {fid}: no queue item (run scout --run --apply)")
        elif it["status"] == "closed" and not f["disposition"]:
            bad.append(f"finding {fid}: queue item closed with no disposition")
    return bad


def report(root=REPO, now=None) -> str:
    now = now or dt.datetime.now(dt.timezone.utc)
    d, st = load(root), load_state(root)
    out, stale = ["source | kind | age_days | fails | cadence"], 0
    for s in d["sources"]:
        r = st["sources"].get(s["id"], {})
        age = (now - dt.datetime.fromisoformat(r["last_checked"])).days if r.get("last_checked") else None
        stale += age is None or age > d["max_age_days"]
        out.append(f"{s['id']} | {s['kind']} | {'never' if age is None else age} | {r.get('fail_count', 0)} | {s['cadence_days']}")
    open_f = [k for k, f in st["findings"].items() if not f["disposition"]]
    out.append(f"stale sources (older than {d['max_age_days']}d or never read): {stale}; findings {len(st['findings'])}, awaiting disposition {len(open_f)}: {', '.join(open_f) or 'none'}")
    return "\n".join(out)


def main(argv) -> int:
    a = argv[0] if argv else "--check"
    if a == "--run":
        r = run(apply="--apply" in argv)
        print(f"read {len(r['read'])}, baseline {len(r['baseline'])}, findings {len(r['findings'])}: {', '.join(r['findings']) or 'none'}")
        for f in r["failed"]:
            print("scout: fetch failed " + f)
        return 0
    if a == "--report":
        print(report())
        return 0
    if a == "--disposition":
        k = argv[argv.index("--why") + 1] if "--why" in argv else ""
        g = argv[argv.index("--gap") + 1] if "--gap" in argv else None
        e = disposition(REPO, argv[1], argv[2], k, g)
        print(e or "recorded")
        return 1 if e else 0
    if a == "--dispositioned":
        f = load_state().get("findings", {}).get(argv[1])
        return 0 if f and f["disposition"] else 1
    if a == "--fetch-ok":
        return 0 if load_state()["sources"].get(argv[1], {}).get("fail_count", 0) == 0 else 1
    bad = check()
    print("\n".join("scout: " + b for b in bad) or "scout ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

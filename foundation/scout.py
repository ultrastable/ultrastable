"""SCOUT-1: the growth product manager scouts the state of the art and files what it finds. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation scout --check            declaration valid, every source named, state files parse
  python3 -m foundation scout --run [--apply]    fetch every source, score new entries against doctrine/market.json gaps, components and the declared needs,
                                                 file Q-SCOUT-<id> growth items over the threshold, log the pass, re-weight the sources; --apply writes
  python3 -m foundation scout --adopt ID --outcome adopted|declined --reason TEXT   record what the executor did with a finding (the item's closing probe)
  python3 -m foundation scout --report           sources with weight, findings filed and adoption rate

State: ops/scout/seen.json (entry ids already scored), ops/scout/weights.json (per-source weight and quiet passes), ops/scout/log.jsonl (one row per pass),
ops/scout/adopted.jsonl (outcomes). The feedback: an adopted finding raises its source's weight, a source with no filing in `quiet_passes` passes decays,
so each pass reads better sources than the last. Fetching is injected so tests use recorded feeds; the weekly workflow fetches the live feeds.
"""
from __future__ import annotations
import datetime as dt, hashlib, json, re, sys, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH, STATE = "doctrine/scout.json", "ops/scout"
NS = {"a": "http://www.w3.org/2005/Atom"}
STOP = {"the", "and", "for", "with", "from", "that", "this", "into", "build", "make", "your", "are", "not", "can", "use", "its", "any", "per"}


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _j(root, name, default):
    p = Path(root) / STATE / name
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() and p.read_text(encoding="utf-8").strip() else default


def _rows(root, name) -> list[dict]:
    p = Path(root) / STATE / name
    out = []
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


def http(url: str, timeout=30) -> str:
    req = urllib.request.Request(url, headers={"user-agent": "ultrastable-scout/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def parse(kind: str, text: str) -> list[dict]:
    """Entries as {id, title, link, updated, summary} from an Atom or RSS document."""
    root, out = ET.fromstring(text), []
    if kind == "atom":
        for e in root.findall("a:entry", NS):
            g = lambda t: (e.findtext(f"a:{t}", default="", namespaces=NS) or "").strip()
            link = e.find("a:link", NS)
            out.append({"id": g("id"), "title": g("title"), "link": link.get("href", "") if link is not None else "", "updated": g("updated"), "summary": re.sub(r"<[^>]+>", " ", g("content") or g("summary"))[:600]})
    else:
        for e in root.iter("item"):
            g = lambda t: (e.findtext(t) or "").strip()
            out.append({"id": g("guid") or g("link"), "title": g("title"), "link": g("link"), "updated": g("pubDate"), "summary": re.sub(r"<[^>]+>", " ", g("description"))[:600]})
    return out


def tokens(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9+-]{2,}", s.lower()) if w not in STOP}


def targets(market: dict) -> list[dict]:
    """What the product is missing or builds on: each open gap and each component, as a token set."""
    out = []
    for g in market.get("gaps", []):
        out.append({"kind": "gap", "id": g["id"], "tokens": tokens(g["title"] + " " + g.get("why", "")), "text": g["title"]})
    for c in market.get("components", []):
        out.append({"kind": "component", "id": c["id"], "tokens": tokens(c["name"] + " " + c.get("what", "")), "text": c["name"]})
    return out


def score(entry: dict, tg: list[dict], needs: list[str], weight: float) -> tuple[float, list[str]]:
    text = (entry["title"] + " " + entry["summary"]).lower(); toks = tokens(text); s, why = 0.0, []
    for t in tg:
        hit = t["tokens"] & toks
        if len(hit) >= 2:
            s += (2.0 if t["kind"] == "gap" else 1.0) * min(len(hit), 4) / 2; why.append(f"{t['kind']}:{t['id']}")
    for n in needs:
        if n in text:
            s += 0.5; why.append("need:" + n)
    return round(s * weight, 2), why


def item_id(src: str, e: dict) -> str:
    return "Q-SCOUT-" + src + "-" + hashlib.sha1(e["id"].encode()).hexdigest()[:8]


def item(src: dict, e: dict, sc: float, why: list[str]) -> dict:
    iid = item_id(src["id"], e)
    return {"id": iid, "title": f"{iid}: {e['title'][:80]} ({src['id']})",
            "body": f"**Owner:** product-manager\n**Trigger:** every scout pass\n**Done check:** grep:ops/scout/adopted.jsonl::\"id\": \"{iid}\"\n**Prediction:** adoption_outcomes_recorded >= 1 within 336 h\n**Status:** open\n\n"
                    f"Scout finding from {src['id']} ({src['topic']}), score {sc}, matched {', '.join(why[:6])}.\n{e['title']}\n{e['link']}\n\n{e['summary'][:300]}\n\n"
                    + (f"This is a new version of a standard the system has adopted (`{src['standard']}` in seed/standards/standards.json). Read what changed, make the code that implements the standard conform, update the row's `tracked` version and `audited` date, and keep its probes passing (`python3 -m foundation standards --check`).\n\n" if src.get("standard") else "")
                    + f"Decide: adopt (ship the change that closes a gap or adds the capability) or decline with a reason, then record `python3 -m foundation scout --adopt {iid} --outcome adopted|declined --reason ...`. The outcome re-weights this source.",
            "labels": ["role:product-manager", "growth", "scout"], "milestone": "Next", "workstream": "Growth"}


def src_of(iid: str, cfg: dict) -> str:
    """The source an item id belongs to (source ids contain hyphens, so match the longest prefix)."""
    hit = [x["id"] for x in cfg["sources"] if iid.startswith("Q-SCOUT-" + x["id"] + "-")]
    return max(hit, key=len) if hit else ""


def reweight(root, cfg, weights: dict, filed_by_src: dict) -> dict:
    w, adopted = cfg["weight"], {}
    for r in _rows(root, "adopted.jsonl"):
        adopted.setdefault(src_of(r["id"], cfg), []).append(r.get("outcome"))
    for s in cfg["sources"]:
        st = weights.setdefault(s["id"], {"weight": w["initial"], "quiet": 0, "counted": 0})
        st["quiet"] = 0 if filed_by_src.get(s["id"]) else st["quiet"] + 1
        outs = adopted.get(s["id"], [])
        new = [o for o in outs[st["counted"]:]]
        for o in new:
            st["weight"] = min(w["ceiling"], st["weight"] * w["boost"]) if o == "adopted" else max(w["floor"], st["weight"] * w["decay"])
        st["counted"] = len(outs)
        if st["quiet"] >= w["quiet_passes"]:
            st["weight"] = max(w["floor"], st["weight"] * w["decay"]); st["quiet"] = 0
        st["weight"] = round(st["weight"], 3)
    return weights


def run(root=REPO, fetch=http, now=None, apply=False) -> dict:
    cfg, market = load(root), json.loads((Path(root) / "doctrine/market.json").read_text(encoding="utf-8"))
    now = now or dt.datetime.now(dt.timezone.utc)
    seen, weights, tg = set(_j(root, "seen.json", [])), _j(root, "weights.json", {}), targets(market)
    cands, errors, scanned = [], {}, 0
    for s in cfg["sources"]:
        try:
            entries = parse(s["kind"], fetch(s["url"]))
        except Exception as e:  # a dead source is recorded, never swallowed, and decays by the quiet-pass rule
            errors[s["id"]] = f"{type(e).__name__}: {e}"[:160]; continue
        wt = weights.get(s["id"], {}).get("weight", cfg["weight"]["initial"])
        # STANDARDS-FIRST-1: a source that carries `standard` is the release feed of a standard this system has adopted (seed/standards/standards.json).
        # Every new entry there is a new version to conform to, so it is filed whatever it scores; the first reading of such a source only records
        # what already exists, so history is never filed as news.
        std = s.get("standard")
        first = bool(std) and not any(k.startswith(s["id"] + ":") for k in seen)
        for e in entries:
            key = s["id"] + ":" + e["id"]
            if key in seen:
                continue
            seen.add(key); scanned += 1
            if first:
                continue
            sc, why = score(e, tg, cfg["needs"], wt)
            if std:
                sc, why = max(sc, float(cfg["threshold"]) + 1000), ["standard:" + std] + why  # ahead of scored findings inside max_per_run
            if sc >= cfg["threshold"]:
                cands.append((sc, s, e, why))
    cands.sort(key=lambda c: -c[0])
    filed = [item(s, e, sc, why) for sc, s, e, why in cands[:cfg["max_per_run"]]]
    by_src = {}
    for it in filed:
        k = src_of(it["id"], cfg)
        by_src[k] = by_src.get(k, 0) + 1
    weights = reweight(root, cfg, weights, by_src)
    row = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "scanned": scanned, "candidates": len(cands), "filed": [i["id"] for i in filed], "errors": errors,
           "weights": {k: v["weight"] for k, v in weights.items()}}
    if apply:
        base = Path(root) / STATE; base.mkdir(parents=True, exist_ok=True)
        for it in filed:
            (Path(root) / "docs/issues" / (it["id"] + ".json")).write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
        (base / "seen.json").write_text(json.dumps(sorted(seen)[-5000:]) + "\n", encoding="utf-8")
        (base / "weights.json").write_text(json.dumps(weights, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        with open(base / "log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
    return row


def adopt(root, iid: str, outcome: str, reason: str, now=None) -> dict:
    if outcome not in ("adopted", "declined") or not reason.strip():
        raise ValueError("outcome is adopted or declined and a reason is required")
    now = now or dt.datetime.now(dt.timezone.utc)
    row = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "id": iid, "outcome": outcome, "reason": reason.strip()}
    base = Path(root) / STATE; base.mkdir(parents=True, exist_ok=True)
    with open(base / "adopted.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")
    return row


def report(root=REPO) -> dict:
    cfg, w, adopted = load(root), _j(root, "weights.json", {}), _rows(root, "adopted.jsonl")
    out = {}
    for s in cfg["sources"]:
        mine = [r for r in adopted if r["id"].startswith("Q-SCOUT-" + s["id"] + "-")]
        out[s["id"]] = {"weight": w.get(s["id"], {}).get("weight", cfg["weight"]["initial"]), "adopted": sum(r["outcome"] == "adopted" for r in mine), "declined": sum(r["outcome"] == "declined" for r in mine)}
    return out


def check(root=REPO) -> list[str]:
    cfg, bad, ids = load(root), [], set()
    for s in cfg["sources"]:
        if s["id"] in ids: bad.append("duplicate source " + s["id"])
        ids.add(s["id"])
        if s["kind"] not in ("atom", "rss"): bad.append(f"{s['id']}: kind must be atom or rss")
        if not s["url"].startswith("https://"): bad.append(f"{s['id']}: url must be https")
        reg = Path(root) / "seed/standards/standards.json"
        if "standard" in s and not any(e["id"] == s["standard"] for e in (json.loads(reg.read_text(encoding="utf-8"))["entries"] if reg.is_file() else [])):
            bad.append(f"{s['id']}: watches standard {s['standard']!r}, which is not in seed/standards/standards.json")
    for f in ("seen.json", "weights.json"):
        try:
            _j(root, f, {})
        except ValueError:
            bad.append(f"ops/scout/{f} does not parse")
    if not (Path(root) / "doctrine/market.json").is_file(): bad.append("doctrine/market.json (the gap register the scout scores against) is missing")
    return bad


def main(argv: list[str]) -> int:
    a = list(argv)
    if "--adopt" in a:
        i = a.index("--adopt")
        print(json.dumps(adopt(REPO, a[i + 1], a[a.index("--outcome") + 1], a[a.index("--reason") + 1]))); return 0
    if "--run" in a:
        print(json.dumps(run(apply="--apply" in a), indent=1)); return 0
    if "--report" in a:
        print(json.dumps(report(), indent=1)); return 0
    bad = check(); print("\n".join(bad) or "scout ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

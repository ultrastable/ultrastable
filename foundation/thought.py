# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""THOUGHT-1 (Rowan, 2026-11-21): thought leadership as code. Ultrastable is the foundation for any autonomous system.

"I want white papers that promote this ... our own R&D that contradicts common misperceptions and narratives about the limitations of AI ...
promote it on social media, especially my LinkedIn ... share the spotlight with Practical Solutions as an example of a system that runs on
Ultrastable ... that hook is important ... This is just an example of what you can do with such a system."

The research loop (foundation/research.py) writes the papers from measurements. This module turns each paper into posts:

  the common belief (the study's `misperception`), what this system's own records show (numbers read from the paper, never typed),
  and the hook: Ultrastable runs on Ultrastable, and Practical Solutions is one system it runs.

  python3 -m foundation thought --check           doctrine valid, every study names a misperception, every piece and calendar paper post passes the guard
  python3 -m foundation thought --preview         print the pieces for every paper (all channels)
  python3 -m foundation thought --run [--apply]   schedule at most one paper piece per cadence into social/calendar.json and log it

The guard is the honesty rule in code: the hook and the paper link are present, every number in a post appears in the paper's own data, no
ridicule, no @-mentions, and each channel's length limit holds. A paper is posted again when its measured result changes or after repost_days.
"""
from __future__ import annotations
import datetime as dt, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/thought.json"
CAL = "social/calendar.json"
NUM = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w])")
URL = re.compile(r"https?://\S+")
VERDICT = {"met": "met", "not-met": "not met yet", "unmeasured": "not measured yet"}


def load(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def research_data(root=REPO) -> dict:
    t = (Path(root) / "site/research-data.js").read_text(encoding="utf-8")
    return json.loads(t[t.index("export default ") + len("export default "):].rstrip().rstrip(";"))


def studies(root=REPO) -> dict:
    return {json.loads(p.read_text(encoding="utf-8"))["id"]: json.loads(p.read_text(encoding="utf-8")) for p in sorted((Path(root) / "research/studies").glob("*.json"))}


def _val(f) -> str:
    return "not measured" if f["measured"] is None else f"{f['measured']} (n = {f['n']})"


def _label(f) -> str:
    return re.sub(r"\s*\([^)]*\)", "", f["metric_label"]).strip()


def _lead(paper) -> dict:
    """The finding a short post leads with: the first one met (the strongest evidence against the belief), else the first one."""
    return next((f for f in paper["findings"] if f["status"] == "met"), paper["findings"][0])


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[: max(0, n - 1)].rsplit(" ", 1)[0].rstrip(",;:.") + "…"


def pieces(paper: dict, study: dict, cfg: dict) -> dict:
    """{channel: text} for one paper. Every number comes from the paper's own data."""
    mp, hk, ps = study["misperception"], cfg["hook"], cfg["ps"]
    url = f"{cfg['site']}/research/{paper['slug']}"
    lead = _lead(paper)
    score = f"{paper['met']} of {paper['total']} tests met; every miss is an open work item."
    fact = f"Measured: {_label(lead)} = {_val(lead)}."
    out = {}
    lim = cfg["channels"]["bluesky"]["limit"]
    head = f"Common belief: {mp['short']}\nOur records: {paper['met']} of {paper['total']} tests met."
    tail = f"{hk['short']} {url}"
    room = lim - len(head) - len(tail) - 2
    out["bluesky"] = f"{head}\n{fact}\n{tail}" if len(fact) <= room else f"{head}\n{tail}"
    out["mastodon"] = _clip(f"Common belief: {mp['belief']}\n\nWhat this system's own records show: {score} {fact}\n\n{hk['medium']} {ps['url']}", cfg["channels"]["mastodon"]["limit"] - len(url) - 2) + f"\n\n{url}"
    rows = []
    fs = paper["findings"]
    pick = [f for f in fs if f["status"] == "met"][: cfg["max_findings_long"] - 1] + [f for f in fs if f["status"] != "met"][:1]
    for f in sorted(pick, key=fs.index):
        rows.append(f"• {_label(f)[:1].upper() + _label(f)[1:]}: {_val(f)} against a target of {f['target']['op']} {f['target']['value']} ({VERDICT[f['status']]}).")
    w = paper["window"]
    long = "\n\n".join([
        paper["title"],
        f"A common belief: {mp['belief']}",
        mp["counter"],
        f"What the system's own records show (window of {w['days']} days, {w['merged']} merged changes):\n" + "\n".join(rows),
        f"{score} The paper regenerates itself from the records after every change, limits included.",
        hk["long"].format(ps_what=ps["what"]) + f" {ps['url']}",
        f"Full paper, method and limits: {url}",
    ])
    out["linkedin"] = long
    return out


def guard(text: str, channel: str, paper: dict, cfg: dict, study: dict | None = None) -> list[str]:
    """Violations; empty means the piece may publish."""
    bad = []
    if cfg["hook"]["required"].lower() not in text.lower() and not (channel == "bluesky" and "runs on ultrastable" in text.lower()):
        bad.append("hook missing: " + cfg["hook"]["required"])
    if not any(u in text for u in cfg["guard"]["required_any_link"]):
        bad.append("paper link missing")
    low = text.lower()
    for p in cfg["guard"]["blocked_patterns"]:
        if re.search(p, low):
            bad.append("blocked pattern: " + p)
    allowed = set(NUM.findall(json.dumps(paper) + json.dumps(cfg) + json.dumps(study or {})))
    for n in NUM.findall(URL.sub(" ", text)):
        if n not in allowed:
            bad.append(f"number {n} is not in the paper's data")
    lim = cfg["channels"][channel]["limit"]
    if len(text) > lim:
        bad.append(f"too long for {channel}: {len(text)} > {lim}")
    return bad


def validate(root=REPO) -> list[str]:
    root = Path(root)
    bad, cfg = [], load(root)
    for k in ("hook", "channels", "ps", "cadence_days", "repost_days", "guard", "arm", "site"):
        if k not in cfg:
            bad.append(f"{POLICY}: missing {k}")
    if bad:
        return bad
    if cfg["hook"]["required"] not in cfg["hook"]["long"] or cfg["hook"]["required"] not in cfg["hook"]["medium"]:
        bad.append(f"{POLICY}: the long and medium hooks must carry '{cfg['hook']['required']}'")
    if cfg["ps"]["name"] not in cfg["hook"]["long"] or cfg["ps"]["name"] not in cfg["hook"]["medium"]:
        bad.append(f"{POLICY}: the long and medium hooks must name {cfg['ps']['name']} (shared spotlight)")
    sts, data = studies(root), research_data(root)
    for s in sts.values():
        mp = s.get("misperception") or {}
        if not all(mp.get(k) for k in ("belief", "short", "counter")):
            bad.append(f"study {s['id']}: misperception needs belief, short and counter")
    if bad:
        return bad
    for p in data["papers"]:
        for ch, t in pieces(p, sts[p["study_id"]], cfg).items():
            bad += [f"{p['slug']} {ch}: {v}" for v in guard(t, ch, p, cfg, sts[p["study_id"]])]
    if (root / CAL).is_file():
        by = {p["slug"]: p for p in data["papers"]}
        for post in json.loads((root / CAL).read_text(encoding="utf-8"))["posts"]:
            if post.get("kind") != "paper":
                continue
            if post.get("paper") not in by:
                continue  # a paper that was retired; its post is history
            for ch, t in (post.get("texts") or {}).items():
                errs = [e for e in guard(t, ch, by[post["paper"]], cfg, sts.get(post["paper"])) if not e.startswith("number ")]
                bad += [f"calendar {post['id']} {ch}: {e}" for e in errs]
    return bad


def _state(paper) -> str:
    return f"{paper['met']}of{paper['total']}"


def choose(root=REPO, now=None, cfg=None):
    """The paper due a piece now, or None. A changed result goes first; otherwise the paper posted longest ago, once repost_days have passed."""
    cfg = cfg or load(root)
    now = now or dt.datetime.now(dt.timezone.utc)
    today = now.date()
    cal = json.loads((Path(root) / CAL).read_text(encoding="utf-8")) if (Path(root) / CAL).is_file() else {"posts": []}
    mine = [p for p in cal["posts"] if p.get("kind") == "paper"]
    if mine and max(dt.date.fromisoformat(p["date"]) for p in mine) > today - dt.timedelta(days=cfg["cadence_days"]):
        return None, cal
    papers = sorted(research_data(root)["papers"], key=lambda p: p.get("order", 9))
    last = {}
    for p in mine:
        last.setdefault(p["paper"], []).append(p)
    fresh = [p for p in papers if not any(x.get("state") == _state(p) for x in last.get(p["slug"], []))]
    fresh.sort(key=lambda p: p["slug"] in last)  # REACH-PAPERS-1: a paper never posted goes before a repost of a changed one
    if fresh:
        return fresh[0], cal
    stale = [(max(dt.date.fromisoformat(x["date"]) for x in last[p["slug"]]), p) for p in papers if p["slug"] in last]
    stale = [s for s in stale if s[0] <= today - dt.timedelta(days=cfg["repost_days"])]
    return (min(stale, key=lambda s: s[0])[1] if stale else None), cal


def run(root=REPO, apply=False, now=None) -> dict:
    root = Path(root)
    cfg = load(root)
    now = now or dt.datetime.now(dt.timezone.utc)
    paper, cal = choose(root, now, cfg)
    if not paper:
        return {"scheduled": None, "reason": "cadence or nothing due"}
    st = studies(root)[paper["study_id"]]
    texts = pieces(paper, st, cfg)
    errs = {ch: guard(t, ch, paper, cfg, st) for ch, t in texts.items()}
    if any(errs.values()):
        return {"scheduled": None, "blocked": errs}
    day = now.date().isoformat()
    post = {"id": f"paper:{paper['slug']}:{_state(paper)}:{day}", "date": day, "text": texts["bluesky"], "texts": texts,
            "channels": list(cfg["channels"]), "kind": "paper", "arm": cfg["arm"], "paper": paper["slug"], "state": _state(paper),
            "source": "site/research-data.js", "url": f"{cfg['site']}/research/{paper['slug']}"}
    if apply:
        cal["posts"].append(post)
        (root / CAL).write_text(json.dumps(cal, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        log = root / cfg["log"]
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "id": post["id"], "paper": paper["slug"], "state": post["state"], "channels": post["channels"],
                                 "prediction": "social_referrals_7d >= 1 within 168 h"}) + "\n")
    return {"scheduled": post["id"], "applied": apply}


def main(argv=None) -> int:
    av = list(sys.argv[1:] if argv is None else argv)
    if "--check" in av:
        bad = validate()
        for b in bad:
            print("thought:", b)
        print(f"thought: {'FAIL' if bad else 'ok'} ({len(bad)} problem(s))")
        return 1 if bad else 0
    if "--preview" in av:
        cfg, sts = load(), studies()
        for p in research_data()["papers"]:
            for ch, t in pieces(p, sts[p["study_id"]], cfg).items():
                print(f"===== {p['slug']} / {ch} ({len(t)} chars)\n{t}\n")
        return 0
    if "--run" in av:
        print(json.dumps(run(apply="--apply" in av)))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())

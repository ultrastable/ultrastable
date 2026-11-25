# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CONTENT-DRIFT-1 (2026-11-25): self-written content is checked as it is read. Ultrastable is the foundation for any autonomous system.

Blind spot it closes: STATIC-CONTENT-1 made every system write its own entries, and POST-QUALITY-1 gates social posts before they are sent, but
nothing read the entries a system publishes on its own pages. A model that starts returning empty, cut-off, templated or repeated text would
publish it every day and no check would notice.

  python3 -m foundation contentdrift --live     read the newest entries of every content_feed in instances/ultrastable/progress.json; fail when
                                                a feed cannot be read or more than max_bad_share of its entries are bad (detector content-drift)
  python3 -m foundation contentdrift --check    doctrine/content-drift.json is well formed and every system with a stickiness block names a feed

An entry is bad when its title or text is missing, its text is shorter than min_chars, it ends mid-sentence, it carries a placeholder
(undefined, [object Object], a refusal) or stock model phrasing, or it repeats another entry's title or text. Thresholds: doctrine/content-drift.json.
Tests: tests/foundation/test_contentdrift.py.
"""
from __future__ import annotations
import html, json, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG = "doctrine/content-drift.json"
UA = "ultrastable-contentdrift/1"


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def feeds(root=REPO) -> list[tuple[str, str]]:
    p = json.loads((Path(root) / "instances/ultrastable/progress.json").read_text(encoding="utf-8"))
    rows = p.get("systems", p) if isinstance(p, dict) else p
    return [(s["id"], s["stickiness"]["content_feed"]) for s in rows if isinstance(s, dict) and (s.get("stickiness") or {}).get("content_feed")]


def _text(item: dict) -> str:
    t = item.get("content_text") or item.get("summary") or item.get("description") or item.get("text") or ""
    if not t and item.get("content_html"):
        t = html.unescape(re.sub(r"<[^>]+>", " ", item["content_html"]))
    return re.sub(r"\s+", " ", str(t)).strip()


def problems(item: dict, c: dict) -> list[str]:
    title, text, out = str(item.get("title") or "").strip(), _text(item), []
    if not title:
        out.append("no title")
    if not text:
        return out + ["no text"]
    if len(text) < c["min_chars"]:
        out.append(f"text is {len(text)} characters")
    if not re.search(r"""[.!?:"”')\]]$""", text):
        out.append("ends mid-sentence")
    raw, low = title + " " + text, (title + " " + text).lower()
    edge = lambda p: (r"\b" if p[:1].isalnum() else "") + re.escape(p) + (r"\b" if p[-1:].isalnum() else "")
    out += [f"placeholder {p!r}" for p in c["placeholders"] if re.search(edge(p), raw)]
    out += [f"stock phrasing {p!r}" for p in c["slop"] if re.search(r"\b" + re.escape(p.lower()) + r"\b", low)]
    return out


def judge(feed: dict, c: dict) -> dict:
    items = (feed.get("items") if isinstance(feed, dict) else feed) or []
    items = items[: c["newest"]]
    seen_t, seen_x, bad = set(), set(), []
    for it in items:
        if not isinstance(it, dict):
            bad.append(("?", ["not an object"])); continue
        p = problems(it, c)
        t, x = str(it.get("title") or "").strip().lower(), _text(it).lower()
        if t and t in seen_t:
            p.append("repeats a title")
        if x and x in seen_x:
            p.append("repeats a text")
        seen_t.add(t); seen_x.add(x)
        if p:
            bad.append((str(it.get("id") or it.get("url") or t)[:80], p))
    share = len(bad) / len(items) if items else 1.0
    return {"entries": len(items), "bad": bad, "share": round(share, 3), "ok": bool(items) and share <= c["max_bad_share"]}


def _get(url: str):
    req = urllib.request.Request(url, headers={"user-agent": UA, "accept": "application/feed+json, application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def live(root=REPO, get=_get) -> list[str]:
    c, out = cfg(root), []
    for sid, url in feeds(root):
        try:
            j = judge(get(url), c)
        except Exception as e:  # an unreadable feed is a failed reading, never a pass
            out.append(f"{sid}: feed {url} unreadable ({type(e).__name__}: {str(e)[:80]})"); continue
        if not j["ok"]:
            sample = "; ".join(f"{i}: {', '.join(p)}" for i, p in j["bad"][:3])
            out.append(f"{sid}: {len(j['bad'])} of {j['entries']} newest entries are bad (share {j['share']}, limit {c['max_bad_share']}): {sample}")
        else:
            print(f"contentdrift: {sid} ok ({j['entries']} entries, {len(j['bad'])} bad)")
    return out


def check(root=REPO) -> list[str]:
    c, bad = cfg(root), []
    for k in ("newest", "min_chars", "max_bad_share", "placeholders", "slop"):
        if k not in c:
            bad.append(f"{CFG}: missing {k}")
    if not feeds(root):
        bad.append("no system declares a content_feed")
    return bad


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    bad = live() if "--live" in a else check()
    print("\n".join("contentdrift: " + b for b in bad) or "contentdrift: ok")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

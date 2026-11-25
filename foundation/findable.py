# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""FINDABLE-1 (Rowan, 2026-11-25): every property in the fleet is findable by search engines and AI agents, by open standards, with no person.

"Get impact and reach maximized, and then apply it across the fleet to every property in the same way. Make sure it's fully compliant with open
standards and any AI discoverability, search engine optimization ... completely automated, completely user-free."

Each property in the directory (foundation/discover.py core()) is read daily: robots.txt (allows crawling, names a sitemap), sitemap.xml (urls),
llms.txt, and the home page (title, meta description, canonical, Open Graph, schema.org JSON-LD, a feed link). Each property that falls short gets
one queue item Q-FIND-<id> listing what is missing, owned by the executor, closed by this same reading (`findable --probe <id>`). Every feed found
is pinged to the open WebSub hub, so readers and aggregators that follow feeds see new posts within minutes; it needs no credential.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UA = "ultrastable-findable-probe/1 (+https://ultrastable.io/directory)"
HUB = "https://pubsubhubbub.appspot.com/"


def _get(url: str):
    req = urllib.request.Request(url, headers={"user-agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read(600_000).decode("utf-8", "replace")
    except Exception as e:  # recorded as a gap, never swallowed: the reading says the fetch failed
        return 0, f"fetch failed: {e}"


def home_gaps(html: str) -> list[str]:
    h = html.lower()
    need = {"title": r"<title>[^<]{3,}", "meta description": r'<meta[^>]+name=["\']description["\'][^>]+content=["\'][^"\']{20,}',
            "canonical link": r'<link[^>]+rel=["\']canonical', "Open Graph title": r'property=["\']og:title',
            "schema.org JSON-LD": r'application/ld\+json', "feed link": r'<link[^>]+type=["\']application/(atom|rss|feed)\+(xml|json)'}
    return [k for k, rx in need.items() if not re.search(rx, h)]


def robots_gaps(txt: str) -> list[str]:
    out = []
    if not re.search(r"(?im)^\s*sitemap:\s*https?://", txt):
        out.append("robots.txt names no sitemap")
    if re.search(r"(?ims)^user-agent:\s*\*\s*\n(?:[^\n]*\n)*?\s*disallow:\s*/\s*$", txt):
        out.append("robots.txt blocks every crawler")
    return out


def feeds(html: str, base: str) -> list[str]:
    return [urllib.parse.urljoin(base, m) for m in re.findall(r'<link[^>]+type=["\']application/(?:atom|rss|feed)\+(?:xml|json)["\'][^>]*href=["\']([^"\']+)', html, re.I)]


def read(url: str, get=_get) -> dict:
    base = url.rstrip("/")
    gaps = []
    s, home = get(base + "/")
    if s != 200:
        return {"url": url, "gaps": [f"home page answered {s}"], "feeds": []}
    gaps += home_gaps(home)
    s, rb = get(base + "/robots.txt")
    gaps += robots_gaps(rb) if s == 200 else ["no robots.txt"]
    s, sm = get(base + "/sitemap.xml")
    if s != 200 or "<loc>" not in sm:
        gaps.append("no sitemap.xml with urls")
    s, _ = get(base + "/llms.txt")
    if s != 200:
        gaps.append("no llms.txt")
    return {"url": url, "gaps": gaps, "feeds": feeds(home, base + "/")}


def properties(root=REPO) -> list[dict]:
    sys.path.insert(0, str(root))
    from foundation import discover
    return [{"id": c["id"], "url": c["url"]} for c in discover.core(root)]


def ping(feed: str) -> int:
    data = urllib.parse.urlencode({"hub.mode": "publish", "hub.url": feed}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(HUB, data=data, headers={"user-agent": UA}), timeout=20) as r:
            return r.status
    except Exception as e:
        print(f"websub ping {feed}: {e}", file=sys.stderr)
        return 0


def item(pid: str, r: dict) -> dict:
    body = (f"**Owner:** executor\n**Trigger:** findable workflow, daily\n**Done check:** python3 -m foundation findable --probe {pid}\n**Status:** open\n\n"
            f"{r['url']} is missing what search engines and AI agents read: " + "; ".join(r["gaps"]) +
            ". Fix the property's own pages (shared seed modules first, so every system gets it). Closed by the same daily reading.")
    return {"id": f"Q-FIND-{pid}", "title": f"Q-FIND-{pid}: make {r['url']} findable ({len(r['gaps'])} gaps)", "body": body,
            "status": "open", "labels": ["role:executor", "growth"], "milestone": "Now"}


def run(root=REPO, apply=False, get=_get, do_ping=False) -> dict:
    root = Path(root)
    out = {}
    for p in properties(root):
        r = read(p["url"], get)
        out[p["id"]] = r
        f = root / "docs" / "issues" / f"Q-FIND-{p['id']}.json"
        if apply:
            if r["gaps"]:
                f.write_text(json.dumps(item(p["id"], r), indent=2) + "\n", encoding="utf-8")
            elif f.is_file():
                d = json.loads(f.read_text(encoding="utf-8"))
                if d.get("status") != "done":
                    d["status"] = "done"
                    d["body"] = d["body"].replace("**Status:** open", "**Status:** done") + "\n**Evidence:** the daily reading found no gaps."
                    f.write_text(json.dumps(d, indent=2) + "\n", encoding="utf-8")
        if do_ping:
            r["pinged"] = {fd: ping(fd) for fd in r["feeds"]}
    if apply:
        led = root / "ops" / "findable.json"
        led.parent.mkdir(parents=True, exist_ok=True)
        led.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return out


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--probe" in a:
        pid = a[a.index("--probe") + 1]
        p = next((x for x in properties() if x["id"] == pid), None)
        if not p:
            print(f"no property {pid}"); return 1
        r = read(p["url"]); print(json.dumps(r)); return 1 if r["gaps"] else 0
    if "--check" in a:
        return 0 if properties() else 1
    res = run(apply="--apply" in a, do_ping="--ping" in a)
    for k, v in res.items():
        print(k, "ok" if not v["gaps"] else "; ".join(v["gaps"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())

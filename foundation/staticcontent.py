# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STATIC-CONTENT-1 (Rowan, 2026-11-25): "Static content is NOT autonomous and is contrary to the objective of an Ultrastable system."
Ultrastable is the foundation for any autonomous system.

A page that a live loop regenerates changes; a page nobody regenerates does not. Every system in instances/ultrastable/progress.json that lists a
sitemap is read each day: each page's visible text is hashed, the hash and the day it last changed are kept in ops/static-content.json (a row changes
only when the page does), and a page whose text has not changed inside `max_unchanged_days` is a finding. The detector `static-content` in
doctrine/detectors.json fails on a finding, so failure_audit files Q-AUDIT-static-content; the finding names the page and its system, and the fix is
to bind the page to a loop (a generated block, a feed, a live read), never to touch the text. A page that is meant to stay fixed is exempt in
doctrine/static-content.json with a reason. A ledger younger than `max_unchanged_days` reports `unmeasured`, never a pass.

  python3 -m foundation staticcontent --run [--apply]   fetch every listed page, update the ledger (--apply writes it)
  python3 -m foundation staticcontent --check           exit 1 when a page has not changed inside its window; unmeasured is exit 0 and says so
"""
from __future__ import annotations
import datetime as dt, hashlib, json, re, subprocess, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RULES, LEDGER, SYSTEMS = "doctrine/static-content.json", "ops/static-content.json", "instances/ultrastable/progress.json"
UA = "ultrastable-static-content/1 (+https://ultrastable.io)"


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / RULES).read_text(encoding="utf-8"))


def normalize(html: str) -> str:
    """Visible text only: scripts, styles and tags go, whitespace collapses, so a changed class name or nonce is not a changed page."""
    t = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", html)
    t = re.sub(r"(?s)<!--.*?-->", " ", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def digest(html: str) -> str:
    return hashlib.sha256(normalize(html).encode("utf-8")).hexdigest()[:16]


def observe(ledger: dict, readings: dict, today: str) -> dict:
    """readings: url -> html or None (unreadable). A row moves only when the hash does; an unreadable page keeps its row and is counted as a failed reading."""
    out = {u: dict(r) for u, r in ledger.items()}
    for url, html in readings.items():
        if html is None:
            continue
        h = digest(html)
        row = out.get(url)
        if row is None:
            out[url] = {"hash": h, "first_seen": today, "last_changed": today}
        elif row["hash"] != h:
            out[url] = {"hash": h, "first_seen": row["first_seen"], "last_changed": today}
    return out


def _days(a: str, b: str) -> int:
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def exempt(url: str, rules: dict) -> str | None:
    for x in rules.get("exempt", []):
        if re.search(x["pattern"], url):
            return x["reason"]
    return None


def judge(ledger: dict, today: str, rules: dict) -> dict:
    """static: pages unchanged for longer than the window and watched at least that long. watched: pages old enough to judge. A young ledger judges nothing."""
    win = int(rules["max_unchanged_days"])
    static, watched = [], 0
    for url, row in sorted(ledger.items()):
        if exempt(url, rules):
            continue
        if _days(row["first_seen"], today) < win:
            continue
        watched += 1
        idle = _days(row["last_changed"], today)
        if idle >= win:
            static.append({"url": url, "unchanged_days": idle, "last_changed": row["last_changed"]})
    return {"static": static, "watched": watched, "tracked": len(ledger), "measured": watched > 0}


def _get(url: str, timeout=20) -> str | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
            return r.read(2_000_000).decode("utf-8", "replace")
    except Exception as e:  # a failed reading is reported, never read as a pass or as a change
        print(f"static-content: unreadable {url}: {e}", file=sys.stderr)
        return None


def pages(root, rules: dict, get=_get) -> list[str]:
    urls = []
    for s in json.loads((Path(root) / SYSTEMS).read_text(encoding="utf-8")).get("systems", []):
        base = (s.get("url") or "").rstrip("/")
        xml = get(base + "/sitemap.xml") if base else None
        found = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml or "")
        urls += [base + "/"] if not found and base else found[: int(rules["max_pages"])]
    return sorted(set(urls))


def load(root) -> dict:
    p = Path(root) / LEDGER
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def run(root=REPO, today=None, get=_get, apply=False) -> dict:
    rules, today = cfg(root), today or dt.date.today().isoformat()
    urls = [u for u in pages(root, rules, get) if not exempt(u, rules)]
    ledger = observe(load(root), {u: get(u) for u in urls}, today)
    if apply:
        (Path(root) / LEDGER).write_text(json.dumps(ledger, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return judge(ledger, today, rules)


def main(argv: list[str]) -> int:
    root, apply = REPO, "--apply" in argv
    if "--run" in argv:
        res = run(root, apply=apply)
        if apply and subprocess.run(["git", "status", "--porcelain", LEDGER], cwd=root, capture_output=True, text=True).stdout.strip() and __import__("os").environ.get("GITHUB_ACTIONS"):
            subprocess.run([sys.executable, "scripts/land_data.py", "static-content: record page changes (STATIC-CONTENT-1)", LEDGER], cwd=root, check=True)
    elif "--check" in argv:
        res = judge(load(root), dt.date.today().isoformat(), cfg(root))
    else:
        print(__doc__); return 0
    print(json.dumps(res, indent=1))
    if not res["measured"]:
        print("static-content: unmeasured (the ledger holds no page old enough to judge yet); not a pass")
    return 1 if res["static"] else 0

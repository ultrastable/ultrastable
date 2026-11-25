# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STATIC-CONTENT-1 (portable): a page no loop regenerates is a finding. Ultrastable is the foundation for any autonomous system.

Rowan, 2026-11-25: "Static content is NOT autonomous and is contrary to the objective of an Ultrastable system." Each page in
autonomy/static-content.json `urls` is fetched, its visible text hashed, and the hash and the day it last changed kept in ops/static-content.json
(a row changes only when the page does). A page unchanged inside `max_unchanged_days` becomes docs/issues/Q-STATIC-<slug>.json with its own probe.
A ledger younger than the window reports `unmeasured`, never a pass, and an unreachable page is a failed reading, never fresh.

  python3 scripts/staticcontent.py --run [--apply]   fetch every page and update the ledger (--apply writes it and files items)
  python3 scripts/staticcontent.py --check           exit 1 on a finding; unmeasured exits 0 and says so
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES, LEDGER = "autonomy/static-content.json", "ops/static-content.json"


def _day(now=None) -> str:
    return (now or dt.datetime.now(dt.timezone.utc)).date().isoformat()


def normalize(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", html)
    return re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", html)).strip()


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-static-content/1"})
    with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 (https public pages only)
        return r.read().decode("utf-8", "replace")


def slug(url: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"^https?://", "", url.lower())).strip("-")[:60]


def load_rules(root: Path = ROOT) -> dict:
    return json.loads((Path(root) / RULES).read_text(encoding="utf-8"))


def run(root: Path = ROOT, apply: bool = False, fetch=_fetch, today: str | None = None) -> dict:
    root, today = Path(root), today or _day()
    rules = load_rules(root)
    exempt = {e["url"] for e in rules.get("exempt", []) if e.get("reason")}
    lp = root / LEDGER
    led = json.loads(lp.read_text(encoding="utf-8")) if lp.is_file() else {"started": today, "pages": {}}
    errors = []
    for url in rules["urls"]:
        if url in exempt:
            continue
        try:
            h = hashlib.sha256(normalize(fetch(url)).encode()).hexdigest()
        except Exception as e:  # a failed reading is recorded, never read as fresh
            errors.append(f"{url}: {type(e).__name__}: {e}")
            continue
        row = led["pages"].get(url)
        if not row or row["hash"] != h:
            led["pages"][url] = {"hash": h, "changed": today}
    led["errors"] = errors
    if apply:
        lp.parent.mkdir(parents=True, exist_ok=True)
        lp.write_text(json.dumps(led, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        for f in findings(root, led, today):
            _file_item(root, f)
    return led


def findings(root: Path, led: dict | None = None, today: str | None = None) -> list[dict]:
    root, today = Path(root), today or _day()
    rules = load_rules(root)
    if led is None:
        lp = root / LEDGER
        led = json.loads(lp.read_text(encoding="utf-8")) if lp.is_file() else {"pages": {}}
    limit = rules["max_unchanged_days"]
    exempt = {e["url"] for e in rules.get("exempt", []) if e.get("reason")}
    out = []
    t = dt.date.fromisoformat(today)
    for url in rules["urls"]:
        row = led.get("pages", {}).get(url)
        if url in exempt or not row:
            continue
        age = (t - dt.date.fromisoformat(row["changed"])).days
        if age > limit:
            out.append({"url": url, "unchanged_days": age, "limit": limit})
    return out


def measured(root: Path = ROOT, today: str | None = None) -> bool:
    lp = Path(root) / LEDGER
    if not lp.is_file():
        return False
    led = json.loads(lp.read_text(encoding="utf-8"))
    return (dt.date.fromisoformat(today or _day()) - dt.date.fromisoformat(led["started"])).days >= load_rules(root)["max_unchanged_days"]


def _file_item(root: Path, f: dict) -> None:
    i = f"Q-STATIC-{slug(f['url'])}"
    p = Path(root) / "docs" / "issues" / f"{i}.json"
    if p.exists():
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    body = (f"**Owner:** product-manager\n**Trigger:** daily static-content run\n**Status:** open\n**Done check:** python3 scripts/staticcontent.py --check exits 0\n\n"
            f"{f['url']} has not changed in {f['unchanged_days']} days (limit {f['limit']}). Bind it to a loop: a generated block, a feed or a live read. "
            "Do not edit the text to clear the finding. A page meant to stay fixed is exempt in autonomy/static-content.json with a reason.\n\n"
            "**Closing probe:** `python3 scripts/staticcontent.py --check` exits 0.\n")
    p.write_text(json.dumps({"id": i, "title": f"{f['url']} is static", "body": body, "labels": ["p1", "agent-ready"]}, indent=2) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--run" in a:
        led = run(ROOT, apply="--apply" in a)
        print(f"read {len(led['pages'])} page(s), {len(led['errors'])} unreachable")
        return 0
    f = findings(ROOT)
    for x in f:
        print(f"static: {x['url']} unchanged {x['unchanged_days']} days (limit {x['limit']})")
    if not f and not measured(ROOT):
        print("static content: unmeasured (ledger younger than the window or no pages listed)")
    elif not f:
        print("static content ok")
    return 1 if f else 0


if __name__ == "__main__":
    sys.exit(main())

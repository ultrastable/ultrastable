#!/usr/bin/env python3
"""Fill social/calendar.json with guard-clean excerpts from SAFE NOW sources, scheduled within the rate limits."""
import json, re, sys, datetime as dt
from social_lib import *

def candidates(source):
    txt = (ROOT / source).read_text()
    txt = re.sub(r"```.*?```", "", txt, flags=re.S)
    out = []
    for line in txt.splitlines():
        line = line.strip().lstrip("#>-* |").strip()
        line = line.strip('"')
        for s in re.split(r"(?<=[.!?])\s+", line):
            s = s.strip().strip('"').replace("**", "")
            if 40 <= len(s) <= 280 and s[-1] in ".!?":
                out.append(s)
    return out

def main():
    cal = json.loads((S / "calendar.json").read_text()) if (S / "calendar.json").exists() else {"posts": []}
    have = {p["id"] for p in cal["posts"]}
    gate = load("gate.json")
    g = load("guard.json")
    last = max([dt.date.fromisoformat(p["date"]) for p in cal["posts"]] or [dt.date.today()])
    day = max(last, dt.date.today())
    added = rejected = 0
    for src in g["sources"]:
        for s in candidates(src):
            pid = post_id(s)
            if pid in have:
                continue
            if guard(s, src):
                rejected += 1
                continue
            day += dt.timedelta(days=2)  # every other day, then weekly cap applies at post time
            cal["posts"].append({"id": pid, "date": day.isoformat(), "text": s, "source": src, "tag": "SAFE NOW"})
            have.add(pid); added += 1
    (S / "calendar.json").write_text(json.dumps(cal, indent=1, ensure_ascii=False) + "\n")
    print(f"generated {added}, guard-rejected {rejected}, calendar total {len(cal['posts'])}")

if __name__ == "__main__":
    main()

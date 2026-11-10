#!/usr/bin/env python3
"""Fail when docs/PROJECT-MEMORY.md is stale versus merged work.

Stale means: more than MAX_COMMITS commits, or any commit older than
MAX_HOURS, landed after the last commit that touched the memory file.
Also checks required sections and the 'Last updated' line.
"""
import re, subprocess, sys, time

MEM = "docs/PROJECT-MEMORY.md"
MAX_COMMITS = 15
MAX_HOURS = 72
REQUIRED = ["Standing rules", "Facts from Rowan", "Current status",
            "Owner-only items", "Workstream map", "Update protocol"]


def git(*a):
    r = subprocess.run(["git", *a], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"git {' '.join(a)} failed: {r.stderr}", file=sys.stderr)
        sys.exit(2)
    return r.stdout.strip()


def main():
    text = open(MEM, encoding="utf-8").read()
    missing = [s for s in REQUIRED if s.lower() not in text.lower()]
    if missing:
        print(f"FAIL: {MEM} lacks sections: {missing}")
        return 1
    if not re.search(r"^Last updated: \d{4}-\d{2}-\d{2}$", text, re.M):
        print("FAIL: missing 'Last updated: YYYY-MM-DD' line")
        return 1
    last = git("log", "-1", "--format=%H", "--", MEM)
    if not last:
        print("FAIL: memory file has no commit history")
        return 1
    newer = [l for l in git("log", f"{last}..HEAD", "--format=%ct").splitlines() if l]
    if not newer:
        print("OK: memory is current")
        return 0
    age_h = (time.time() - min(int(t) for t in newer)) / 3600
    print(f"{len(newer)} commits since last memory update; oldest {age_h:.0f}h ago")
    if len(newer) > MAX_COMMITS or age_h > MAX_HOURS:
        print(f"FAIL: {MEM} is stale (limit {MAX_COMMITS} commits / {MAX_HOURS}h). "
              "Review status, rules, owner items and workstreams, edit it, bump 'Last updated'.")
        return 1
    print("OK: within staleness limits")
    return 0


if __name__ == "__main__":
    sys.exit(main())

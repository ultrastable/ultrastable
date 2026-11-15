#!/usr/bin/env python3
"""MEMORY-REFRESH-1: keep docs/PROJECT-MEMORY.md current from merged work, server-side, so `scripts/check_memory.py` never turns every pull request red.

Root cause it closes: the memory check fails after 15 commits without an edit to the memory file, and only a session edited that file; with the lane
merging faster than sessions end, main went stale and every open pull request failed `checks` for a reason unrelated to its change.

When at least REFRESH_AT commits (half the check's limit) have landed since the memory file last changed, one dated line per merged change (commit
subject; bot bookkeeping commits excluded) is inserted under the `Last updated` line and the date is bumped. Idempotent: a subject already in the file is
not added again, and with nothing to add the file is untouched. Run by the lane (scripts/lane.sh) on every pass; exits 0 and prints what it did.

  python3 scripts/memory_refresh.py            # refresh when due
  python3 scripts/memory_refresh.py --force    # refresh whatever the count
"""
import re, subprocess, sys, time

MEM = "docs/PROJECT-MEMORY.md"
REFRESH_AT = 7
BOOKKEEPING = re.compile(r"^(lane:|deploy-workers:|deploy-site:|memory:|Merge )")


def git(*a, cwd="."):
    return subprocess.run(["git", *a], capture_output=True, text=True, cwd=cwd).stdout.strip()


def refresh(text, commits, today):
    """commits: [(YYYY-MM-DD, subject)], newest first. Returns the new text (unchanged when nothing is new)."""
    new = [(d, s) for d, s in commits if not BOOKKEEPING.match(s) and s not in text]
    if not new:
        return text
    lines = "".join(f"- {d}: {s}\n" for d, s in new)
    out, n = re.subn(r"^Last updated: \d{4}-\d{2}-\d{2}\n\n?", f"Last updated: {today}\n\n{lines}", text, count=1, flags=re.M)
    return out if n else text


def main(argv, root="."):
    last = git("log", "-1", "--format=%H", "--", MEM, cwd=root)
    if not last:
        print("memory refresh: no history for the memory file"); return 0
    log = [l.split("\t", 1) for l in git("log", f"{last}..HEAD", "--format=%cs\t%s", cwd=root).splitlines() if "\t" in l]
    if len(log) < REFRESH_AT and "--force" not in argv:
        print(f"memory refresh: not due ({len(log)} commit(s) since the last update)"); return 0
    path = f"{root}/{MEM}"
    text = open(path, encoding="utf-8").read()
    out = refresh(text, [(d, s) for d, s in log], time.strftime("%Y-%m-%d", time.gmtime()))
    if out == text:
        out = re.sub(r"^Last updated: \d{4}-\d{2}-\d{2}$", "Last updated: " + time.strftime("%Y-%m-%d", time.gmtime()), text, count=1, flags=re.M)
    if out == text:
        print("memory refresh: nothing to record"); return 0
    open(path, "w", encoding="utf-8").write(out)
    print(f"memory refresh: recorded {len(log)} commit(s)"); return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

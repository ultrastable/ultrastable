#!/usr/bin/env python3
"""LANE-WATCH-1: resolve the merge conflicts that every PR hits because they sit in generated or append-only files, after `git merge origin/main`.
Rules: doctrine/decision-ledger.json = union of rows by id (main first); ops/*.jsonl and docs/PROJECT-MEMORY.md = both sides, conflict markers dropped; ops/transparency.json and
site/dashboard-data.js = main's side, then `python3 scripts/build_dashboard.py` regenerates the dashboard; site/claims-data.js = main's side, then `claims --fix --apply` rewrites it from the merged registry. Prints what it did; exits 1 when other files still conflict."""
import json, re, subprocess, sys

def sh(*a): return subprocess.run(a, capture_output=True, text=True).stdout
conf = sh("git", "diff", "--name-only", "--diff-filter=U").split()
for f in list(conf):
    if f == "doctrine/decision-ledger.json":
        a = json.loads(sh("git", "show", "HEAD:" + f)); b = json.loads(sh("git", "show", "origin/main:" + f))
        ids = {r["id"] for r in b["rows"]}; b["rows"] += [r for r in a["rows"] if r["id"] not in ids]
        open(f, "w").write(json.dumps(b, indent=1, ensure_ascii=False) + "\n")
    elif f.endswith(".jsonl") or f == "docs/PROJECT-MEMORY.md":  # append-only: keep both sides
        t = open(f).read(); open(f, "w").write("\n".join(l for l in t.splitlines() if not re.match(r"^(<<<<<<<|=======|>>>>>>>)", l)) + "\n")
    elif f in ("ops/transparency.json", "site/dashboard-data.js", "site/claims-data.js"):   # claims-data.js is rewritten below from the merged doctrine/claims.json
        subprocess.run(["git", "checkout", "--theirs", f])
    else:
        continue
    subprocess.run(["git", "add", f]); conf.remove(f); print("resolved", f)
# MERGE-NOW-1: in any other file, a hunk whose two sides are equal, or differ only inside `<!-- claim:ID -->` values (computed by claims --fix, never
# typed), is resolved: identical -> one copy, claim-only -> main's side. A hunk that differs in written text stays a conflict.
CLAIM = re.compile(r"(<!-- claim:[\w.-]+ -->)(.*?)(<!-- /claim -->)", re.S)
HUNK = re.compile(r"^<<<<<<< [^\n]*\n(.*?)^(?:\|\|\|\|\|\|\| [^\n]*\n.*?)?^=======\n(.*?)^>>>>>>> [^\n]*\n", re.S | re.M)
def soft(path):
    try:
        t = open(path, encoding="utf-8").read()
    except (UnicodeDecodeError, FileNotFoundError):
        return False
    hard = []
    def pick(m):
        ours, theirs = m.group(1), m.group(2)
        if ours == theirs or CLAIM.sub(r"\1\3", ours) == CLAIM.sub(r"\1\3", theirs):
            return theirs
        hard.append(1); return m.group(0)
    new = HUNK.sub(pick, t)
    if hard:
        return False
    open(path, "w", encoding="utf-8").write(new); return True
for f in list(conf):
    if soft(f):
        subprocess.run(["git", "add", f]); conf.remove(f); print("resolved (identical or claim-only)", f)
if "doctrine/claims.json" not in conf:   # the registry merged cleanly: its served copy is regenerated, never merged by hand
    subprocess.run([sys.executable, "-m", "foundation", "claims", "--fix", "--apply"], capture_output=True)
    subprocess.run(["git", "add", "site/claims-data.js"])
subprocess.run([sys.executable, "scripts/build_dashboard.py"], capture_output=True)
subprocess.run(["git", "add", "site/dashboard-data.js"])
print("still conflicting:", conf)
sys.exit(1 if conf else 0)

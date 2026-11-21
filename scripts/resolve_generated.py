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
# MARKER-ROOT-1 (2026-11-21): main itself once carried committed conflict markers in README.md, so every later merge nested a new hunk around the old
# markers and soft() could not match it; every PR then sat in conflict until a session cleaned it by hand. flatten() handles that shape: drop every
# marker line, collapse consecutive lines that are equal once claim values are blanked (keeping the last, main's), and accept only if nothing else differed.
MARK = re.compile(r"^(<<<<<<< |=======$|>>>>>>> |\|\|\|\|\|\|\| )")
def flatten(path):
    try:
        lines = open(path, encoding="utf-8").read().split("\n")
    except (UnicodeDecodeError, FileNotFoundError):
        return False
    if not any(MARK.match(l) for l in lines):
        return False
    out, inside, block = [], 0, []
    for l in lines:
        if l.startswith("<<<<<<< "):
            inside += 1; continue
        if l.startswith(">>>>>>> "):
            inside -= 1
            if inside == 0:
                norm = {CLAIM.sub(r"\1\3", b) for b in block}
                if len(norm) != 1:
                    return False          # written text differs: a real conflict, left for the caller
                out.append(block[-1]); block = []
            continue
        if MARK.match(l):
            continue
        (block if inside else out).append(l)
    if inside or block:
        return False
    open(path, "w", encoding="utf-8").write("\n".join(out)); return True
for f in list(conf):
    if soft(f) or flatten(f):
        subprocess.run(["git", "add", f]); conf.remove(f); print("resolved (identical or claim-only)", f)
if "doctrine/claims.json" not in conf:   # the registry merged cleanly: its served copy is regenerated, never merged by hand
    subprocess.run([sys.executable, "-m", "foundation", "claims", "--fix", "--apply"], capture_output=True)
    subprocess.run(["git", "add", "site/claims-data.js"])
subprocess.run([sys.executable, "scripts/build_dashboard.py"], capture_output=True)
subprocess.run(["git", "add", "site/dashboard-data.js"])
print("still conflicting:", conf)
sys.exit(1 if conf else 0)

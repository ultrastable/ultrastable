#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
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
    elif f in ("ops/transparency.json", "site/dashboard-data.js", "site/claims-data.js", "site/research-data.js") or f.startswith("research/papers/"):  # papers are rebuilt by `research --page --apply` below   # claims-data.js is rewritten below from the merged doctrine/claims.json
        subprocess.run(["git", "checkout", "--theirs", f])
    else:
        continue
    subprocess.run(["git", "add", f]); conf.remove(f); print("resolved", f)
# MERGE-NOW-1: in any other file, a hunk whose two sides are equal, or differ only inside `<!-- claim:ID -->` values (computed by claims --fix, never
# typed), is resolved: identical -> one copy, claim-only -> main's side. A hunk that differs in written text stays a conflict.
CLAIM = re.compile(r"(<!-- claim:[\w.-]+ -->)(.*?)(<!-- /claim -->)", re.S)
# MARKERS-ON-MAIN-1 (2026-11-21): main itself carried committed conflict markers in README.md and platform/adapters/README.md, so a hunk's side held
# another hunk and no pattern matched: every PR conflicted there and none could be reconciled. Hunks are now resolved innermost first, to a fixed point.
_M = r"(?:(?!<<<<<<< |=======$|>>>>>>> |\|\|\|\|\|\|\| )[^\n]*\n)*?"
HUNK = re.compile(r"^<<<<<<< [^\n]*\n(" + _M + r")(?:^\|\|\|\|\|\|\| [^\n]*\n" + _M + r")?^=======\n(" + _M + r")^>>>>>>> [^\n]*\n", re.M)
def flatten_text(t):
    """(text, hard): every hunk whose sides are equal or differ only in claim values is resolved to main's side, innermost first."""
    hard = []
    def pick(m):
        ours, theirs = m.group(1), m.group(2)
        if ours == theirs or CLAIM.sub(r"\1\3", ours) == CLAIM.sub(r"\1\3", theirs):
            return theirs
        hard.append(1); return m.group(0)
    while True:
        hard.clear(); new = HUNK.sub(pick, t)
        if new == t:
            return t, len(hard)
        t = new
def soft(path):
    try:
        t = open(path, encoding="utf-8").read()
    except (UnicodeDecodeError, FileNotFoundError):
        return False
    new, hard = flatten_text(t)
    if hard or re.search(r"^(<<<<<<< |>>>>>>> )", new, re.M):
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
def claim_blind(path):
    """CLAIM-BLIND-MERGE-1: main rewrites claim values (deploy count, test counts) after every deploy. A PR that rewrites prose near such a value
    conflicted on every merge although nothing written collided. Re-merge the three stages with every claim value blanked; if that merge is clean,
    keep it: the values are recomputed by `claims --fix --apply` below, never chosen by hand. Anything else stays a conflict."""
    import os, tempfile
    stages, raw = [], {}
    for n in (2, 1, 3):  # ours, base, theirs, as git merge-file wants them
        r = subprocess.run(["git", "show", f":{n}:{path}"], capture_output=True, text=True)
        if r.returncode:
            return False  # added or deleted on one side: not this rule's case
        raw[n] = r.stdout
        stages.append(CLAIM.sub(r"\1\3", r.stdout))
    with tempfile.TemporaryDirectory() as d:
        names = []
        for i, s in enumerate(stages):
            p = os.path.join(d, str(i)); open(p, "w", encoding="utf-8").write(s); names.append(p)
        r = subprocess.run(["git", "merge-file", "-p", *names], capture_output=True, text=True)
    if r.returncode != 0:
        return False      # written text collides: a real conflict, left for the caller
    vals = {}
    for n in (2, 3):  # main's (stage 3) value wins; ours fills a claim only the PR has
        vals.update({m.group(1): m.group(2) for m in CLAIM.finditer(raw[n])})
    out = CLAIM.sub(lambda m: m.group(1) + vals.get(m.group(1), "") + m.group(3), r.stdout)
    open(path, "w", encoding="utf-8").write(out); CLAIM_BLINDED.append(path); return True
CLAIM_BLINDED = []
for f in list(conf):
    if soft(f) or flatten(f) or claim_blind(f):
        subprocess.run(["git", "add", f]); conf.remove(f); print("resolved (identical or claim-only)", f)
# A file that is not in conflict but carries committed markers (it reached main that way) is healed the same way, so the next PR does not inherit it.
for f in sh("git", "grep", "-l", "-E", "^(<<<<<<< |>>>>>>> )", "--", "*.md").split():
    if f not in conf and soft(f):
        subprocess.run(["git", "add", f]); print("healed committed markers", f)
if "doctrine/claims.json" not in conf:   # the registry merged cleanly: its served copy is regenerated, never merged by hand
    subprocess.run([sys.executable, "-m", "foundation", "claims", "--fix", "--apply"], capture_output=True)
    subprocess.run(["git", "add", "site/claims-data.js", *CLAIM_BLINDED])
subprocess.run([sys.executable, "-m", "foundation", "research", "--page", "--apply"], capture_output=True)  # REGEN-RESEARCH-1: papers follow the merged studies
subprocess.run(["git", "add", "research", "site/research-data.js"])
subprocess.run([sys.executable, "scripts/build_dashboard.py"], capture_output=True)
subprocess.run(["git", "add", "site/dashboard-data.js"])
print("still conflicting:", conf)
sys.exit(1 if conf else 0)

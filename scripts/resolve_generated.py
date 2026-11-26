#!/usr/bin/env python3
"""LANE-WATCH-1: resolve the merge conflicts that every PR hits because they sit in generated or append-only files, after `git merge origin/main`.
Rules: doctrine/decision-ledger.json = union of rows by id (main first); ops/*.jsonl and docs/PROJECT-MEMORY.md = both sides, conflict markers dropped; ops/transparency.json and
site/dashboard-data.js = main's side, then `python3 scripts/build_dashboard.py` regenerates the dashboard; site/claims-data.js = main's side, then `claims --fix --apply` rewrites it from the merged registry. Prints what it did; exits 1 when other files still conflict."""
import json, re, subprocess, sys

def sh(*a): return subprocess.run(a, capture_output=True, text=True).stdout
conf = sh("git", "diff", "--name-only", "--diff-filter=U").split()
for f in list(conf):
    if f == "doctrine/decision-ledger.json":
        lock_file = f + ".lock"
        with open(lock_file, 'w') as lock:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
            a = json.loads(sh("git", "show", "HEAD:" + f)); b = json.loads(sh("git", "show", "origin/main:" + f))
            ids = {r["id"] for r in b["rows"]}; b["rows"] += [r for r in a["rows"] if r["id"] not in ids]
            open(f, "w").write(json.dumps(b, indent=1, ensure_ascii=False) + "\n")
            fcntl.flock(lock, fcntl.LOCK_UN)
    elif f.endswith(".jsonl") or f == "docs/PROJECT-MEMORY.md":  # append-only: keep both sides
        t = open(f).read(); open(f, "w").write("\n".join(l for l in t.splitlines() if not re.match(r"^(<<<<<<<|=======|>>>>>>>)", l)) + "\n")
    elif f in ("ops/transparency.json", "site/dashboard-data.js", "site/claims-data.js", "site/research-data.js", "site/self-data.js", "seed/SYSTEM.md", "seed/docs/claims.json") or f.startswith("research/papers/"):  # papers are rebuilt by `research --page --apply` below   # claims-data.js is rewritten below from the merged doctrine/claims.json
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
# ADDITIVE-MERGE-1 (2026-11-26): PRs sat conflicted for hours because both sides appended rows to the same registry (detectors, registers,
# open-loops, decisions) or bullets to the same list (AGENTS.md). Nothing collided, yet git saw one hunk. Two model-free rules:
# json_union: a three-way merge of the parsed JSON; lists of {"id":...} rows are unioned by id and a row both sides kept is merged field by field;
#   the same field edited differently on both sides stays a conflict.
# additive: a diff3 hunk whose base part is empty (both sides only inserted lines) keeps main's lines, then the PR's. Syntax is checked for .py/.js.
_MISS = object()
class _Clash(Exception): pass
def _stage(path, n):
    r = subprocess.run(["git", "show", f":{n}:{path}"], capture_output=True, text=True)
    return None if r.returncode else r.stdout
def _jmerge(b, o, t):
    if o == t: return t
    if b is not _MISS and o == b: return t
    if b is not _MISS and t == b: return o
    if isinstance(o, dict) and isinstance(t, dict):
        bb = b if isinstance(b, dict) else {}
        out = {}
        for k in list(t) + [k for k in o if k not in t]:
            v = _jmerge(bb.get(k, _MISS), o.get(k, _MISS), t.get(k, _MISS))
            if v is not _MISS: out[k] = v
        return out
    if isinstance(o, list) and isinstance(t, list) and all(isinstance(x, dict) and "id" in x for x in o + t):
        bi = {x["id"]: x for x in b if isinstance(x, dict) and "id" in x} if isinstance(b, list) else {}
        oi, out = {x["id"]: x for x in o}, []
        for x in t:   # main's order; a row both sides kept is merged three ways
            out.append(_jmerge(bi.get(x["id"], _MISS), oi[x["id"]], x) if x["id"] in oi else x)
        tids = {x["id"] for x in t}
        out += [x for x in o if x["id"] not in tids and x["id"] not in bi]   # rows the PR added; a row main removed stays removed
        return out
    if isinstance(o, list) and isinstance(t, list) and isinstance(b, list) and o[:len(b)] == b and t[:len(b)] == b:
        return t + [x for x in o[len(b):] if x not in t]   # both appended
    if o is _MISS and b is not _MISS: return o if t == b else (_ for _ in ()).throw(_Clash())
    if t is _MISS and b is not _MISS: return t if o == b else (_ for _ in ()).throw(_Clash())
    raise _Clash()
def json_union(path):
    if not path.endswith(".json"): return False
    st = {n: _stage(path, n) for n in (1, 2, 3)}
    if st[2] is None or st[3] is None: return False
    try:
        b = json.loads(st[1]) if st[1] else _MISS
        merged = _jmerge(b, json.loads(st[2]), json.loads(st[3]))
    except (ValueError, _Clash):
        return False
    indent = 1 if st[3].startswith("{\n ") and not st[3].startswith("{\n  ") else 2
    open(path, "w", encoding="utf-8").write(json.dumps(merged, indent=indent, ensure_ascii=False) + "\n"); return True
D3 = re.compile(r"^<<<<<<< [^\n]*\n(" + _M + r")^\|\|\|\|\|\|\| [^\n]*\n(" + _M + r")^=======\n(" + _M + r")^>>>>>>> [^\n]*\n", re.M)
def additive(path):
    import os, tempfile
    st = {n: _stage(path, n) for n in (1, 2, 3)}
    if None in st.values(): return False
    with tempfile.TemporaryDirectory() as d:
        names = []
        for n in (2, 1, 3):
            p = os.path.join(d, str(n)); open(p, "w", encoding="utf-8").write(st[n]); names.append(p)
        r = subprocess.run(["git", "merge-file", "-p", "--diff3", *names], capture_output=True, text=True)
    out, bad = r.stdout, []
    def pick(m):
        if m.group(2): bad.append(1); return m.group(0)
        return m.group(3) + m.group(1)        # main's insertion, then the PR's
    out = D3.sub(pick, out)
    if bad or re.search(r"^(<<<<<<< |>>>>>>> )", out, re.M): return False
    if path.endswith(".py"):
        try: compile(out, path, "exec")
        except SyntaxError: return False
    if path.endswith((".js", ".mjs")):
        with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as fh: fh.write(out)
        ok = subprocess.run(["node", "--check", fh.name], capture_output=True).returncode == 0
        os.unlink(fh.name)
        if not ok: return False
    open(path, "w", encoding="utf-8").write(out); return True
for f in list(conf):
    if soft(f) or flatten(f) or claim_blind(f) or json_union(f) or additive(f):
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
subprocess.run([sys.executable, "-m", "foundation", "selfmodel", "--apply"], capture_output=True)  # SELF-MODEL-1: regenerated, never merged by hand
subprocess.run(["git", "add", "site/self-data.js"])
import os
if os.path.isfile("seed/scripts/system.py"):  # SYSTEM-SPEC-1: the definition follows the merged code (absent in a repository without the kit)
    subprocess.run([sys.executable, "seed/scripts/system.py", "--write"], capture_output=True)
    subprocess.run(["git", "add", "seed/SYSTEM.md"])
if os.path.isfile("seed/scripts/claims.py"):  # the seed's own generated counts (README, docs/claims.json)
    subprocess.run([sys.executable, "scripts/claims.py", "--fix", "--apply"], cwd="seed", capture_output=True)
    subprocess.run(["git", "add", "seed/README.md", "seed/docs/claims.json"])
print("still conflicting:", conf)
sys.exit(1 if conf else 0)

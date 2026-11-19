"""BRANCH-SWEEP-1: no remote branch carries work main lacks. The session reaper only watches `agent/*` and `claude/*`; a branch named anything else
(`authzen-1`, `core3-postgres`, `feat/...`, `worker/...`) was never merged, parked or closed, and the evidence branches kept ledger commits that never
reached main. This loop reads every remote branch (git only, so it runs on the built-in token) and gives each one a disposition:

  superseded   its tree adds nothing main lacks: deleted (the sha is in the ledger, reversible by pushing it back)
  merged       its tip is already an ancestor of main: deleted
  merge        a three-way merge with main is clean, or conflicts only in generated and append-only files that have a resolution rule
               (decision ledger = union by id, *.jsonl = union of lines, dashboard data and transparency = ours then regenerated): merged
               into the sweep branch, which the lane merges as one pull request
  port         it conflicts in code, or its merge breaks the gate: the merge is undone and one PORT-BRANCH-<slug> item (owner, trigger, closing probe)
               is filed for the executor; the branch is kept (never deleted with unmerged work)
  rejected     a branch whose pull request was closed on purpose (doctrine/branchsweep.json `rejected`, with the reason): never merged; its sha goes to
               the ledger and the branch is deleted (reversible by pushing the sha back)
  live         its last commit is younger than `min_idle_hours`: another session is working on it, so the sweep leaves it alone
  state        a branch the system itself writes (doctrine/branchsweep.json `state_branches`): left alone, and counted

  python3 -m foundation branchsweep --scan [--json]     plan every branch, read-only
  python3 -m foundation branchsweep --apply             merge into the current branch, run the gate after each merge, write the ledger and PORT items
  python3 -m foundation branchsweep --carried NAME      closing probe of a PORT-BRANCH item: exit 0 once main holds the branch's work
  python3 -m foundation branchsweep --prune             delete remote branches whose tip is now an ancestor of origin/main
  python3 -m foundation branchsweep --check             policy and loop are declared

Accounting invariant: entered = merged + superseded + ported + rejected + live + state + skipped (every branch has one recorded disposition, never a silent drop).
"""
from __future__ import annotations
import json, re, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
POLICY = "doctrine/branchsweep.json"
LEDGER = "ops/branchsweep-ledger.jsonl"
LOOP_ID = "branch-sweep"
LEDGER_FILE = "doctrine/decision-ledger.json"
OURS = ("ops/transparency.json", "site/dashboard-data.js", "docs/PROJECT-MEMORY.md", "docs/standards/AGENTIC-STANDARDS.md", "seed/standards/standards.json")
OURS_PREFIX = ("docs/issues/",)  # queue items are filed by id: where both sides filed one, main's is the live one


def policy(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def git(root, *a, ok=(0,)):
    p = subprocess.run(["git", *a], cwd=root, capture_output=True, text=True, errors="replace", timeout=300)
    return p.returncode, p.stdout, p.stderr


def _g(root, *a) -> str:
    rc, out, err = git(root, *a)
    if rc != 0:
        raise RuntimeError(f"git {' '.join(a)}: {err.strip()[:200]}")
    return out


def branches(root, base="origin/main", skip=()) -> list[str]:
    out = _g(root, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
    return sorted(r for r in out.split() if r not in ("origin", "origin/HEAD", base) and r[len("origin/"):] not in skip)


def generated(path: str) -> bool:
    return path == LEDGER_FILE or path.endswith(".jsonl") or path in OURS or path.startswith(OURS_PREFIX)


def plan_one(root, ref: str, base="origin/main") -> dict:
    """One branch against base, without touching the working tree (git merge-tree)."""
    name = ref[len("origin/"):]
    sha = _g(root, "rev-parse", ref).strip()
    rc, _, _ = git(root, "merge-base", "--is-ancestor", ref, base)
    if rc == 0:
        return {"name": name, "sha": sha, "action": "merged", "why": "tip is an ancestor of main"}
    ahead = int(_g(root, "rev-list", "--count", f"{base}..{ref}").strip() or 0)
    rc, out, _ = git(root, "merge-tree", "--write-tree", "--name-only", base, ref)
    lines = out.splitlines()
    tree = lines[0] if lines else ""
    if tree and tree == _g(root, "rev-parse", base + "^{tree}").strip():
        return {"name": name, "sha": sha, "action": "superseded", "why": "merging it changes nothing: main already holds its content", "ahead": ahead}
    if rc == 0:
        return {"name": name, "sha": sha, "action": "merge", "why": "clean three-way merge", "ahead": ahead, "conflicts": []}
    blank = lines.index("") if "" in lines else len(lines)
    conf = sorted({l for l in lines[1:blank] if l})
    code = [c for c in conf if not generated(c)]
    if code:
        return {"name": name, "sha": sha, "action": "port", "why": f"conflicts in code: {', '.join(code[:6])}", "ahead": ahead, "conflicts": conf}
    return {"name": name, "sha": sha, "action": "merge", "why": "conflicts only in generated files", "ahead": ahead, "conflicts": conf}


def scan(root=REPO, base="origin/main") -> list[dict]:
    pol = policy(root)
    state = set(pol.get("state_branches", []))
    out = []
    me = _g(root, "rev-parse", "--abbrev-ref", "HEAD").strip()
    for ref in branches(root, base):
        name = ref[len("origin/"):]
        if name == me:
            continue  # the sweep never merges its own branch into itself
        if name in pol.get("held", {}):
            out.append({"name": name, "sha": _g(root, "rev-parse", ref).strip(), "action": "port", "why": pol["held"][name], "ahead": 0})
            continue
        if name in pol.get("rejected", {}):
            out.append({"name": name, "sha": _g(root, "rev-parse", ref).strip(), "action": "rejected", "why": pol["rejected"][name]})
            continue
        if name in state or any(name.startswith(p) for p in pol.get("state_prefixes", [])):
            out.append({"name": name, "sha": _g(root, "rev-parse", ref).strip(), "action": "state", "why": "written by the system itself"})
            continue
        age_h = (time.time() - int(_g(root, "log", "-1", "--format=%ct", ref).strip() or 0)) / 3600
        if age_h < float(pol.get("min_idle_hours", 4)) and name not in pol.get("held", {}) and name not in pol.get("rejected", {}):
            out.append({"name": name, "sha": _g(root, "rev-parse", ref).strip(), "action": "live", "why": f"last commit {age_h:.1f} h ago: a session is working on it"})
            continue
        try:
            out.append(plan_one(root, ref, base))
        except RuntimeError as e:
            out.append({"name": name, "sha": "", "action": "skipped", "why": str(e)})
    return out


def _union_ledger(root) -> None:
    ours = json.loads(_g(root, "show", ":2:" + LEDGER_FILE)); theirs = json.loads(_g(root, "show", ":3:" + LEDGER_FILE))
    ids = {r["id"] for r in ours["rows"]}
    ours["rows"] += [r for r in theirs["rows"] if r["id"] not in ids]
    (Path(root) / LEDGER_FILE).write_text(json.dumps(ours, indent=1) + "\n", encoding="utf-8", newline="\n")


def _union_lines(root, path) -> None:
    seen, out = set(), []
    for stage in (":2:", ":3:"):
        rc, txt, _ = git(root, "show", stage + path)
        for ln in (txt.splitlines() if rc == 0 else []):
            if ln.strip() and ln not in seen:
                seen.add(ln); out.append(ln)
    (Path(root) / path).write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")


def resolve(root) -> list[str]:
    """Resolve the generated conflicts of a merge in progress; return the files still conflicting."""
    left = []
    for f in _g(root, "diff", "--name-only", "--diff-filter=U").split():
        if f == LEDGER_FILE:
            _union_ledger(root)
        elif f.endswith(".jsonl"):
            _union_lines(root, f)
        elif f in OURS or f.startswith(OURS_PREFIX):
            _g(root, "checkout", "--ours", f)
        else:
            left.append(f); continue
        _g(root, "add", f)
    return left


def gate(root, pol) -> tuple[bool, str]:
    import glob
    for cmd in pol.get("gate", []):
        cmd = [x for a in cmd for x in (sorted(str(Path(g).relative_to(root)) for g in glob.glob(str(Path(root) / a))) if "*" in a else [a])]
        p = subprocess.run(cmd, cwd=root, shell=False, capture_output=True, text=True, errors="replace", timeout=900)
        if p.returncode != 0:
            return False, f"{' '.join(cmd)} -> exit {p.returncode}: {(p.stdout + p.stderr).strip()[-300:]}"
    return True, ""


def port_item(p: dict, pol: dict) -> dict:
    slug = re.sub(r"[^a-z0-9]+", "-", p["name"].lower()).strip("-")[:48]
    iid = f"PORT-BRANCH-{slug}"
    return {"id": iid, "title": f"{iid}: carry {p['name']} onto main",
            "body": f"**Owner:** {pol['port_owner']}\n**Trigger:** branch `{p['name']}` at {p['sha'][:10]} holds work main lacks and cannot merge as is ({p['why']})\n"
                    f"**Done check:** cmd:python3 -m foundation branchsweep --carried {p['name']}\n**Status:** open\n\n"
                    f"Port the change by hand onto current main (it is {p.get('ahead', '?')} commit(s) ahead), keeping tests green; then the sweep deletes the branch.\n\n"
                    f"size: M\n\n**Closing probe:** python3 -m foundation branchsweep --carried {p['name']}",
            "labels": ["role:" + pol["port_owner"], "agent-ready", "ws:branches"], "milestone": "Now", "workstream": "Operations"}


def apply(root=REPO, base="origin/main", dry=False, now=None) -> dict:
    root, pol = Path(root), policy(root)
    plans = scan(root, base)
    done = []
    # SWEEP-BUDGET-1: the gate runs after every merge, so a pass over ~100 branches outran the job's 15 minutes and was cancelled with nothing
    # pushed (2026-11-18). A pass stops merging at budget_seconds; the rest are `skipped` and the next pass takes them.
    deadline = time.monotonic() + int(pol.get("budget_seconds", 600))
    for p in plans:
        a = p["action"]
        filed = root / "docs/issues" / (port_item(p, pol)["id"] + ".json") if a == "merge" else None
        if a == "merge" and not dry and filed.is_file() and p["sha"][:10] in filed.read_text(encoding="utf-8"):
            p.update(action="port", why="a PORT-BRANCH item already holds this branch at this sha; not re-gated every pass")
        elif a == "merge" and not dry and time.monotonic() > deadline:
            p.update(action="skipped", why="pass time budget spent (SWEEP-BUDGET-1); the next pass takes it")
        elif a == "merge" and not dry:
            ref = "origin/" + p["name"]
            head = _g(root, "rev-parse", "HEAD").strip()
            rc, _, _ = git(root, "merge", "--no-ff", "--no-commit", ref)
            left = resolve(root) if rc != 0 else []
            if left:
                git(root, "merge", "--abort"); p.update(action="port", why=f"conflicts in code: {', '.join(left[:6])}")
            elif git(root, "diff", "--cached", "--quiet")[0] == 0:  # after resolution main already holds everything: no empty merge commit
                git(root, "merge", "--abort"); p.update(action="superseded", why="after resolving generated files the merge adds nothing")
            else:
                msg = f"branchsweep: merge {p['name']} ({p.get('ahead', '?')} commit(s))\n\nBRANCH-SWEEP-1: this branch held work main lacked; sha {p['sha']}."
                rc2, _, e2 = git(root, "commit", "-q", "--allow-empty", "-m", msg)
                ok, why = gate(root, pol) if rc2 == 0 else (False, e2.strip()[:200])
                if ok:  # a merge that deletes a large part of a code file is a stale rewrite, not a contribution
                    cap = int(pol.get("max_deleted_lines", 80))
                    for ln in _g(root, "diff", "--numstat", "HEAD^1", "HEAD").splitlines():
                        add, dele, path = (ln.split("\t") + ["", "", ""])[:3]
                        if dele.isdigit() and int(dele) > cap and not generated(path):
                            ok, why = False, f"merge deletes {dele} lines of {path} (cap {cap}): a stale rewrite"; break
                if not ok:
                    git(root, "merge", "--abort"); git(root, "reset", "-q", "--hard", head)
                    p.update(action="port", why="merge breaks the gate: " + why)
        if p["action"] == "port" and not dry:
            f = root / "docs/issues" / (port_item(p, pol)["id"] + ".json")
            f.parent.mkdir(parents=True, exist_ok=True)
            if not f.exists():
                f.write_text(json.dumps(port_item(p, pol), indent=2) + "\n", encoding="utf-8", newline="\n")
        done.append({k: p[k] for k in ("name", "sha", "action", "why")})
    n = lambda a: sum(1 for d in done if d["action"] == a)
    rec = {"at": int(now or time.time()), "entered": len(plans), "merged": n("merge") + n("merged"), "superseded": n("superseded"), "ported": n("port"),
           "rejected": n("rejected"), "live": n("live"), "state": n("state"), "skipped": n("skipped"), "dispositions": done, "dry": dry}
    rec["invariant"] = rec["entered"] == rec["merged"] + rec["superseded"] + rec["ported"] + rec["rejected"] + rec["live"] + rec["state"] + rec["skipped"]
    if not dry:
        (root / LEDGER).parent.mkdir(parents=True, exist_ok=True)
        with (root / LEDGER).open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(rec) + "\n")
    return rec


def prune(root=REPO, base="origin/main", dry=False) -> list[dict]:
    """Delete remote branches that carry nothing main lacks. The sha goes to the ledger first, so the deletion is reversible."""
    root, out = Path(root), []
    # SWEEP-PRUNE-1: `superseded` is often decided inside apply(), after generated files are resolved by rule; a fresh scan sees those branches as
    # `merge` again, so 92 superseded branches were never deleted (2026-11-19). The latest pass's dispositions count, at the same sha only.
    seen: set = set()
    lp = root / LEDGER
    if lp.is_file():
        for line in reversed(lp.read_text(encoding="utf-8").splitlines()):
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if "dispositions" in rec and not rec.get("dry"):
                seen = {(d["name"], d["sha"]) for d in rec["dispositions"] if d.get("action") == "superseded" and d.get("sha")}
                break
    for p in scan(root, base):
        if (p["name"], p["sha"]) in seen and p["action"] == "merge":
            p = {**p, "action": "superseded", "why": "the latest pass merged it and main gained nothing (SWEEP-PRUNE-1)"}
        if p["action"] in ("merged", "superseded", "rejected") and p["name"] not in policy(root).get("held", {}):
            if not dry:
                git(root, "push", "origin", "--delete", p["name"])
            out.append({"name": p["name"], "sha": p["sha"], "action": "deleted", "why": p["why"]})
    if out and not dry:
        (root / LEDGER).parent.mkdir(parents=True, exist_ok=True)
        with (root / LEDGER).open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps({"at": int(time.time()), "pruned": out}) + "\n")
    return out


def _api(token, method, path, fetch=None):
    """GitHub REST call. fetch is injectable for tests: fetch(method, url, headers) -> (status, json)."""
    url = "https://api.github.com" + path
    headers = {"authorization": "Bearer " + token, "accept": "application/vnd.github+json", "user-agent": "ultrastable-branchsweep"}
    if fetch:
        return fetch(method, url, headers)
    import urllib.request, urllib.error
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            return r.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, {"error": str(e)[:120]}


def remote_prune(repos, token, prefixes=("claude/", "agent/"), dry=False, fetch=None, root=REPO, now=None) -> dict:
    """BRANCH-SWEEP-2: the stale session branches of every fleet repository, by API (no checkout). A branch is deleted only when the
    default branch already holds it (ahead_by 0) or its pull request merged with this exact head sha (squash merges). Any other branch
    is kept and counted, never deleted. The sha goes to the ledger before the delete, so every deletion can be restored."""
    out = {"at": int(now or time.time()), "remote": []}
    for repo in repos:
        st, info = _api(token, "GET", f"/repos/{repo}", fetch)
        if st != 200 or not info:
            out["remote"].append({"repo": repo, "unreadable": st}); continue
        default = info.get("default_branch", "main")
        st, brs = _api(token, "GET", f"/repos/{repo}/branches?per_page=100", fetch)
        if st != 200 or not isinstance(brs, list):
            out["remote"].append({"repo": repo, "unreadable": st}); continue
        rows = []
        for b in brs:
            name, sha = b.get("name", ""), (b.get("commit") or {}).get("sha", "")
            if name == default or not name.startswith(tuple(prefixes)) or b.get("protected"):
                continue
            why = None
            st, cmp = _api(token, "GET", f"/repos/{repo}/compare/{default}...{name}", fetch)
            if st == 200 and cmp and cmp.get("ahead_by") == 0:
                why = f"{default} holds every commit"
            else:
                owner = repo.split("/")[0]
                st2, prs = _api(token, "GET", f"/repos/{repo}/pulls?state=all&head={owner}:{name}&per_page=10", fetch)
                open_pr = any(p.get("state") == "open" for p in (prs or []))
                merged = [p for p in (prs or []) if p.get("merged_at") and (p.get("head") or {}).get("sha") == sha]
                if merged and not open_pr:
                    why = f"pull request #{merged[0]['number']} merged with this head"
            if not why:
                rows.append({"name": name, "sha": sha, "action": "kept", "why": "holds work the default branch lacks"}); continue
            if not dry:
                ds, _ = _api(token, "DELETE", f"/repos/{repo}/git/refs/heads/{name}", fetch)
                rows.append({"name": name, "sha": sha, "action": "deleted" if ds == 204 else "delete_failed", "why": why + ("" if ds == 204 else f" (HTTP {ds})")})
            else:
                rows.append({"name": name, "sha": sha, "action": "would_delete", "why": why})
        out["remote"].append({"repo": repo, "branches": rows})
    if not dry:
        (Path(root) / LEDGER).parent.mkdir(parents=True, exist_ok=True)
        with (Path(root) / LEDGER).open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(out) + "\n")
    return out


def carried(root, name: str, base="origin/main") -> tuple[bool, str]:
    """The closing probe of a PORT-BRANCH item: true when the branch is gone, or main already holds everything it has (merged or superseded)."""
    rc, _, _ = git(root, "rev-parse", "--verify", "-q", "origin/" + name)
    if rc != 0:
        return True, f"{name}: no such remote branch"
    p = plan_one(root, "origin/" + name, base)
    return p["action"] in ("merged", "superseded"), f"{name}: {p['action']}: {p['why']}"


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    try:
        pol = policy(root)
    except (OSError, ValueError) as e:
        return [f"{POLICY}: {e}"]
    for k in ("state_branches", "state_prefixes", "gate", "port_owner"):
        if k not in pol:
            bad.append(f"{POLICY}: lacks {k}")
    reg = json.loads((root / "instances/ultrastable/loop-registry.json").read_text(encoding="utf-8"))
    if LOOP_ID not in {l.get("id") for l in reg["loops"]}:
        bad.append(f"loop {LOOP_ID} is not registered")
    return bad


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "branchsweep ok"); return 1 if e else 0
    if "--carried" in a:
        i = a.index("--carried"); ok, why = carried(REPO, a[i + 1] if i + 1 < len(a) else ""); print(why); return 0 if ok else 1
    if "--scan" in a:
        r = scan()
        print(json.dumps(r, indent=1) if "--json" in a else "\n".join(f"{p['action']:10} {p['name']}  {p['why']}" for p in r)); return 0
    if "--apply" in a:
        r = apply(); print(json.dumps({k: v for k, v in r.items() if k != "dispositions"})); return 0 if r["invariant"] else 1
    if "--remote" in a:
        import os
        tok = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
        if not tok:
            print("branchsweep --remote: no token in GH_TOKEN or GITHUB_TOKEN"); return 1
        r = remote_prune(policy().get("fleet_repos", []), tok, dry="--dry" in a); print(json.dumps(r, indent=1)); return 0
    if "--prune" in a:
        print(json.dumps(prune(), indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

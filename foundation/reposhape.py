# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REPO-SHAPE-1 (Rowan, 2026-11-26): a repository the system writes must stay small enough for the system to maintain. Ultrastable is the foundation for any autonomous system.

Root cause it closes: one session held its work back and opened a change of 3,000+ files and 291,031 added lines. Nothing classified what a path is
(code every system runs, platform code, prose, assets, or state that loops write), nothing bounded a session's change, and state (1,282 queue items, ledgers,
evidence) sat in the same tree as the code, so every bot commit moved the code repository's history. The fix is to split by rate of change and owner, not by topic.

  python3 -m foundation reposhape --check            every tracked path belongs to an area in doctrine/repo-shape.json (a new top-level path must be claimed)
  python3 -m foundation reposhape --report           files and bytes per class and per area, and the share of state in git (JSON)
  python3 -m foundation reposhape --probe state      exit 1 while state is above state_budget.max_share_of_tracked_files (the closing probe of Q-SHAPE-state-out-of-git)
  python3 -m foundation reposhape --pr BASE...HEAD   a session branch changes at most pr_budget.max_files and adds at most max_added_lines, state excluded (exit 1)
  python3 -m foundation reposhape --split BASE...HEAD [--apply] [--max-files N] [--max-lines N]
                                                     the stack of in-budget batches that carries the same tree; --apply writes it as local branches
                                                     <branch>-part-1 ... -part-N, each on the one before, and checks the last has HEAD's tree. The original
                                                     branch is never changed or deleted.

Consumers: .github/workflows/checks.yml (--check on every change, --pr on every PR), agents/AGENTS.md, instances Q-SHAPE-state-out-of-git (closing probe).
Tests: tests/foundation/test_reposhape.py.
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/repo-shape.json"
ORDER = ["kernel", "platform", "docs", "assets", "state"]  # a stack lands code before the prose and data that describe it


def policy(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def area_of(path: str, areas: list[dict]) -> dict | None:
    """The area with the longest matching prefix; area path '.' claims a file at the root."""
    best = None
    for a in areas:
        p = a["path"]
        hit = ("/" not in path) if p == "." else (path == p or path.startswith(p + "/"))
        if hit and (best is None or len(p) > len(best["path"])):
            best = a
    return best


def _git(root, *args, check=True) -> str:
    r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr.strip()[:300]}")
    return r.stdout


def tracked(root=REPO) -> list[str]:
    return [p for p in _git(root, "ls-files", "-z").split("\0") if p]


def check(root=REPO) -> list[str]:
    areas = policy(root)["areas"]
    bad, seen = [], set()
    for p in tracked(root):
        if area_of(p, areas) is None:
            top = p.split("/")[0]
            if top not in seen:
                seen.add(top); bad.append(f"{top}: not claimed by any area in {POLICY} (add one with its class and home)")
    classes = {"kernel", "platform", "docs", "assets", "state"}
    for a in areas:
        if a["class"] not in classes:
            bad.append(f"area {a['path']}: unknown class {a['class']!r}")
    return bad


def report(root=REPO) -> dict:
    pol, rows, cls = policy(root), {}, {}
    for p in tracked(root):
        a = area_of(p, pol["areas"])
        name = a["path"] if a else "(unclassified)"
        c = a["class"] if a else "(unclassified)"
        try:
            size = (Path(root) / p).stat().st_size
        except OSError:
            size = 0
        for table, key in ((rows, name), (cls, c)):
            t = table.setdefault(key, {"files": 0, "bytes": 0}); t["files"] += 1; t["bytes"] += size
    total = sum(v["files"] for v in cls.values()) or 1
    share = cls.get("state", {"files": 0})["files"] / total
    return {"files": total, "by_class": cls, "by_area": dict(sorted(rows.items(), key=lambda kv: -kv[1]["files"])), "state_share": round(share, 4),
            "state_budget": pol["state_budget"]["max_share_of_tracked_files"]}


def changes(root, rng: str) -> list[dict]:
    """[{path, added, deleted}] for BASE...HEAD, renames split into a delete and an add so every path is one file."""
    out = []
    for line in _git(root, "diff", "--numstat", "--no-renames", rng).splitlines():
        a, d, path = line.split("\t", 2)
        out.append({"path": path, "added": 0 if a == "-" else int(a), "deleted": 0 if d == "-" else int(d)})
    return out


def counted(rows: list[dict], pol: dict) -> list[dict]:
    ex = set(pol["pr_budget"]["exempt_classes"])
    return [r for r in rows if (area_of(r["path"], pol["areas"]) or {"class": "platform"})["class"] not in ex]


def pr_problems(rows: list[dict], pol: dict, branch: str = "") -> list[str]:
    b = pol["pr_budget"]
    if any(branch.startswith(p) for p in b["exempt_branch_prefixes"]):
        return []
    rows = counted(rows, pol)
    files, added = len(rows), sum(r["added"] for r in rows)
    bad = []
    if files > b["max_files"]:
        bad.append(f"{files} files changed (budget {b['max_files']}, state excluded)")
    if added > b["max_added_lines"]:
        bad.append(f"{added} lines added (budget {b['max_added_lines']}, state excluded)")
    if bad:
        bad.append("split it: python3 -m foundation reposhape --split BASE...HEAD --apply (a stack of in-budget branches; the original is kept)")
    return bad


def plan(rows: list[dict], pol: dict, max_files: int | None = None, max_lines: int | None = None) -> list[dict]:
    """Batches in landing order: by class (kernel first), then by area, then by path; a batch closes at the file or line budget."""
    mf, ml = max_files or pol["pr_budget"]["max_files"], max_lines or pol["pr_budget"]["max_added_lines"]
    keyed = []
    for r in rows:
        a = area_of(r["path"], pol["areas"]) or {"class": "platform", "path": "(unclassified)"}
        keyed.append((ORDER.index(a["class"]) if a["class"] in ORDER else len(ORDER), a["path"], r["path"], r, a["class"]))
    keyed.sort(key=lambda k: k[:3])
    batches, cur = [], None
    for _, area, _, r, cls in keyed:
        # state travels with its own batch, so a state-only PR is exempt from the budget and never mixed into code
        if cur is None or cur["class"] != cls or len(cur["files"]) >= mf or (cur["added"] + r["added"] > ml and cur["files"]):
            cur = {"class": cls, "files": [], "added": 0}; batches.append(cur)
        cur["files"].append(r["path"]); cur["added"] += r["added"]
    for i, b in enumerate(batches, 1):
        b["name"] = f"part-{i}"; b["of"] = len(batches)
    return batches


def apply_split(root, rng: str, batches: list[dict]) -> list[str]:
    """Stacked local branches from the merge base; the last carries HEAD's tree. Never touches the branch it was cut from."""
    head = rng.split("...")[-1] or "HEAD"
    base = _git(root, "merge-base", *rng.split("...")).strip()
    cur_branch = _git(root, "rev-parse", "--abbrev-ref", head).strip()
    stem = cur_branch if cur_branch != "HEAD" else "split"
    head_sha = _git(root, "rev-parse", head).strip()
    names, prev = [], base
    try:
        for b in batches:
            name = f"{stem}-{b['name']}"
            _git(root, "checkout", "-q", "-B", name, prev)
            for p in b["files"]:
                if subprocess.run(["git", "-C", str(root), "cat-file", "-e", f"{head_sha}:{p}"], capture_output=True).returncode == 0:
                    _git(root, "checkout", head_sha, "--", p)  # the file exists at HEAD: take it
                else:
                    _git(root, "rm", "-q", "--ignore-unmatch", "--", p)
            _git(root, "commit", "-q", "--allow-empty", "-m", f"split {b['name']} of {b['of']} from {stem} ({b['class']}, {len(b['files'])} files)")
            names.append(name); prev = name
        if batches:
            left = _git(root, "diff", "--name-only", prev, head_sha).split()
            if left:
                raise RuntimeError(f"the stack differs from {head} in {len(left)} file(s), first {left[0]}")
    finally:
        _git(root, "checkout", "-q", cur_branch if cur_branch != "HEAD" else head_sha, check=False)
    return names


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation reposhape")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true"); g.add_argument("--report", action="store_true")
    g.add_argument("--probe"); g.add_argument("--pr"); g.add_argument("--split")
    ap.add_argument("--apply", action="store_true"); ap.add_argument("--max-files", type=int); ap.add_argument("--max-lines", type=int)
    a = ap.parse_args(argv)
    if a.check:
        bad = check()
        print("reposhape ok: every tracked path is classified" if not bad else "\n".join(bad))
        return 1 if bad else 0
    if a.report:
        print(json.dumps(report(), indent=1)); return 0
    if a.probe:
        r = report()
        print(json.dumps({"state_share": r["state_share"], "budget": r["state_budget"]}))
        return 1 if r["state_share"] > r["state_budget"] else 0
    pol = policy()
    if a.pr:
        bad = pr_problems(changes(REPO, a.pr), pol, os.environ.get("HEAD_REF", ""))
        print("reposhape: inside the PR budget" if not bad else "\n".join(bad))
        return 1 if bad else 0
    rows = changes(REPO, a.split)
    batches = plan(rows, pol, a.max_files, a.max_lines)
    out = {"files": len(rows), "batches": [{"name": b["name"], "class": b["class"], "files": len(b["files"]), "added": b["added"]} for b in batches]}
    if a.apply:
        out["branches"] = apply_split(REPO, a.split, batches)
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

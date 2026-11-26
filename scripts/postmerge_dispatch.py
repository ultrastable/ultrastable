# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""POSTMERGE-DISPATCH-1: a merge made with GITHUB_TOKEN (GitHub auto-merge enabled by a bot, or the lane's own merge) fires no push
workflow, so every `on: push` workflow on main stayed silent after #2243: seed-launch (BOOT-ACCEPT-1) and deploy-ultrastable never ran.
DEPLOY-1 in scripts/lane.sh dispatched two deploys by a hand-kept path list, and only for merges the lane itself made.

This reads every workflow's own `on.push` (branches and paths), so the map cannot drift from the triggers, and for each PR merged into main
in the last `--hours` it dispatches every workflow whose push paths match the PR's files, has `workflow_dispatch`, and has no run created
since the merge (a person's merge fires push itself; a second lane pass finds the run and does nothing). Idempotent; read-only without --apply.

  python3 scripts/postmerge_dispatch.py [--apply] [--hours 6] [--repo owner/name]
Ultrastable is the foundation for any autonomous system."""
from __future__ import annotations
import fnmatch, json, os, re, subprocess, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def triggers(root: Path = ROOT) -> dict:
    """{workflow file: [path globs]} for workflows that run on push to main and can be dispatched. No paths filter means every path."""
    import yaml
    out = {}
    for f in sorted((root / ".github/workflows").glob("*.y*ml")):
        on = (yaml.safe_load(f.read_text()) or {}).get("on", (yaml.safe_load(f.read_text()) or {}).get(True)) or {}
        if not isinstance(on, dict) or "workflow_dispatch" not in on or "push" not in on:
            continue
        push = on.get("push") or {}
        if "main" not in (push.get("branches") or ["main"]):
            continue
        out[f.name] = list(push.get("paths") or ["**"])
    return out


def _glob(pattern: str) -> re.Pattern:
    """GitHub path filter semantics: ** crosses directories, * does not."""
    rx, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            rx += ".*"; i += 2
            if i < len(pattern) and pattern[i] == "/": i += 1
        elif pattern[i] == "*":
            rx += "[^/]*"; i += 1
        elif pattern[i] == "?":
            rx += "[^/]"; i += 1
        else:
            rx += re.escape(pattern[i]); i += 1
    return re.compile(rx + r"\Z")


def matches(files: list[str], globs: list[str]) -> bool:
    pos = [g for g in globs if not g.startswith("!")]
    neg = [g[1:] for g in globs if g.startswith("!")]
    return any(any(_glob(g).match(f) for g in pos) and not any(_glob(g).match(f) for g in neg) for f in files)


def plan(merged: list[dict], trig: dict, runs_since) -> list[tuple[int, str]]:
    """[(pr, workflow)] to dispatch. merged: [{number, merged_at, files}]; runs_since(workflow, iso) -> count of runs created at or after."""
    todo, seen = [], set()
    for pr in sorted(merged, key=lambda p: p["merged_at"]):
        for wf, globs in trig.items():
            if wf in seen or not matches(pr["files"], globs):
                continue
            if runs_since(wf, pr["merged_at"]) == 0:
                todo.append((pr["number"], wf)); seen.add(wf)
    return todo


def _gh(*a: str) -> str:
    r = subprocess.run(["gh", *a], capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise RuntimeError(f"gh {' '.join(a[:3])}: {r.stderr.strip()[:200]}")
    return r.stdout


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    repo = a[a.index("--repo") + 1] if "--repo" in a else os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
    hours = float(a[a.index("--hours") + 1]) if "--hours" in a else 6.0
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    prs = json.loads(_gh("api", f"repos/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=30"))
    merged = []
    for p in prs:
        if p.get("merged_at") and datetime.fromisoformat(p["merged_at"].replace("Z", "+00:00")) >= since:
            out = _gh("api", f"repos/{repo}/pulls/{p['number']}/files?per_page=100", "--paginate", "--jq", ".[].filename")
            files = [l for l in out.splitlines() if l.strip()]
            merged.append({"number": p["number"], "merged_at": p["merged_at"], "files": files})

    def runs_since(wf: str, iso: str) -> int:
        return int(_gh("api", f"repos/{repo}/actions/workflows/{wf}/runs?branch=main&created=>={iso}&per_page=1", "--jq", ".total_count").strip() or 0)

    todo = plan(merged, triggers(), runs_since)
    if not todo:
        print(f"postmerge: {len(merged)} merge(s) in {hours:g} h, every push workflow they touch already ran")
    failed = 0
    for n, wf in todo:
        if "--apply" not in a:
            print(f"postmerge: would dispatch {wf} for #{n}"); continue
        try:
            _gh("workflow", "run", wf, "-R", repo, "--ref", "main"); print(f"postmerge: #{n} dispatched {wf}")
        except RuntimeError as e:
            failed += 1; print(f"postmerge: #{n} {wf} not dispatched: {e}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

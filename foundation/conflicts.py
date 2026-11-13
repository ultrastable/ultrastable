"""CONFLICT-CLOSE-1: a conflicting pull request is closed by the lane, not left for a session.

  python3 -m foundation conflicts --pr N [--apply]

Measured 2026-11-13: every open PR was CONFLICTING, each only in the generated and append-only files every change touches (doctrine/decision-ledger.json,
ops/improvements.jsonl, ops/transparency.json, site/dashboard-data.js). `scripts/resolve_generated.py` resolved exactly those and nothing called it; the
lane labeled the PR `conflict` and promised a 12 h close that lived in the Issues SLA sweep, which exits when Issues are off. So a conflict ended every
unattended change. One pass here: merge main into the branch, resolve the generated files, push, dispatch checks. When that cannot finish (a real
conflict, or the push is refused) an executor-authored PR is closed and its branch deleted: its queue item is still open on main, so the next executor
run redoes it from current main. A session-authored PR keeps the `conflict` label, since its work exists nowhere else.
"""
from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GH = "ultrastable/ultrastable"
EXECUTOR_AUTHORS = ("app/github-actions", "github-actions[bot]", "github-actions")
EXECUTOR_BRANCHES = ("agent/Q-", "agent/OL-")


def executor_authored(author: str, branch: str) -> bool:
    """True only for a change the queue can reproduce: opened by the workflow token on a branch named for a queue item."""
    return author in EXECUTOR_AUTHORS and branch.startswith(EXECUTOR_BRANCHES)


def decide(merge_clean: bool, resolver_ok: bool, pushed: bool, by_executor: bool) -> str:
    """resolved: the branch now merges and checks were asked for. requeued: closed, the queue item is retaken. left: labeled, work kept."""
    if (merge_clean or resolver_ok) and pushed:
        return "resolved"
    return "requeued" if by_executor else "left"


def _sh(argv, root, timeout=180) -> tuple[int, str]:
    try:
        r = subprocess.run(argv, cwd=root, capture_output=True, text=True, timeout=timeout, encoding="utf-8")
        return r.returncode, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, f"{type(e).__name__}: {e}"


def resolve(pr: int, root=REPO, apply=False, repo=GH, sh=_sh) -> dict:
    code, o = sh(["gh", "pr", "view", str(pr), "-R", repo, "--json", "headRefName,author,isCrossRepository"], root)
    if code:
        return {"pr": pr, "result": "error", "detail": "pr view failed: " + o[-200:]}
    v = json.loads(o)
    branch, author = v["headRefName"], (v.get("author") or {}).get("login", "")
    by_exec = executor_authored(author, branch)
    row = {"pr": pr, "branch": branch, "author": author, "executor_authored": by_exec}
    if v.get("isCrossRepository"):
        return {**row, "result": "left", "detail": "head is in another repository"}
    if not apply:
        return {**row, "result": "dry-run"}
    _, start = sh(["git", "rev-parse", "HEAD"], root)
    merge_clean = resolver_ok = pushed = False
    detail = ""
    try:
        code, o = sh(["git", "fetch", "origin", "main", branch], root)
        if code:
            return {**row, "result": "error", "detail": "fetch failed: " + o[-200:]}
        sh(["git", "checkout", "-f", "--detach", f"origin/{branch}"], root)
        ident = ["-c", "user.name=ultrastable-lane", "-c", "user.email=lane@users.noreply.github.com"]
        code, o = sh(["git", *ident, "merge", "--no-edit", "origin/main"], root)
        merge_clean = code == 0
        if not merge_clean:
            rc, ro = sh([sys.executable, "scripts/resolve_generated.py"], root)
            resolver_ok = rc == 0
            detail = ro[-300:]
            if resolver_ok:
                cc, co = sh(["git", *ident, "commit", "--no-edit"], root)
                resolver_ok = cc == 0
                detail = detail if cc == 0 else "commit failed: " + co[-200:]
            else:
                sh(["git", "merge", "--abort"], root)
        if merge_clean or resolver_ok:
            pc, po = sh(["git", "push", "origin", f"HEAD:refs/heads/{branch}"], root)
            pushed = pc == 0
            if not pushed:
                detail = "push refused: " + po[-300:]
    finally:
        sh(["git", "merge", "--abort"], root)
        sh(["git", "checkout", "-f", "--detach", start.strip()], root)
    result = decide(merge_clean, resolver_ok, pushed, by_exec)
    row.update(result=result, detail=detail)
    if result == "resolved":
        sh(["gh", "pr", "edit", str(pr), "-R", repo, "--remove-label", "conflict"], root)
        kc, ko = sh(["gh", "workflow", "run", "checks.yml", "-R", repo, "--ref", branch], root)
        if kc:
            row["kick_failed"] = ko[-160:]
    elif result == "requeued":
        cc, co = sh(["gh", "pr", "close", str(pr), "-R", repo, "--delete-branch", "--comment",
                     "lane: the conflict with main could not be resolved automatically (" + (detail or "non-generated files conflict")[:200] +
                     "). Closed; the queue item is still open on main and the executor redoes it from current main."], root)
        if cc:
            row.update(result="error", detail="close failed: " + co[-200:])
    return row


def main(argv) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation conflicts")
    ap.add_argument("--pr", type=int, required=True); ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    row = resolve(a.pr, apply=a.apply)
    print(json.dumps(row))
    return 1 if row["result"] == "error" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

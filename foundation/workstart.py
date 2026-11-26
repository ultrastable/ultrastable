# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""WORKSTART-1: work that starts is durable at once.

When a work issue opens, the server opens a branch `agent/issue-<n>-<slug>` with a handoff note and a draft pull request
that says `Closes #<n>`. Whoever picks the work up (the executor, the orchestrator, a session) pushes to that branch, so
nothing lives only in a session. Idempotent: an issue that already has an open PR naming it, or its branch, is skipped.

  python3 -m foundation workstart --issue N        # one issue (the issues.opened event)
  python3 -m foundation workstart --sweep --max 5  # open issues with no linked PR, oldest first
  python3 -m foundation workstart --check          # self-test of the pure parts
Needs GH_TOKEN with contents and pull-requests write; GITHUB_REPOSITORY names the repository.
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys

SKIP_LABELS = {"wontfix", "duplicate", "question", "no-pr", "gate"}


def slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s[:40].rstrip("-") or "work"


def branch_for(n: int, title: str) -> str:
    return f"agent/issue-{n}-{slug(title)}"


def note(n: int, title: str, url: str) -> str:
    return (f"# Handoff: issue #{n}\n\n{title}\n\nIssue: {url}\n\n"
            "Opened by WORKSTART-1 when the issue opened. Push the work to this branch; the lane merges it when checks pass.\n")


def body(n: int) -> str:
    return (f"Closes #{n}\n\nDraft opened by WORKSTART-1 so the work has a durable home from the moment it starts.\n\n"
            f"## Handoff\nitem: issue-{n}\nagent: workstart\n")


def wanted(issue: dict) -> bool:
    if "pull_request" in issue or issue.get("state") != "open":
        return False
    return not ({l["name"] for l in issue.get("labels", [])} & SKIP_LABELS)


def _gh(args: list[str], data: dict | None = None) -> dict | list | None:
    cmd = ["gh", "api", *args]
    if data is not None:
        cmd += ["--input", "-"]
    r = subprocess.run(cmd, input=json.dumps(data) if data is not None else None, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"gh api {' '.join(args)}: {(r.stderr or r.stdout).strip()[:300]}")
    return json.loads(r.stdout) if r.stdout.strip() else None


def linked(repo: str, n: int) -> bool:
    q = f"repo:{repo} is:pr is:open {n} in:body"
    res = _gh(["-X", "GET", "search/issues", "-f", f"q={q}"]) or {}
    return any(re.search(rf"#{n}\b", it.get("body") or "") for it in res.get("items", []))


def start(repo: str, issue: dict) -> str:
    n, title = issue["number"], issue["title"]
    if not wanted(issue):
        return f"#{n}: skipped (label or state)"
    if linked(repo, n):
        return f"#{n}: already has an open PR"
    br = branch_for(n, title)
    main = _gh([f"repos/{repo}/git/ref/heads/main"])["object"]["sha"]
    try:
        _gh([f"repos/{repo}/git/refs", "-X", "POST"], {"ref": f"refs/heads/{br}", "sha": main})
    except RuntimeError as e:
        if "Reference already exists" not in str(e):
            raise
    path = f"docs/handoff/issue-{n}.md"
    _gh([f"repos/{repo}/contents/{path}", "-X", "PUT"], {"message": f"chore(handoff): start work on #{n} (WORKSTART-1)", "branch": br,
        "content": base64.b64encode(note(n, title, issue.get("html_url", "")).encode()).decode()})
    pr = _gh([f"repos/{repo}/pulls", "-X", "POST"], {"title": f"wip: {title}"[:120], "head": br, "base": "main", "draft": True, "body": body(n)})
    return f"#{n}: draft PR #{pr['number']} on {br}"


def _check() -> int:
    assert slug("Fix: Safari export button!") == "fix-safari-export-button"
    assert branch_for(7, "") == "agent/issue-7-work"
    assert "Closes #12" in body(12)
    assert not wanted({"state": "open", "labels": [{"name": "gate"}]})
    assert not wanted({"state": "open", "labels": [], "pull_request": {}})
    assert wanted({"state": "open", "labels": [{"name": "bug"}]})
    print("workstart ok")
    return 0


def main(argv: list[str]) -> int:
    if "--check" in argv:
        return _check()
    repo = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
    out, fails = [], 0
    if "--issue" in argv:
        n = int(argv[argv.index("--issue") + 1])
        todo = [_gh([f"repos/{repo}/issues/{n}"])]
    elif "--sweep" in argv:
        cap = int(argv[argv.index("--max") + 1]) if "--max" in argv else 5
        todo = [i for i in (_gh([f"repos/{repo}/issues?state=open&sort=created&direction=asc&per_page=100"]) or []) if wanted(i)][: cap * 4]
    else:
        print(__doc__)
        return 2
    opened = 0
    for issue in todo:
        if "--sweep" in argv and opened >= cap:
            break
        try:
            r = start(repo, issue)
            opened += "draft PR" in r
        except RuntimeError as e:
            r, fails = f"#{issue['number']}: failed: {e}", fails + 1
        out.append(r)
        print(r)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

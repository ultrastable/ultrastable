# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PR-NEVER-LOSE-1 (2026-11-27): automation never discards unmerged work. PR #2615 was closed by PR-BOUND-1 on a `conflict` label set earlier, although the
branch merged cleanly with current main: the closer trusted a stale label, kept nothing but the branch, and branch cleanup could then delete that branch.
Every closer of an unmerged pull request goes through `safe_close`:
  1. the pull request is read again, live, over REST (GraphQL is refused in cloud sessions); an unknown merge state is retried, and still unknown is NOT a conflict;
  2. a pull request that is mergeable (clean, unstable, behind, has_hooks, blocked on checks only) is never closed: a stale `conflict`/`ci-failed` label is removed instead;
  3. a conflict is attempted once more through GitHub's own update-branch; only a conflict that survives that is closable;
  4. the head commit is pinned under refs/archive/pr-<n>-<sha7> and read back before the close, so no branch deletion can lose it.
`recover` reopens a pull request automation closed that main still lacks (PR-RECOVER-1). Both return reasons; neither raises on a refusal."""
import calendar, json, re, subprocess, sys, time

MARKERS = ("PR-BOUND-1", "STALL-ACT-1", "SLA-1", "lane (PR-BOUND-1)")
STALE_LABELS = ("conflict", "ci-failed")
MERGEABLE_STATES = {"clean", "unstable", "behind", "has_hooks", "blocked", "draft"}


class ApiError(RuntimeError):
    def __init__(self, msg, status=None): super().__init__(msg); self.status = status


def gh_api(path, method="GET", fields=None):
    """REST through the gh CLI; raises ApiError with the HTTP status when it can be read from the message."""
    cmd = ["gh", "api", "-X", method, path]
    for k, v in (fields or {}).items(): cmd += ["-f" if isinstance(v, str) else "-F", f"{k}={v if isinstance(v, str) else json.dumps(v)}"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        m = re.search(r"HTTP (\d{3})", r.stderr + r.stdout)
        raise ApiError((r.stderr or r.stdout).strip()[:200], int(m.group(1)) if m else None)
    return json.loads(r.stdout) if r.stdout.strip() else {}


def live(repo, n, api=gh_api, sleep=time.sleep, tries=5):
    """The pull request now. `mergeable` is null while GitHub computes it: wait, then report state 'unknown' rather than guess."""
    d = api(f"repos/{repo}/pulls/{n}")
    for _ in range(tries - 1):
        if d.get("state") != "open" or d.get("mergeable") is not None or str(d.get("mergeable_state") or "unknown").lower() not in ("", "unknown"): break
        sleep(2); d = api(f"repos/{repo}/pulls/{n}")
    return d


def verdict(d):
    """mergeable | conflict | unknown | closed. Only 'conflict' (mergeable false and state dirty) can justify a close."""
    if d.get("state") != "open": return "closed"
    ms = str(d.get("mergeable_state") or "unknown").lower()
    if d.get("mergeable") is False or ms == "dirty": return "conflict"
    if d.get("mergeable") is True or ms in MERGEABLE_STATES: return "mergeable"
    return "unknown"


def archive_ref(repo, n, sha, api=gh_api):
    """Pins the head under refs/archive/pr-<n>-<sha7> and reads it back. Returns the ref name; raises when it cannot be proven."""
    ref = f"refs/archive/pr-{n}-{sha[:7]}"
    try: api(f"repos/{repo}/git/refs", "POST", {"ref": ref, "sha": sha})
    except ApiError as e:
        if "already exists" not in str(e).lower() and e.status != 422: raise
    got = api(f"repos/{repo}/git/ref/archive/pr-{n}-{sha[:7]}")
    if (got.get("object") or {}).get("sha") != sha: raise ApiError(f"archive ref {ref} reads back {(got.get('object') or {}).get('sha')}, not {sha}")
    return ref


def in_main(repo, sha, base="main", api=gh_api):
    """True when every commit of sha is already in base (compare ahead_by 0). An unreadable answer is False: unknown is not carried."""
    try: c = api(f"repos/{repo}/compare/{base}...{sha}")
    except ApiError: return False
    return c.get("ahead_by") == 0


def safe_close(repo, n, why, api=gh_api, sleep=time.sleep):
    """Closes PR n only when it is really conflicted, after one refresh attempt, with its head pinned. Returns {closed, reason, ...}."""
    d = live(repo, n, api, sleep)
    v = verdict(d)
    if v == "closed": return {"closed": False, "reason": "already closed"}
    if v in ("mergeable", "unknown"):
        names = {l["name"] for l in d.get("labels", [])}
        for lab in STALE_LABELS:
            if lab in names:
                try: api(f"repos/{repo}/issues/{n}/labels/{lab}", "DELETE")
                except ApiError: pass
        return {"closed": False, "reason": f"{v}: not closed ({why}); stale labels cleared", "state": d.get("mergeable_state")}
    try:
        api(f"repos/{repo}/pulls/{n}/update-branch", "PUT")
        return {"closed": False, "reason": "refreshed from main; merge state re-read next pass"}
    except ApiError: pass  # a real conflict: update-branch refuses with 422
    sha = (d.get("head") or {}).get("sha")
    if not sha: return {"closed": False, "reason": "head sha unreadable"}
    if not in_main(repo, sha):
        try: ref = archive_ref(repo, n, sha, api)
        except ApiError as e: return {"closed": False, "reason": f"head not pinned, not closed: {e}"}
    else: ref = None
    api(f"repos/{repo}/issues/{n}/comments", "POST", {"body": f"PR-NEVER-LOSE-1: closing after {why}. Head {sha[:10]} is pinned at {ref or 'main (already contained)'}; "
        f"queue item OL-PR-{n} carries it onto current main, and `python3 -m foundation prsafe --recover` reopens it if main stops conflicting."})
    api(f"repos/{repo}/pulls/{n}", "PATCH", {"state": "closed"})
    return {"closed": True, "reason": why, "ref": ref, "sha": sha}


def recover(repo, days=14, api=gh_api, now=None, apply=False, sleep=time.sleep):
    """PRs automation closed (a marker in its last comments) whose head main lacks: reopen when they no longer conflict. Once per PR (PR-RECOVER-1 comment)."""
    now = now or time.time(); out = {"reopened": [], "lost": [], "skipped": []}
    prs = api(f"repos/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50")
    for p in prs if isinstance(prs, list) else []:
        if p.get("merged_at"): continue
        n = p["number"]; sha = (p.get("head") or {}).get("sha")
        closed = p.get("closed_at") or ""
        if closed and now - calendar.timegm(time.strptime(closed, "%Y-%m-%dT%H:%M:%SZ")) > days * 86400: continue
        cm = api(f"repos/{repo}/issues/{n}/comments?per_page=100"); cm = cm if isinstance(cm, list) else []
        if not any(any(m in (c.get("body") or "") for m in MARKERS) for c in cm): continue
        if any("PR-RECOVER-1" in (c.get("body") or "") for c in cm): out["skipped"].append(n); continue
        if not sha or in_main(repo, sha): continue
        out["lost"].append(n)
        if not apply: continue
        try: api(f"repos/{repo}/git/refs", "POST", {"ref": f"refs/heads/{p['head']['ref']}", "sha": sha})  # restore a branch cleanup deleted
        except ApiError: pass
        try: api(f"repos/{repo}/pulls/{n}", "PATCH", {"state": "open"})
        except ApiError as e: out["skipped"].append(f"{n} reopen {e}"); continue
        api(f"repos/{repo}/issues/{n}/comments", "POST", {"body": "PR-RECOVER-1: reopened. Automation closed this pull request while main still lacks its commits; the lane merges it, or resolves its conflict, on its next pass."})
        out["reopened"].append(n)
    return out


def main(argv):
    import os
    repo = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
    if "--recover" in argv or "--check" in argv:
        try: r = recover(repo, apply="--apply" in argv)
        except Exception as e: print(json.dumps({"state": "unmeasured", "error": str(e)})); return 1
        print(json.dumps(r)); return 1 if "--check" in argv and r["lost"] and "--apply" not in argv else 0
    print(__doc__); return 2


if __name__ == "__main__": sys.exit(main(sys.argv[1:]))

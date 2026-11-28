#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLOW-AUDIT-1 (Rowan, 2026-11-28: "An Ultrastable system shall always resolve its own issues and merge its own PRs automatically and timely.
... always audit and remediate its own failure modes and their root causes automatically."): reads every tenant repository's open issues and
pull requests and lists what has idled past its limit. Measured when written: Open Questions had 3 queue issues open for 2 days and base-rates
14, and the fix pull requests waited as drafts and then conflicted with two parallel fixes. Exit 1 lists each finding; the failure-audit
detector `tenant-flow` files it as Q-AUDIT-tenant-flow for the executor, whose remedy is a pull request merged by the tenant's own automerge.

  python3 -m foundation tenant_flow            read the registry's tenants through `gh api` (needs GH_TOKEN)
Limits: ISSUE_HOURS an open issue; DRAFT_MIN a draft the system opened; PR_MIN a ready pull request. A reading that cannot be made is a finding."""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ISSUE_HOURS, DRAFT_MIN, PR_MIN = 48, 60, 60
OWN = ("ccr-", "claude/")


def _age_min(ts: str, now: datetime) -> float:
    return (now - datetime.fromisoformat(ts.replace("Z", "+00:00"))).total_seconds() / 60


def findings(repo: str, issues: list, prs: list, now: datetime) -> list[str]:
    """Pure: what is idle in one repository. `issues` excludes pull requests."""
    out = []
    for i in issues:
        h = _age_min(i["created_at"], now) / 60
        if h > ISSUE_HOURS:
            out.append(f"{repo}#{i['number']}: issue open {h:.0f}h (limit {ISSUE_HOURS}h) with {i.get('comments', 0)} comment(s): {i['title'][:60]}")
    for p in prs:
        m = _age_min(p["created_at"], now)
        own = p["head"]["ref"].startswith(OWN) or p["user"]["type"] == "Bot"
        if p.get("draft") and own and m > DRAFT_MIN:
            out.append(f"{repo}#{p['number']}: the system's own draft pull request open {m:.0f} min (limit {DRAFT_MIN}); it should be ready and merged")
        elif not p.get("draft") and m > PR_MIN:
            out.append(f"{repo}#{p['number']}: pull request open {m:.0f} min (limit {PR_MIN}), not merged")
    return out


def _gh(path: str):
    r = subprocess.run(["gh", "api", "--paginate", path], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"gh api {path}: {r.stderr.strip()[:120]}")
    return json.loads(r.stdout.replace("][", ","))


def main() -> int:
    reg = json.loads((REPO / "doctrine/tenant-repos.json").read_text(encoding="utf-8"))["tenants"]
    now, bad = datetime.now(timezone.utc), []
    for slug, t in sorted(reg.items()):
        repo = t.get("repo")
        if not repo or t.get("state") == "planned":
            continue
        try:
            issues = [i for i in _gh(f"repos/{repo}/issues?state=open&per_page=100") if "pull_request" not in i]
            prs = _gh(f"repos/{repo}/pulls?state=open&per_page=100")
        except Exception as e:  # a missing reading is a breach (E2)
            bad.append(f"{repo}: cannot read ({e})")
            continue
        bad += findings(repo, issues, prs, now)
    print("\n".join(bad) if bad else "tenant-flow: every tenant's issues and pull requests are inside their limits")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

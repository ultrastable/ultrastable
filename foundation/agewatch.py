# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SLA-8H-1 (Rowan, 2026-11-21): "The Ultrastable system shall always resolve all of these issues completely automatically ... the user shall never
have to intervene." No open issue or pull request in any org repository may be older than `sla_hours`. This is the probe that measures it live.

  python3 -m foundation agewatch            JSON: oldest open issue and PR per repository, and every item past the limit
  python3 -m foundation agewatch --check    exit 1 when anything is past the limit or a repository cannot be read (unmeasured is never 0)

Run on every fleet pass (.github/workflows/fleet.yml, every 10 minutes from the tick Worker), after dispose and the merge lane, so a red run is the
alarm and ciwatch files it as a queue item. The ladder that keeps it green: dispose shelves queue items at doctrine/dispose.json ttl_hours (the GitHub
issues are a mirror of that queue, GH-MIRROR-1), and the tick sweeper closes a client PR as superseded at PR_LADDER_MIN (seed/worker/src/sweeper.js).
Pure logic: overdue()."""
import json, os, sys, urllib.request
from datetime import datetime, timezone

REPOS = ("ultrastable", "seed", "workers", "spec", "license", "ops", "practical-solutions", ".github")
ORG = "ultrastable"
SLA_HOURS = 8


def overdue(rows: list[dict], now: datetime, sla_hours: float = SLA_HOURS) -> dict:
    """rows: {repo, kind, number, created_at, title}. Returns oldest ages and the rows past the limit."""
    out = {"sla_hours": sla_hours, "oldest_issue_hours": 0.0, "oldest_pr_hours": 0.0, "open_issues": 0, "open_prs": 0, "overdue": []}
    for r in rows:
        age = (now - datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))).total_seconds() / 3600
        k = "pr" if r["kind"] == "pr" else "issue"
        out[f"open_{k}s"] += 1
        out[f"oldest_{k}_hours"] = round(max(out[f"oldest_{k}_hours"], age), 1)
        if age > sla_hours:
            out["overdue"].append({**r, "age_hours": round(age, 1)})
    return out


def fetch(token: str, opener=urllib.request.urlopen) -> tuple[list[dict], list[str]]:
    rows, errors = [], []
    for repo in REPOS:
        page = 1
        while True:
            req = urllib.request.Request(f"https://api.github.com/repos/{ORG}/{repo}/issues?state=open&per_page=100&page={page}",
                                         headers={"authorization": f"Bearer {token}", "accept": "application/vnd.github+json", "user-agent": "ultrastable-agewatch"})
            try:
                with opener(req, timeout=30) as r:
                    js = json.loads(r.read().decode())
            except Exception as e:  # noqa: BLE001 - recorded: an unreadable repository is unmeasured and fails the check
                if getattr(e, "code", 0) in (404, 410):  # repository without issues or not visible to this token: no items to age
                    break
                errors.append(f"{repo}: {type(e).__name__}: {e}"); break
            for i in js:
                rows.append({"repo": repo, "kind": "pr" if i.get("pull_request") else "issue", "number": i["number"], "created_at": i["created_at"], "title": i["title"][:100]})
            if len(js) < 100:
                break
            page += 1
    return rows, errors


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    if not token:
        print(json.dumps({"status": "unmeasured", "why": "no GH_TOKEN"})); return 1 if "--check" in a else 0
    rows, errors = fetch(token)
    res = {**overdue(rows, datetime.now(timezone.utc)), "errors": errors}
    res["overdue"] = sorted(res["overdue"], key=lambda r: -r["age_hours"])
    print(json.dumps({**res, "overdue": res["overdue"][:50], "overdue_count": len(res["overdue"])}, indent=1))
    if "--check" in a and (res["overdue"] or errors):
        print(f"agewatch: {len(res['overdue'])} open item(s) past {SLA_HOURS} h, {len(errors)} unreadable repo(s) (SLA-8H-1)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

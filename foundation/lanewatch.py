"""LANE-WATCH-1: no green PR stays open (owner directive 2026-11-12: every PR merges itself on green, forever). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation lanewatch --check [--minutes 30]    reads open PRs with `gh`; fails when a green, mergeable, non-draft PR is older than the threshold
Each stuck PR is reported with its cause: the credential gate (a PR that changes .github/workflows/** needs LANE_PAT or a GitHub App), a lane that has not run, or an unknown cause.
Run by the lane after every merge pass (.github/workflows/lane.yml), so a stuck PR is a red lane run and a backlog entry, never a silent wait. Pure logic: classify().
"""
from __future__ import annotations
import json, subprocess, sys
from datetime import datetime, timezone


def green(pr: dict) -> bool:
    rollup = pr.get("statusCheckRollup") or []
    return bool(rollup) and all((c.get("conclusion") or c.get("state")) in ("SUCCESS", "NEUTRAL", "SKIPPED") for c in rollup)


def classify(prs: list[dict], now: datetime, minutes: int = 30) -> list[dict]:
    out = []
    for pr in prs:
        if pr.get("isDraft") or pr.get("mergeable") != "MERGEABLE" or not green(pr):
            continue
        age = (now - datetime.fromisoformat(pr["updatedAt"].replace("Z", "+00:00"))).total_seconds() / 60
        if age < minutes:
            continue
        labels = {l["name"] if isinstance(l, dict) else l for l in pr.get("labels", [])}
        cause = "credential gate: the PR changes .github/workflows/** and no LANE_PAT or GitHub App is bound" if "needs-pat" in labels else "the lane has not merged it; run the lane (scripts/lane.sh)"
        out.append({"number": pr["number"], "age_minutes": int(age), "cause": cause})
    return out


def main(argv) -> int:
    minutes = int(argv[argv.index("--minutes") + 1]) if "--minutes" in argv else 30
    raw = subprocess.run(["gh", "pr", "list", "--state", "open", "--limit", "100", "--json", "number,isDraft,mergeable,labels,updatedAt,statusCheckRollup"], capture_output=True, text=True)
    if raw.returncode:
        print("lanewatch: gh failed: " + raw.stderr[-300:]); return 2
    stuck = classify(json.loads(raw.stdout), datetime.now(timezone.utc), minutes)
    for s in stuck:
        print(f"lanewatch: PR #{s['number']} is green and unmerged after {s['age_minutes']} min: {s['cause']}")
    print("lanewatch ok" if not stuck else f"lanewatch: {len(stuck)} green PR(s) not merged")
    return 1 if stuck else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

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


def _t(x: str) -> datetime:
    return datetime.fromisoformat(x.replace("Z", "+00:00"))


def latency(prs: list[dict], target_min: float = 3.0) -> dict:
    """PR-LATENCY-1: pr_open_to_merge in minutes over merged non-draft-origin PRs; breach when the median exceeds the target."""
    xs = sorted((_t(p["mergedAt"]) - _t(p["createdAt"])).total_seconds() / 60 for p in prs if p.get("mergedAt"))
    if not xs:
        return {"n": 0, "median": 0.0, "p90": 0.0, "breach": False, "target": target_min}
    med, p90 = xs[len(xs) // 2], xs[min(len(xs) - 1, int(len(xs) * 0.9))]
    return {"n": len(xs), "median": round(med, 1), "p90": round(p90, 1), "breach": med > target_min, "target": target_min}


def latency_main(argv) -> int:
    """pr_open_to_merge <= 3 min (median, last 30 merged PRs). A breach files one Q-PRLAT issue (the executor's queue) and fails the run."""
    raw = subprocess.run(["gh", "pr", "list", "--state", "merged", "--limit", "30", "--json", "number,createdAt,mergedAt"], capture_output=True, text=True)
    if raw.returncode:
        print("lanewatch latency: gh failed: " + raw.stderr[-300:]); return 2
    r = latency(json.loads(raw.stdout))
    print(f"pr_open_to_merge median {r['median']} min, p90 {r['p90']} min over {r['n']} PRs (target {r['target']})")
    if not r["breach"]:
        return 0
    title = "Q-PRLAT: pr_open_to_merge above 3 minutes"
    have = subprocess.run(["gh", "issue", "list", "--state", "open", "--search", "Q-PRLAT in:title", "--json", "number"], capture_output=True, text=True)
    if have.returncode == 0 and not json.loads(have.stdout or "[]"):
        body = (f"**Owner:** operations\n**Trigger:** pr_open_to_merge median {r['median']} min (p90 {r['p90']}) over {r['n']} merged PRs\n"
                "**Fix:** find the slowest checks job or queue wait and split, cache or remove it\n"
                "**Closing probe:** `python3 -m foundation lanewatch --latency` exits 0\n**Status:** open")
        subprocess.run(["gh", "issue", "create", "--title", title, "--body", body], capture_output=True, text=True)
    return 1


def main(argv) -> int:
    if "--latency" in argv:
        return latency_main(argv)
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

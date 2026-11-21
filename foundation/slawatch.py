# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SLA-1: every open PR and issue is inside its written service level (doctrine/sla.json). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation slawatch --check [--repo OWNER/NAME ...]    reads open PRs and issues with `gh`; fails loudly when any is past its limit, whatever its state

Unlike lanewatch (green mergeable PRs only), this has no blind class: conflicting, red, unchecked and draft PRs count. Enforcement is the tick Worker sweeper
(seed/worker/src/sla.js); this is the independent detector (failure mode fm-sla-breach, detector sla-breach). Pure logic: breaches().
"""
from __future__ import annotations
import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPOS = ["ultrastable/ultrastable", "ultrastable/practical-solutions", "ultrastable/ops", "ultrastable/.github"]


def _t(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def issue_days(labels: list[str], sla: dict) -> int:
    if "p0" in labels:
        return sla["issue"]["p0_days"]
    return sla["issue"]["p1_days"] if "p1" in labels else sla["issue"]["default_days"]


def breaches(prs: list[dict], issues: list[dict], now: datetime, sla: dict) -> list[str]:
    out = []
    for p in prs:
        age = (now - _t(p["createdAt"])).total_seconds() / 60
        if age > sla["pr"]["hard_min"]:
            out.append(f"PR #{p['number']} open {int(age)} min (limit {sla['pr']['hard_min']}), state {p.get('mergeStateStatus', '?')}")
    for i in issues:
        labels = [l["name"] if isinstance(l, dict) else l for l in i.get("labels", [])]
        age = (now - _t(i["createdAt"])).total_seconds() / 86400
        if age > issue_days(labels, sla):
            out.append(f"issue #{i['number']} open {age:.1f} d (limit {issue_days(labels, sla)})")
    return out


def _gh(kind: str, repo: str, fields: str) -> list[dict]:
    r = subprocess.run(["gh", kind, "list", "-R", repo, "--state", "open", "--limit", "1000", "--json", fields], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"gh {kind} list {repo}: {r.stderr[-200:]}")
    return json.loads(r.stdout)


def main(argv) -> int:
    sla = json.loads((ROOT / "doctrine" / "sla.json").read_text())
    repos = [argv[i + 1] for i, a in enumerate(argv) if a == "--repo"] or REPOS
    now, bad = datetime.now(timezone.utc), []
    for repo in repos:
        try:
            found = breaches(_gh("pr", repo, "number,createdAt,mergeStateStatus"), _gh("issue", repo, "number,createdAt,labels"), now, sla)
        except RuntimeError as e:
            print(f"slawatch: {repo} unmeasured ({e})"); bad.append(repo); continue  # unmeasured is never clean
        bad += [f"{repo}: {b}" for b in found]
    for b in bad:
        print("slawatch: " + b)
    print("slawatch ok" if not bad else f"slawatch: {len(bad)} breach(es)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

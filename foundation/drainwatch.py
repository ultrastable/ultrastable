"""DRAIN-FLEET-1: open issues and open PRs, per repository, across the whole fleet. The target is 0 and 0.

  python3 -m foundation drainwatch            counts per repo in github/org-settings.json; exit 1 while any count is above 0
  python3 -m foundation drainwatch --json     the same as JSON (consumed by the lane and the criticality tick)
  python3 -m foundation drainwatch --timely   TIMELY-1: exit 1 while any open issue is past its SLA or any ready PR is past PR_HOURS, or a repository is unmeasured
A repository that cannot be read is reported as unmeasured, never as 0. Pure logic: summarize().
"""
from __future__ import annotations
import datetime as dt, json, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


# TIMELY-1 (Rowan, 2026-11-28: "An Ultrastable system shall always resolve its own issues and merge its own pull requests automatically and timely."):
# an open issue is overdue past its priority's SLA (the hours scripts/sla.sh enforces: docs/AUTOMATION.md), a ready pull request past PR_HOURS, which is long
# enough for the lane to see its checks go green and merge it. A label that records a disposition (a held, filed or deferred item, a PR waiting on a
# credential with its default in effect) is a declared wait, not an overdue item. Mirrored `queue` issues and work records count: the clock covers every issue.
SLA_HOURS = {"p0": 4, "p1": 24, "p2": 72, "p3": 168}
PR_HOURS = 24
DECLARED_WAIT = {"hold", "later", "gate:filed", "m:After filing", "needs-pat"}


def _age_h(iso: str, now: dt.datetime) -> float:
    return (now - dt.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).total_seconds() / 3600


def overdue(raw: dict, now: dt.datetime | None = None) -> dict:
    """raw as for summarize(). -> {"rows": [{repo, kind, number, age_h, limit_h}], "unmeasured": [repo]}; pure."""
    now = now or dt.datetime.now(dt.timezone.utc)
    rows, unmeasured = [], []
    for r, d in sorted(raw.items()):
        if d["issues"] is None or d["pulls"] is None:
            unmeasured.append(r); continue
        for i in d["issues"]:
            if "pull_request" in i:
                continue
            names = {l.get("name") for l in i.get("labels") or []}
            if names & DECLARED_WAIT:
                continue
            limit = next((SLA_HOURS[p] for p in ("p0", "p1", "p2", "p3") if p in names), SLA_HOURS["p3"])
            age = _age_h(i["created_at"], now)
            if age > limit:
                rows.append({"repo": r, "kind": "issue", "number": i["number"], "age_h": round(age), "limit_h": limit})
        for p in d["pulls"]:
            names = {l.get("name") for l in p.get("labels") or []}
            if p.get("draft") or names & DECLARED_WAIT:
                continue
            age = _age_h(p["created_at"], now)
            if age > PR_HOURS:
                rows.append({"repo": r, "kind": "pr", "number": p["number"], "age_h": round(age), "limit_h": PR_HOURS})
    return {"rows": rows, "unmeasured": unmeasured}


def repos(root=REPO) -> list[str]:
    return sorted(json.loads((Path(root) / "github/org-settings.json").read_text(encoding="utf-8"))["repos"])


def gh_list(path: str):
    p = subprocess.run(["gh", "api", "--paginate", path], capture_output=True, text=True, timeout=120)
    if p.returncode:
        return None
    out = []
    for chunk in p.stdout.replace("][", "]\n[").splitlines():
        if chunk.strip():
            out += json.loads(chunk)
    return out


def summarize(raw: dict) -> dict:
    """raw: {repo: {"issues": list|None, "pulls": list|None}} -> per-repo counts and fleet totals."""
    rows, tot, unmeasured = {}, {"open_issues": 0, "open_prs": 0}, []
    for r, d in raw.items():
        if d["issues"] is None or d["pulls"] is None:
            unmeasured.append(r); continue
        issues = [i for i in d["issues"] if "pull_request" not in i]
        rows[r] = {"open_issues": len(issues), "open_prs": len(d["pulls"])}
        for k in tot:
            tot[k] += rows[r][k]
    return {"repos": rows, "fleet": tot, "unmeasured": unmeasured, "drained": tot == {"open_issues": 0, "open_prs": 0} and not unmeasured}


def read(root=REPO, fetch=gh_list) -> dict:
    return {r: {"issues": fetch(f"repos/{r}/issues?state=open&per_page=100"), "pulls": fetch(f"repos/{r}/pulls?state=open&per_page=100")} for r in repos(root)}


def measure(root=REPO, fetch=gh_list) -> dict:
    return summarize(read(root, fetch))


def main(argv) -> int:
    if "--timely" in argv:
        o = overdue(read())
        if "--json" in argv:
            print(json.dumps(o, indent=1))
        else:
            for x in o["rows"]:
                print(f"{x['repo']}#{x['number']} {x['kind']}: open {x['age_h']} h, limit {x['limit_h']} h")
            for r in o["unmeasured"]:
                print(f"{r}: unmeasured (read failed)")
            print(f"timely: {len(o['rows'])} overdue, {len(o['unmeasured'])} unmeasured")
        return 0 if not o["rows"] and not o["unmeasured"] else 1
    s = measure()
    if "--json" in argv:
        print(json.dumps(s, indent=1))
    else:
        for r, c in s["repos"].items():
            print(f"{r}: open_issues={c['open_issues']} open_prs={c['open_prs']}")
        for r in s["unmeasured"]:
            print(f"{r}: unmeasured (read failed)")
        print(f"fleet: open_issues={s['fleet']['open_issues']} open_prs={s['fleet']['open_prs']} drained={s['drained']}")
    return 0 if s["drained"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

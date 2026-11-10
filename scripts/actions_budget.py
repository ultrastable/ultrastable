#!/usr/bin/env python3
"""Estimate this month's Actions minutes from run history against the free quota.
Usage: actions_budget.py [--pause]   (needs GH_TOKEN, GITHUB_REPOSITORY, gh CLI)
Each run is rounded up to whole minutes (jobs are billed per job, so this is a floor for multi-job runs).
Writes actions-budget-report.md. With --pause, sets paused=true in actions-budget.json at pause_at_pct."""
import collections, datetime as dt, json, math, os, subprocess, sys

def runs(repo, since):
    out = subprocess.run(["gh", "api", "--paginate", f"repos/{repo}/actions/runs?per_page=100&created=>={since}",
                          "-q", ".workflow_runs[] | [.name,.event,.conclusion,.run_started_at,.updated_at] | @tsv"],
                         capture_output=True, text=True, check=True).stdout
    for line in out.splitlines():
        n, ev, concl, a, b = line.split("\t")
        if a and b:
            f = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
            yield n, ev, concl, max(1, math.ceil((f(b) - f(a)).total_seconds() / 60))

def main():
    cfg = json.load(open("actions-budget.json"))
    repo = os.environ["GITHUB_REPOSITORY"]
    now = dt.datetime.now(dt.timezone.utc)
    since = now.strftime("%Y-%m-01")
    per, bad = collections.Counter(), collections.Counter()
    for n, ev, concl, m in runs(repo, since):
        per[n] += m
        if concl in ("failure", "cancelled", "timed_out"):
            bad[n] += m
    used = sum(per.values())
    day = now.day
    days = (dt.date(now.year + now.month // 12, now.month % 12 + 1, 1) - dt.date(now.year, now.month, 1)).days
    proj = used * days / day
    quota = cfg["monthly_free_minutes"]
    pct = 100 * proj / quota
    lines = [f"# Actions minutes, {since[:7]}", f"Used {used} min by day {day}; projected {proj:.0f} of {quota} free ({pct:.0f}%).", "",
             "| workflow | minutes | of which failed or cancelled |", "|---|---|---|"]
    lines += [f"| {n} | {m} | {bad[n]} |" for n, m in per.most_common()]
    open("actions-budget-report.md", "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    if pct >= cfg["warn_at_pct"]:
        print(f"::warning::projected {pct:.0f}% of the free minutes")
    if "--pause" in sys.argv and pct >= cfg["pause_at_pct"] and not cfg["paused"]:
        cfg["paused"] = True
        json.dump(cfg, open("actions-budget.json", "w"), indent=2); open("actions-budget.json", "a").write("\n")
        print("::warning::paused=true written to actions-budget.json")
    return 0

if __name__ == "__main__":
    sys.exit(main())

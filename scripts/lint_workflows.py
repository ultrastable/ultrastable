#!/usr/bin/env python3
"""Cheap lint for the minute-budget rule (docs/ops/ACTIONS-BUDGET.md). Every workflow must carry
header comments `# budget:`, `# trigger:` and `# free-alternative:`; every job needs timeout-minutes;
no matrix; no schedule more often than daily; scheduled and pull_request workflows need concurrency."""
import glob, re, sys, yaml

def main():
    bad = []
    for f in sorted(glob.glob(".github/workflows/*.yml") + glob.glob("seed/.github/workflows/*.yml")):
        text = open(f).read()
        d = yaml.safe_load(text)
        on = d.get(True, d.get("on")) or {}
        on = on if isinstance(on, dict) else {k: None for k in (on if isinstance(on, list) else [on])}
        for h in ("# budget:", "# trigger:", "# free-alternative:"):
            if h not in text:
                bad.append(f"{f}: missing header comment '{h}'")
        for name, job in (d.get("jobs") or {}).items():
            if "timeout-minutes" not in job:
                bad.append(f"{f}: job '{name}' has no timeout-minutes")
            if "matrix" in (job.get("strategy") or {}):
                bad.append(f"{f}: job '{name}' uses a matrix")
        for s in on.get("schedule") or []:
            c = s["cron"].split()
            if c[0].startswith("*") or c[1].startswith("*"):
                bad.append(f"{f}: cron '{s['cron']}' runs more than daily")
        if ("schedule" in on or "pull_request" in on) and "concurrency" not in d:
            bad.append(f"{f}: needs a concurrency group")
    for b in bad:
        print("::error::" + b)
    print(f"workflow budget lint: {len(bad)} problem(s)")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())

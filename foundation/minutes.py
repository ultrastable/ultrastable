"""Actions minute-budget guard. Ultrastable is the foundation for any autonomous system, and it spends CI minutes like money.

Rules (docs/ops/ACTIONS-BUDGET.md): no schedule more often than daily (the same limit scripts/lint_workflows.py holds this repository to; a repository with
workflows is public under REPO-STANDARD-1, so a daily clock costs no private minutes), no matrix, timeout on every job,
header comments, concurrency on pull_request and schedule triggers. `check_dir` lints a workflows folder; `estimate`
turns declared budgets into a monthly figure against the free allowance.
"""
from __future__ import annotations
import re
from pathlib import Path

import yaml

HEADERS = ("# budget:", "# trigger:", "# free-alternative:")


def _daily_or_rarer(cron: str) -> bool:
    """One fire a day at most: a fixed minute and a single fixed hour (no list, range or step)."""
    c = cron.split()
    return len(c) == 5 and c[0].isdigit() and c[1].isdigit()


def check_dir(wf_dir) -> list[str]:
    bad = []
    for f in sorted(Path(wf_dir).glob("*.yml")):
        text = f.read_text(encoding="utf-8")
        d = yaml.safe_load(text)
        on = d.get(True, d.get("on")) or {}
        on = on if isinstance(on, dict) else {k: None for k in (on if isinstance(on, list) else [on])}
        for h in HEADERS:
            if h not in text:
                bad.append(f"{f.name}: missing '{h}'")
        for n, job in (d.get("jobs") or {}).items():
            if "timeout-minutes" not in job:
                bad.append(f"{f.name}: job {n} has no timeout-minutes")
            if "matrix" in (job.get("strategy") or {}):
                bad.append(f"{f.name}: job {n} uses a matrix")
        for s in on.get("schedule") or []:
            if not _daily_or_rarer(s["cron"]):
                bad.append(f"{f.name}: cron '{s['cron']}' is more often than daily")
        if ("schedule" in on or "pull_request" in on) and "concurrency" not in d:
            bad.append(f"{f.name}: needs a concurrency group")
    return bad


def estimate(budgets: list[dict], monthly_free: int = 2000, warn_pct=60, pause_pct=85) -> dict:
    """budgets: [{"name", "minutes_per_run", "runs_per_month"}]."""
    total = sum(b["minutes_per_run"] * b["runs_per_month"] for b in budgets)
    pct = round(100 * total / monthly_free, 1)
    state = "pause" if pct >= pause_pct else "warn" if pct >= warn_pct else "ok"
    return {"monthly_minutes": total, "pct_of_free": pct, "state": state}

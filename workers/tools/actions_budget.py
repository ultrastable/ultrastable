#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""GitHub Actions minutes watchdog (US-SPEC-24, requirements US-24-R20..R26).

Reads a billing usage report (the shape of GET /organizations/{org}/settings/billing/usage: {"usageItems": [...]}),
sums Linux-equivalent Actions minutes per repository for one month, and compares them with ops/actions-budget.json.

  python tools/actions_budget.py --from-file usage.json [--month 2026-11] [--budget ops/actions-budget.json]
  python tools/actions_budget.py --org ultrastable          # live: `gh api` (read-only GET)
  python tools/actions_budget.py --from-file usage.json --emit-decision-card

Decision: ok | warn50 | warn80 | over. Exit codes: 0 ok, 1 warn50/warn80, 2 over. On `over` it lists the non-essential
workflows to disable. Stdlib only; it never changes anything on GitHub (disabling is done by the caller after the decision).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_BUDGET = Path(__file__).resolve().parent.parent / "ops" / "actions-budget.json"


def load_budget(path) -> dict:
    """Read the budget file. Two schemas name the same limits and both load unchanged (US-24-R21): this tool's
    `monthly_minutes_total`, `thresholds`, `essential_workflows`, `non_essential_workflows`, and the platform file
    `actions-budget.json` (`monthly_free_minutes`, `warn_at_pct`, `pause_at_pct`, `essential`, `paused_workflows`, `paused`)."""
    b = json.loads(Path(path).read_text(encoding="utf8"))
    if "monthly_minutes_total" not in b and "monthly_free_minutes" in b:
        b["monthly_minutes_total"] = b["monthly_free_minutes"]
    if "thresholds" not in b and ("warn_at_pct" in b or "pause_at_pct" in b):
        b["thresholds"] = [float(b.get("warn_at_pct", 50)) / 100, float(b.get("pause_at_pct", 80)) / 100]
    if "essential_workflows" not in b and isinstance(b.get("essential"), list):
        b["essential_workflows"] = list(b["essential"])
    if b.get("paused_workflows"):
        b["non_essential_workflows"] = list(dict.fromkeys([*b.get("non_essential_workflows", []), *b["paused_workflows"]]))
    b["paused"] = b.get("paused") is True
    if "default_per_repo" not in b and not b.get("per_repo") and b.get("monthly_minutes_total"):
        b["default_per_repo"] = b["monthly_minutes_total"]  # one number only: no repository may use more than the total
    b.setdefault("linux_minute_rate_usd", 0.006)
    b.setdefault("thresholds", [0.5, 0.8])
    b.setdefault("per_repo", {})
    b.setdefault("non_essential_workflows", [])
    b.setdefault("essential_workflows", [])
    return b


def minutes_by_repo(report: dict, month: str | None, budget: dict) -> dict:
    """Linux-equivalent minutes per repository for `month` (YYYY-MM). Non-minute rows (storage) are ignored."""
    rate = budget["linux_minute_rate_usd"]
    out: dict = {}
    for it in report.get("usageItems", []):
        if str(it.get("product", "")).lower() != "actions" or str(it.get("unitType", "")).lower() != "minutes":
            continue
        if month and not str(it.get("date", "")).startswith(month):
            continue
        price = it.get("pricePerUnit") or 0
        eq = float(it.get("quantity", 0)) * (price / rate if price else 1.0)
        repo = it.get("repositoryName") or "(org)"
        out[repo] = out.get(repo, 0.0) + eq
    return out


def decide(per_repo: dict, budget: dict) -> dict:
    lo, hi = sorted(budget["thresholds"])[:2]
    total_budget = float(budget["monthly_minutes_total"])
    total = sum(per_repo.values())
    rows, level = [], 0  # 0 ok, 1 warn50, 2 warn80, 3 over
    names = ["ok", "warn50", "warn80", "over"]
    rank = lambda r: 3 if r >= 1 else 2 if r >= hi else 1 if r >= lo else 0  # noqa: E731
    for repo in sorted(set(per_repo) | set(budget["per_repo"])):
        cap = float(budget["per_repo"].get(repo, budget.get("default_per_repo", 0)))
        used = per_repo.get(repo, 0.0)
        ratio = used / cap if cap else (1.0 if used else 0.0)
        rows.append({"repo": repo, "used": round(used, 1), "budget": cap, "ratio": round(ratio, 3), "decision": names[rank(ratio)]})
        level = max(level, rank(ratio))
    tratio = total / total_budget if total_budget else 1.0
    total_decision = names[rank(tratio)]
    level = max(level, rank(tratio))
    name = names[level]
    keep = set(budget.get("essential_workflows", []))  # an essential workflow listed as non-essential by mistake is never disabled
    pct = {"warn50": int(lo * 100), "warn80": int(hi * 100)}
    return {
        "decision": name, "exit_code": {0: 0, 1: 1, 2: 1, 3: 2}[level],
        "total_used": round(total, 1), "total_budget": total_budget, "total_ratio": round(tratio, 3), "total_decision": total_decision,
        "repos": rows,
        "threshold_pct": pct.get(name),
        "disable_workflows": [w for w in budget["non_essential_workflows"] if w not in keep] if name == "over" else [],
        "over_repos": [r["repo"] for r in rows if r["ratio"] >= 1],
    }


def decision_card(d: dict, org: str, month: str | None) -> dict:
    return {
        "id": f"GATE-ACTIONS-BUDGET-{(month or 'month').replace('-', '')}-{d['decision'].upper()}",
        "what": f"GitHub Actions minutes for {org} at {d['total_used']} of {d['total_budget']} ({int(d['total_ratio'] * 100)}%): {d['decision']}",
        "why_gated": "Spend on Actions is a cost the owner caps. At 100% non-essential workflows are disabled; raising the budget or the spending limit is the owner's decision (IDENTITY-BOUND: it spends the owner's money).",
        "default_in_effect": ("Non-essential workflows disabled: " + ", ".join(d["disable_workflows"])) if d["disable_workflows"]
                             else "No change; the watchdog keeps reading usage and the spending limit stays at USD 0.",
        "closing_probe": f"python tools/actions_budget.py --org {org} exits 0 in the next month, or the owner records a raised budget in ops/actions-budget.json",
    }


def fetch_live(org: str, month: str | None) -> dict:
    ep = f"organizations/{org}/settings/billing/usage"  # no leading slash: Git Bash rewrites it into a path
    if month:
        y, m = month.split("-")
        ep += f"?year={int(y)}&month={int(m)}"
    r = subprocess.run(["gh", "api", ep], capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise SystemExit(f"gh api failed: {r.stderr.strip()[:300]}")
    return json.loads(r.stdout)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--from-file")
    src.add_argument("--org")
    ap.add_argument("--budget", default=str(DEFAULT_BUDGET))
    ap.add_argument("--month", help="YYYY-MM (default: current UTC month for --org, latest month in the file for --from-file)")
    ap.add_argument("--emit-decision-card", action="store_true")
    a = ap.parse_args(argv)
    budget = load_budget(a.budget)
    month = a.month
    if a.org:
        month = month or datetime.now(timezone.utc).strftime("%Y-%m")
        report = fetch_live(a.org, month)
    else:
        report = json.loads(Path(a.from_file).read_text(encoding="utf8"))
        if not month:
            ds = [str(i.get("date", ""))[:7] for i in report.get("usageItems", []) if i.get("date")]
            month = max(ds) if ds else None
    d = decide(minutes_by_repo(report, month, budget), budget)
    d["month"] = month
    org = a.org or next((i.get("organizationName") for i in report.get("usageItems", []) if i.get("organizationName")), "ultrastable")
    if a.emit_decision_card:
        print(json.dumps(decision_card(d, org, month), indent=2))
    else:
        print(json.dumps(d, indent=2))
    return d["exit_code"]


if __name__ == "__main__":
    sys.exit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TENANT-STORAGE-1: the tenant storage decision, budgets and QNFO migration plan are declared and bounded.

  (docs/architecture/tenant-storage.md is its document)
  python3 -m foundation tenantstorage --check    declaration is complete and the worst case of every tenant at full budget stays under the monthly ceiling
  python3 -m foundation tenantstorage --worst    that worst case in USD (an ESTIMATE from list prices)

The same bound is enforced at run time by workers core/tenantstore (BudgetGuard); this module keeps the declaration honest.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/tenant-storage.json"
# Durable Object SQLite list prices at price_as_of: 1 M requests included then 0.15 per M; 25 B reads and 50 M writes included.
INCLUDED = {"requests": 1_000_000, "reads": 25_000_000_000, "writes": 50_000_000}
PER_MILLION = {"requests": 0.15, "reads": 0.001, "writes": 1.0}


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def worst_case(c: dict) -> float:
    n, m = len(c["tenants"]), c["default_budget"]["month"]
    total = c["plan_base_usd"]
    for k in ("requests", "reads", "writes"):
        total += max(0, n * m[k] - INCLUDED[k]) / 1e6 * PER_MILLION[k]
    return round(total, 2)


def check(root=REPO) -> list[str]:
    c, errs = load(root), []
    for k in ("decision", "monthly_ceiling_usd", "default_budget", "tenants", "migration", "price_as_of"):
        if k not in c:
            errs.append("missing " + k)
    if errs:
        return errs
    ids = [s["id"] for s in c["migration"]["steps"]]
    if ids != sorted(set(ids)) or not ids:
        errs.append("migration steps must be unique and ordered")
    for s in c["migration"]["steps"]:
        for f in ("action", "probe", "owner"):
            if not s.get(f):
                errs.append(f"step {s.get('id')} lacks {f}")
    if worst_case(c) > c["monthly_ceiling_usd"]:
        errs.append(f"worst case {worst_case(c)} USD exceeds ceiling {c['monthly_ceiling_usd']} USD")
    return errs


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "tenant storage declaration ok"); return 1 if e else 0
    if "--worst" in a:
        print(worst_case(load())); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

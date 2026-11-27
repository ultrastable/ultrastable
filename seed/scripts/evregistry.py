#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ESSENTIAL-VARIABLES-1: the essential-variable registry (Ashby step 2, issue 2620).

autonomy/essential-variables.json names each essential variable, the goal that reads it and its limit. This check holds it to the
goal tree the tick runs: every row's goal exists with the same metric, operator and target, and control.essential in goals.json is
exactly this list, so the goals step reads them first and holds other knobs while one is out (PEREZ-LOPEZ-1). breached() treats a
missing reading as outside its limit.

  python3 scripts/evregistry.py --check
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OPS = {"<=": lambda v, t: v <= t, ">=": lambda v, t: v >= t, "==": lambda v, t: v == t, "<": lambda v, t: v < t, ">": lambda v, t: v > t}


def load(root=ROOT):
    reg = json.loads((root / "autonomy/essential-variables.json").read_text("utf-8"))["variables"]
    goals = json.loads((root / "autonomy/goals.json").read_text("utf-8"))
    return reg, goals


def breached(reg, readings):
    """readings {ev id: value or None}. The ids outside their limits; a missing reading is a breach."""
    return sorted(r["id"] for r in reg if readings.get(r["id"]) is None or not OPS[r["op"]](readings[r["id"]], r["limit"]))


def check(root=ROOT):
    reg, goals = load(root)
    by = {g["id"]: g for g in goals.get("goals", [])}
    errs = []
    for r in reg:
        g = by.get(r["goal"])
        if not g:
            errs.append(f"{r['id']}: goal {r['goal']} is not in goals.json"); continue
        if (g.get("spec"), g.get("op"), g.get("target")) != (r["metric"], r["op"], r["limit"]):
            errs.append(f"{r['id']}: goal {r['goal']} reads {g.get('spec')} {g.get('op')} {g.get('target')}, the registry says {r['metric']} {r['op']} {r['limit']}")
    ess = sorted((goals.get("control") or {}).get("essential") or [])
    if ess != sorted(r["goal"] for r in reg):
        errs.append(f"control.essential in goals.json {ess} differs from the registry {sorted(r['goal'] for r in reg)}")
    if len({r["id"] for r in reg}) != len(reg):
        errs.append("duplicate variable id")
    probe = {r["id"]: None for r in reg}
    if breached(reg, probe) != sorted(probe):
        errs.append("a missing reading was not read as a breach")
    return errs


def main(argv):
    e = check()
    print("\n".join(e) or f"evregistry ok: {len(load()[0])} essential variables, each bound to its goal")
    return 1 if e and "--check" in argv else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

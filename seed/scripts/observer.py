#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OBSERVER-PROBE-1 (Ashby step 11, issue 2620): disturb one part at a time and time how long the whole takes to settle again.

The probe runs on the reference homeostat (scripts/homeostat.py), not on production: two blocks of two units, adapted to stability,
then one block's couplings are set to strong positive feedback and the steps until every unit has been inside its limits for t_stable steps are counted.
A part that never settles inside the budget reads as None (unmeasured), never as fast. The reading per part is what the second
loop's own restabilization time is compared against.

  python3 scripts/observer.py --check     every part settles and the drills hold
  python3 scripts/observer.py --report    time to restabilize per part as JSON
"""
import json, random, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import homeostat as h

PARTS = {"A": (0, 1), "B": (2, 3)}
BUDGET = 20000


def restabilize(part, trials=10, seed=17, join=0.05):
    """Median steps to settle after part's couplings are set to positive feedback; None when a majority never settled."""
    n = 4
    mask = [[(i in PARTS["A"]) == (j in PARTS["A"]) for j in range(n)] for i in range(n)]
    times = []
    for t in range(trials):
        rng = random.Random(seed * 1000 + t)
        w = h.matrix(rng, n, mask)
        for i in range(n):
            for j in range(n):
                if not mask[i][j]:
                    w[i][j] = join
        r, w, x = h.run(w, rng, budget=BUDGET, mask=mask)
        if not r["stable"]:
            continue
        for i in PARTS[part]:  # the disturbance: the part's own couplings become strong positive feedback, so it must re-draw to settle
            w[i] = [(1.0 if mask[i][j] else v) for j, v in enumerate(w[i])]
            x[i] = 0.9 * h.L
        r2, _, _ = h.run(w, rng, x=x, budget=BUDGET, mask=mask, rows=PARTS[part])
        times.append(r2["steps"] if r2["stable"] else None)
    ok = sorted(s for s in times if s is not None)
    if not times or len(ok) * 2 <= len(times):
        return None
    return ok[len(ok) // 2]


def report():
    return {p: restabilize(p) for p in PARTS}


def check():
    r = report()
    errs = [f"part {p} did not settle after a disturbance" for p, v in r.items() if v is None]
    errs += [f"part {p} reads {v} steps, so the disturbance never left the limits" for p, v in r.items() if v is not None and v <= h.T_STABLE]
    return errs, r


def main(argv):
    errs, r = check()
    print(json.dumps({"restabilize_steps": r, "failed": errs}, indent=1))
    return 1 if errs and "--check" in argv else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""HOMEOSTAT-1: a seeded reference homeostat, the test harness the second loop is calibrated against.

N units with dx_i/dt = -k*x_i + sum_j w_ij*x_j (Euler, dt 0.01). The essential variable is |x_i| <= L. Each unit owns its
row of weights; when its needle leaves the limits it re-draws that row from a 25-position table in [-1, 1] and is clamped
back to +-L (the uniselector). "joined" mode re-draws every row on any breach, which is Ashby's fully-joined system.
Stable means every |x_i| <= L for t_stable steps in a row. Pure functions, no I/O, the same seed gives the same run.

  python3 scripts/homeostat.py --check     run the property drills and fail on any that does not hold
  python3 scripts/homeostat.py --report    print the readings as JSON
"""
import json, random, sys

TABLE = [-1 + 2 * i / 24 for i in range(25)]
K, DT, L, T_STABLE = 1.0, 0.01, 1.0, 500


def draw_row(rng, n, i, mask=None):
    return [rng.choice(TABLE) if (mask is None or mask[i][j]) else 0.0 for j in range(n)]


def matrix(rng, n, mask=None):
    return [draw_row(rng, n, i, mask) for i in range(n)]


def run(w, rng, x=None, mode="local", budget=20000, mask=None, rows=None):
    """Advance until stable or out of budget. rows limits which units may re-draw. Returns the reading and the new weights."""
    n = len(w)
    w = [r[:] for r in w]
    x = list(x) if x else [rng.uniform(-L, L) for _ in range(n)]
    rows = set(range(n)) if rows is None else set(rows)
    calm, redraws = 0, 0
    for step in range(budget):
        x = [x[i] + DT * (-K * x[i] + sum(w[i][j] * x[j] for j in range(n))) for i in range(n)]
        out = [i for i in range(n) if abs(x[i]) > L]
        if not out:
            calm += 1
            if calm >= T_STABLE:
                return {"stable": True, "steps": step + 1, "redraws": redraws}, w, x
            continue
        calm = 0
        hit = range(n) if mode == "joined" else out
        for i in hit:
            if i in rows:
                w[i] = draw_row(rng, n, i, mask)
                redraws += 1
            x[i] = max(-L, min(L, x[i]))
    return {"stable": False, "steps": budget, "redraws": redraws}, w, x


def stable_share(n, mode, trials, seed, budget):
    ok = 0
    for t in range(trials):
        rng = random.Random(seed * 1000 + t)
        r, _, _ = run(matrix(rng, n), rng, mode=mode, budget=budget)
        ok += r["stable"]
    return ok / trials


def inversion(n=4, trials=20, seed=7, budget=20000):
    """Ashby's reversed unit: after stability, flip one coupling's sign; the system must find stability again."""
    ok = 0
    for t in range(trials):
        rng = random.Random(seed * 1000 + t)
        r, w, x = run(matrix(rng, n), rng, budget=budget)
        if not r["stable"]:
            continue
        w[0][1] = -w[0][1] if w[0][1] else 1.0
        r2, _, _ = run(w, rng, x=[L * 0.9] * n, budget=budget)
        ok += r2["stable"]
    return ok / trials


def retention(trials=20, seed=11, budget=20000, join=0.05):
    """Two blocks of two units with weak fixed joins. Adapt A, then let only B re-draw after a disturbance to B.
    Retained = A was stable before and no A unit left its limits during B's adaptation."""
    n, a, b = 4, (0, 1), (2, 3)
    mask = [[(i in a) == (j in a) for j in range(n)] for i in range(n)]
    kept, base = 0, 0
    for t in range(trials):
        rng = random.Random(seed * 1000 + t)
        w = matrix(rng, n, mask)
        for i in range(n):
            for j in range(n):
                if not mask[i][j]:
                    w[i][j] = join
        r, w, x = run(w, rng, mode="local", budget=budget, mask=mask)
        if not r["stable"]:
            continue
        base += 1
        for i in b:
            w[i] = [(-v if mask[i][j] else v) for j, v in enumerate(w[i])]
        r2, w2, x2 = run(w, rng, x=x, budget=budget, mask=mask, rows=b)
        a_ok = all(abs(x2[i]) <= L for i in a) and w2[0] == w[0] and w2[1] == w[1]
        kept += a_ok and r2["stable"]
    return kept / base if base else 0.0


def readings(quick=True):
    trials = 12 if quick else 100
    return {
        "local_stable_share_n4": stable_share(4, "local", trials, 1, 20000),
        "local_stable_share_n4_small_budget": stable_share(4, "local", trials, 1, 600),
        "local_stable_share_n12": stable_share(12, "local", trials, 3, 1500),
        "joined_stable_share_n12": stable_share(12, "joined", trials, 3, 1500),
        "inversion_restable_share": inversion(trials=trials),
        "retention_share": retention(trials=trials),
    }


DRILLS = [
    ("termination: more budget, more stable runs", lambda r: r["local_stable_share_n4"] >= r["local_stable_share_n4_small_budget"] and r["local_stable_share_n4"] >= 0.9),
    ("scaling: local re-draw beats fully-joined at n=12", lambda r: r["local_stable_share_n12"] > r["joined_stable_share_n12"]),
    ("inversion: a reversed coupling restabilizes", lambda r: r["inversion_restable_share"] >= 0.9),
    ("retention: adapting B keeps A", lambda r: r["retention_share"] >= 0.95),
]


def main(argv):
    r = readings(quick="--full" not in argv)
    if "--check" in argv:
        bad = [name for name, ok in DRILLS if not ok(r)]
        print(json.dumps({"readings": r, "failed": bad}, indent=1))
        return 1 if bad else 0
    print(json.dumps(r, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

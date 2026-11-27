#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PEREZ-LOPEZ-1: the doctrine guard from Juan A. Perez Lopez, "Organizational Theory: A Cybernetic Approach" (IESE WP 5, 1974).

Each rule here is one idea from the paper, written as a pure function so a loop can call it and a test can hold it:

  admit()             two goals, ranked: no action that helps the objective may push an essential variable out of limits
  evaluate()          three values per action: effectiveness (predicted), efficiency (learned), consistency (its trend)
  retire()            an ultrastable system drops actions whose efficiency keeps falling (5 windows by default)
  negative_learning() experience is not wisdom: flag a policy whose objective rises while its actions' efficiency falls
  failure_recall()    "pride": past failures must stay in the evoked set when the same action class comes up again
  minimum_org()       the smallest organization is two coupled ultrastable systems, each with its own essential variables
  no_scalar_score()   any single number is a purpose: objectives stay a vector unless doctrine declares the weights

  python3 scripts/perezlopez.py --check    run the rule drills and fail on any that does not hold
"""
import json, sys

RETIRE_WINDOWS = 5


def in_limits(value, lo, hi):
    return value is not None and lo <= value <= hi  # a missing reading is a breach


def admit(predicted_evs, limits):
    """predicted_evs {ev: value after the action}; limits {ev: (lo, hi)}. Returns (ok, breached evs)."""
    bad = sorted(ev for ev, (lo, hi) in limits.items() if not in_limits(predicted_evs.get(ev), lo, hi))
    return (not bad, bad)


def _slope(xs):
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = (n - 1) / 2, sum(xs) / n
    return sum((i - mx) * (y - my) for i, y in enumerate(xs)) / sum((i - mx) ** 2 for i in range(n))


def evaluate(history):
    """history: list of {effectiveness, efficiency} per window, oldest first, for one action class."""
    eff = [h["efficiency"] for h in history]
    return {
        "effectiveness": history[-1]["effectiveness"] if history else None,
        "efficiency": eff[-1] if eff else None,
        "consistency": _slope(eff),
    }


def retire(history, windows=RETIRE_WINDOWS):
    """True when efficiency fell in each of the last `windows` windows."""
    eff = [h["efficiency"] for h in history]
    if len(eff) < windows + 1:
        return False
    tail = eff[-(windows + 1):]
    return all(b < a for a, b in zip(tail, tail[1:]))


def negative_learning(objective_series, efficiency_series):
    return _slope(objective_series) > 0 and _slope(efficiency_series) < 0


def failure_recall(rollbacks, retrieve):
    """rollbacks: [{action_class, id}]; retrieve(action_class) -> ids in context. Share of past failures recalled."""
    if not rollbacks:
        return None  # unmeasured, never a pass
    hit = sum(1 for r in rollbacks if r["id"] in set(retrieve(r["action_class"])))
    return hit / len(rollbacks)


def minimum_org(partitions, couplings):
    """partitions {id: [ev ids]}; couplings [(src, dst)]. Two partitions, separate EVs, at least one coupling between them."""
    ids = [p for p, evs in partitions.items() if evs]
    if len(ids) < 2:
        return False
    sets = [set(partitions[p]) for p in ids]
    separate = all(not (a & b) for i, a in enumerate(sets) for b in sets[i + 1:])
    coupled = any(s in ids and d in ids and s != d for s, d in couplings)
    return separate and coupled


def no_scalar_score(objectives):
    """objectives: list of {name, weight?}. A single objective, or weights not declared on every one, is refused."""
    if len(objectives) < 2:
        return False
    w = [o.get("weight") for o in objectives]
    return all(x is None for x in w) or all(x is not None for x in w)


def drills():
    limits = {"cost": (0, 5), "silent_drops": (0, 0)}
    falling = [{"effectiveness": 1, "efficiency": 1 - i * 0.1} for i in range(6)]
    steady = [{"effectiveness": 1, "efficiency": 0.8} for _ in range(6)]
    return {
        "admit refuses an ev breach": admit({"cost": 7, "silent_drops": 0}, limits) == (False, ["cost"]),
        "admit refuses a missing reading": admit({"cost": 1}, limits)[0] is False,
        "admit allows in-limit action": admit({"cost": 1, "silent_drops": 0}, limits) == (True, []),
        "falling efficiency retires": retire(falling) and not retire(steady),
        "consistency is the efficiency trend": evaluate(falling)["consistency"] < 0 == evaluate(steady)["consistency"],
        "negative learning flagged": negative_learning([1, 2, 3], [0.9, 0.7, 0.5]) and not negative_learning([1, 2, 3], [0.5, 0.6, 0.7]),
        "failure recall measures pride": failure_recall([{"action_class": "a", "id": 1}, {"action_class": "a", "id": 2}], lambda c: [1]) == 0.5,
        "no rollbacks is unmeasured": failure_recall([], lambda c: []) is None,
        "minimum organization": minimum_org({"a": ["e1"], "b": ["e2"]}, [("a", "b")]) and not minimum_org({"a": ["e1"], "b": ["e1"]}, [("a", "b")]),
        "no single score": no_scalar_score([{"name": "x"}, {"name": "y"}]) and not no_scalar_score([{"name": "x"}]),
    }


def main(argv):
    d = drills()
    bad = [k for k, ok in d.items() if not ok]
    print(json.dumps({"drills": len(d), "failed": bad}, indent=1))
    return 1 if bad and "--check" in argv else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

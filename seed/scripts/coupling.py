#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COUPLING-GUARD-1 (Ashby step 7, issue 2620): connectance stays low so the parts can adapt one at a time.

Ashby: a system of n parts settles in a time that grows with how many parts must come right together, so the coupling between
parts must stay sparse. Connectance is the share of goal pairs joined by an edge: a knob declared on several goals, or a recorded
interference (a step on one goal that knocked another out of its limits; goal_interference in the tick Worker). Over the limit,
the guard refuses a new coupling.

  python3 scripts/coupling.py --check    the kit's goal tree is under the limit and the drills hold
"""
import itertools, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIMIT = 0.10


def connectance(goals, edges):
    """goals: ids; edges: pairs of goal ids. Share of distinct unordered pairs that are joined."""
    ids = sorted(set(goals))
    pairs = len(ids) * (len(ids) - 1) // 2
    if not pairs:
        return 0.0
    joined = {tuple(sorted(e)) for e in edges if e[0] != e[1] and e[0] in ids and e[1] in ids}
    return len(joined) / pairs


def edges_of(goal_tree):
    """Pairs joined by a knob that names more than one goal (goal_id plus optional also: [...])."""
    out = []
    for k in goal_tree.get("knobs", []):
        gs = [k["goal_id"], *k.get("also", [])]
        out += list(itertools.combinations(gs, 2))
    return out


def admit(goals, edges, new_edge, limit=LIMIT):
    """True when adding new_edge keeps connectance at or under the limit."""
    return connectance(goals, [*edges, new_edge]) <= limit


def drills():
    g = [f"g{i}" for i in range(6)]  # 15 pairs
    return {
        "no edges is zero": connectance(g, []) == 0.0,
        "one edge in fifteen pairs": abs(connectance(g, [("g0", "g1")]) - 1 / 15) < 1e-9,
        "duplicate and reversed edges count once": connectance(g, [("g0", "g1"), ("g1", "g0")]) == connectance(g, [("g0", "g1")]),
        "a second edge passes 0.10 and is refused": admit(g, [("g0", "g1")], ("g2", "g3")) is False,
        "first edge admitted": admit(g, [], ("g0", "g1")) is True,
    }


def check(root=ROOT):
    tree = json.loads((root / "autonomy/goals.json").read_text("utf-8"))
    ids = [x["id"] for x in tree.get("goals", []) if x.get("level") == "target"]
    c = connectance(ids, edges_of(tree))
    errs = [f"drill failed: {k}" for k, ok in drills().items() if not ok]
    if c > LIMIT:
        errs.append(f"connectance {c:.3f} of the goal tree is over the limit {LIMIT}")
    return errs, c


def main(argv):
    errs, c = check()
    print("\n".join(errs) or f"coupling ok: connectance {c:.3f}, limit {LIMIT}")
    return 1 if errs and "--check" in argv else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

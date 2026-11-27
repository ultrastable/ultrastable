#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""WORLD-MODEL-1 (Ashby step 8, issue 2620): the second loop learns which steps work and chooses by that, with some exploration.

Each step the system takes carries a prediction that is scored later (score_predictions in the tick). calibrate() turns the scored
history into a hit rate per action class, with a prior so a class tried twice is not trusted like one tried fifty times. select()
takes the class with the best calibrated rate, except with probability epsilon a random class, so a class that once failed is still
tried again sometimes (a pure greedy chooser stops learning). An action class with no scored history is unmeasured, never zero.

  python3 scripts/worldmodel.py --check
"""
import json, random, sys

PRIOR_HITS, PRIOR_N = 1, 2  # Laplace prior: an untried class reads 0.5
EPSILON = 0.1


def calibrate(scored):
    """scored: [{action_class, hit: bool}]. {class: {n, hits, rate}} with the prior folded into rate."""
    out = {}
    for s in scored:
        c = out.setdefault(s["action_class"], {"n": 0, "hits": 0})
        c["n"] += 1
        c["hits"] += 1 if s["hit"] else 0
    for c in out.values():
        c["rate"] = (c["hits"] + PRIOR_HITS) / (c["n"] + PRIOR_N)
    return out


def select(classes, model, rng, epsilon=EPSILON):
    """classes: candidate action classes. Explore with probability epsilon, else take the best calibrated rate (untried = prior)."""
    if not classes:
        return None
    if rng.random() < epsilon:
        return rng.choice(sorted(classes))
    prior = PRIOR_HITS / PRIOR_N
    return max(sorted(classes), key=lambda c: model.get(c, {}).get("rate", prior))


def brier(scored_probs):
    """[(p, hit)] mean squared error of stated probabilities; None when nothing was scored."""
    if not scored_probs:
        return None
    return sum((p - (1 if h else 0)) ** 2 for p, h in scored_probs) / len(scored_probs)


def drills():
    hist = [{"action_class": "a", "hit": True}] * 8 + [{"action_class": "a", "hit": False}] * 2 + [{"action_class": "b", "hit": False}] * 5
    m = calibrate(hist)
    rng = random.Random(3)
    picks = [select(["a", "b"], m, rng) for _ in range(2000)]
    share_b = picks.count("b") / len(picks)
    return {
        "rate folds in the prior": abs(m["a"]["rate"] - 9 / 12) < 1e-9 and abs(m["b"]["rate"] - 1 / 7) < 1e-9,
        "greedy takes the better class": select(["a", "b"], m, random.Random(0), epsilon=0) == "a",
        "exploration still tries the worse class": 0.02 < share_b < 0.1,
        "untried class reads the prior": select(["b", "c"], m, random.Random(0), epsilon=0) == "c",
        "no scores is unmeasured": brier([]) is None,
        "brier of perfect calls is zero": brier([(1.0, True), (0.0, False)]) == 0.0,
    }


def main(argv):
    d = drills()
    bad = [k for k, ok in d.items() if not ok]
    print(json.dumps({"drills": len(d), "failed": bad}, indent=1))
    return 1 if bad and "--check" in argv else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

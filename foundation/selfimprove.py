"""SELF-IMPROVE-1 as code. Ultrastable is the foundation for any autonomous system.

One algorithm every worker runs to keep improving: sense signals, rank the weighted gaps, choose one lever (with exploration), predict, apply,
verify after a window, keep or revert. lifecycle.py handles the loop-failure signal; this module is the general ranker and the verdict rule.

  python3 -m foundation selfimprove --check       doctrine file complete, every signal has a real source and code consumer
  python3 -m foundation selfimprove --rank FILE   rank candidate levers from a JSON list of {loop, signal, value, tries, weight?}

Data: doctrine/self-improvement.json.
"""
from __future__ import annotations
import json, math, random, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/self-improvement.json"
STEPS = ("SENSE", "GAP", "RANK", "CHOOSE", "PREDICT", "APPLY", "VERIFY", "DECIDE", "RECORD", "SELF")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def gap(value: float, target: float, better: str) -> float:
    """Normalised distance to target, 0 when met. Targets of 0 normalise against 1."""
    scale = abs(target) or 1.0
    d = (target - value) if better == "higher" else (value - target)
    return max(0.0, d) / scale


def rank(cands: list, d: dict | None = None) -> list:
    """Candidates sorted by priority = gap * weight * (1 + explore_c / sqrt(1 + tries)); retired levers are dropped."""
    d = d or load()
    sig, p = {s["id"]: s for s in d["signals"]}, d["params"]
    out = []
    for c in cands:
        s = sig[c["signal"]]
        if c.get("retired"):
            continue
        g = gap(c["value"], s["target"], s["better"])
        pr = g * c.get("weight", s["weight"]) * (1 + p["explore_c"] / math.sqrt(1 + c.get("tries", 0)))
        if g > 0:
            out.append({**c, "gap": round(g, 4), "priority": round(pr, 4)})
    return sorted(out, key=lambda r: -r["priority"])


def provenance_candidates(root=REPO) -> list:
    """PROVENANCE-1 feeds the ranker: the kept rate of settled changes per (origin, actor, area) becomes a change-effect candidate; levers the record says to retire
    are marked retired so rank() drops them, and reinforced ones carry a heavier weight."""
    from . import provenance
    sig = next(s for s in load(root)["signals"] if s["id"] == "change-effect")
    out = []
    for l in provenance.lessons(root):
        if l["kept_rate"] is None:
            continue
        out.append({"loop": f"{l['origin']}:{l['actor']}:{l['area']}", "signal": "change-effect", "value": l["kept_rate"], "tries": l["kept"] + l["reverted"],
                    "retired": l["verdict"] == "retire", "weight": sig["weight"] * (1.25 if l["verdict"] == "reinforce" else 1.0)})
    return out


def choose(ranked: list, d: dict | None = None, rng=random) -> dict | None:
    """Top candidate, or with probability explore_epsilon one of the top explore_pool (escape a local optimum)."""
    d = d or load()
    if not ranked:
        return None
    p = d["params"]
    if rng.random() < p["explore_epsilon"]:
        return rng.choice(ranked[:p["explore_pool"]])
    return ranked[0]


def verdict(pred: dict, after: float, guards_before: dict, guards_after: dict, d: dict | None = None) -> dict:
    """Keep only when the target moved by min_effect and no guard worsened by more than guard_tolerance (all guards are higher-is-better)."""
    p = (d or load())["params"]
    base, tgt = pred["baseline"], pred["target"]
    moved = (after - base) / (abs(tgt - base) or 1.0)
    worse = sorted(g for g in guards_before if guards_before[g] - guards_after.get(g, 0) > p["guard_tolerance"])
    keep = moved >= p["min_effect"] and not worse
    return {"keep": keep, "moved": round(moved, 4), "guards_worse": worse, "action": "keep" if keep else "OL-REVERT"}


def check(root=REPO) -> list:
    root, bad = Path(root), []
    d = load(root)
    text = " ".join(d["algorithm"])
    for s in STEPS:
        if s + ":" not in text:
            bad.append(f"algorithm lacks step {s}")
    if d["marker"] not in d["axiom"]:
        bad.append("axiom lacks its marker")
    if not d["guards"]:
        bad.append("no guards: a gain with no guard is a regression waiting")
    ids = [s["id"] for s in d["signals"]]
    for s in d["signals"]:
        if ids.count(s["id"]) > 1:
            bad.append(f"signal {s['id']} defined twice")
        for f in ("class", "source", "consumer", "better", "target", "weight"):
            if f not in s:
                bad.append(f"signal {s['id']}: lacks {f}")
        if s.get("better") not in ("higher", "lower"):
            bad.append(f"signal {s['id']}: better must be higher or lower")
        for f in ("source", "consumer"):
            if s.get(f) and not (root / s[f]).exists():
                bad.append(f"signal {s['id']}: {f} {s[f]} does not exist (no source, no signal)")
    return bad


def main(argv: list) -> int:
    if argv[:1] == ["--sense-provenance"]:
        print(json.dumps(rank(provenance_candidates(REPO)), indent=1))
        return 0
    if argv[:1] == ["--rank"] and len(argv) > 1:
        print(json.dumps(rank(json.loads(Path(argv[1]).read_text(encoding="utf-8"))), indent=1))
        return 0
    bad = check(REPO)
    print("\n".join(bad) or "selfimprove ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Every goal is measured, dated and has a knob, as code (GOALS-1, Rowan 2026-11-18). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation goalscheck --check    each target in seed/autonomy/goals.json has a measured variable, a numeric target,
                                              a deadline and at least one knob with sane bounds; a target with no knob is allowed
                                              only while listed in doctrine/goals-baseline.json (shrink-only)

The controller is seed/worker/src/goals.js (tick step goals). Consumers: .github/workflows/checks.yml, doctrine/rules.json
(every-goal-has-knob), tests/foundation/test_goalscheck.py. Never widen the baseline to pass; attach a knob instead.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GOALS, BASE = "seed/autonomy/goals.json", "doctrine/goals-baseline.json"


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    try:
        g, base = _j(root, GOALS), _j(root, BASE)
    except (OSError, ValueError) as e:
        return [f"goals data unreadable: {e}"]
    allow = set(base.get("no_knob", []))
    knobs = {}
    for k in g.get("knobs", []):
        knobs.setdefault(k.get("goal_id"), []).append(k)
        if not (k.get("min", 0) <= k.get("value", -1) <= k.get("max", -2)):
            bad.append(f"knob {k.get('id')}: value outside its bounds")
        if not k.get("step") or k.get("step") <= 0 or k.get("effect") not in (1, -1) or not k.get("cooldown_h") or not k.get("review_h"):
            bad.append(f"knob {k.get('id')}: needs a positive step, effect +1/-1, cooldown_h and review_h")
    ids = {x["id"] for x in g.get("goals", [])}
    bad += [f"knob {k.get('id')}: goal {k.get('goal_id')} does not exist" for ks in knobs.values() for k in ks if k.get("goal_id") not in ids]
    targets = [x for x in g.get("goals", []) if x.get("level") == "target"]
    for t in targets:
        i = t["id"]
        if t.get("source") not in ("builtin", "metric") or not t.get("spec"):
            bad.append(f"{i}: no measured variable (source builtin|metric and a spec)")
        if t.get("op") not in (">=", "<=", ">", "<", "==") or not isinstance(t.get("target"), (int, float)):
            bad.append(f"{i}: needs an op and a numeric target")
        if not re.fullmatch(r"\d{4}-\d\d-\d\d(T[\d:.]+Z)?", str(t.get("deadline") or "")):
            bad.append(f"{i}: needs a deadline (YYYY-MM-DD)")
        if not knobs.get(i) and i not in allow:
            bad.append(f"{i}: no knob attached and not in {BASE}")
    bad += [f"{BASE}: {i} now has a knob or is gone; remove it from no_knob (shrink-only)" for i in sorted(allow)
            if knobs.get(i) or i not in {t["id"] for t in targets}]
    return bad


def main(argv=None) -> int:
    bad = check(REPO)
    print("goalscheck ok" if not bad else "\n".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

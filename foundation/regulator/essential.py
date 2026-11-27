# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""P3 Ultrastability: essential variables with bounds; step-change ONLY on breach.

Ashby's slow loop: the fast loop (the coding agent) runs freely while every variable
is in bounds. A breach (or a missing reading, which counts as out of bounds) fires
exactly one step-change drawn from a finite menu, logged with a pre-registered
prediction so the slow loop (P6) can score it later.
"""
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class EssentialVariable:
    name: str
    lo: float = float("-inf")
    hi: float = float("inf")
    scope: str = "global"
    owner_write_protected: bool = False  # agent must not be able to write this reading (anti-Goodhart)


# Finite, ordered menu of step-changes per variable family; first untried one fires.
DEFAULT_MENU = ["swap_prompt_variant", "add_tool", "split_module", "escalate_model", "call_human"]


class Registry:
    def __init__(self, store, variables, menu=None):
        self.s, self.vars = store, {(v.scope, v.name): v for v in variables}
        self.menu = menu or DEFAULT_MENU

    def record(self, scope, name, value):
        self.s.db.execute("INSERT INTO ev_reading(ts,scope,name,value) VALUES(?,?,?,?)",
                          (time.time(), scope, name, value))
        self.s.db.commit()

    def latest(self, scope, name):
        r = self.s.db.execute(
            "SELECT value FROM ev_reading WHERE scope=? AND name=? ORDER BY id DESC LIMIT 1",
            (scope, name)).fetchone()
        return None if r is None else r["value"]

    def breaches(self):
        out = []
        for (scope, name), v in sorted(self.vars.items()):
            val = self.latest(scope, name)
            if val is None:
                out.append((v, None, "missing"))  # missing reading counts as out
            elif val < v.lo or val > v.hi:
                out.append((v, val, "out_of_bounds"))
        return out

    def _tried(self, scope, ev):
        return {r["action"] for r in self.s.db.execute(
            "SELECT action FROM step_change WHERE scope=? AND ev=? AND (outcome IS NULL OR outcome!='restored')",
            (scope, ev))}

    def step(self):
        """Evaluate once. In-bounds => no-op (returns []). Breach => one logged step-change each."""
        fired = []
        for v, val, why in self.breaches():
            tried = self._tried(v.scope, v.name)
            action = next((a for a in self.menu if a not in tried), self.menu[-1])
            if action == self.menu[-1] and action in {r["action"] for r in self.s.db.execute(
                    "SELECT action FROM step_change WHERE scope=? AND ev=? AND outcome IS NULL", (v.scope, v.name))}:
                continue  # menu exhausted and the last step is still pending: one open escalation, not one per tick
            pred = f"{v.name} returns within [{v.lo},{v.hi}] after {action}"
            self.s.db.execute(
                "INSERT INTO step_change(ts,scope,ev,action,prediction,outcome) VALUES(?,?,?,?,?,NULL)",
                (time.time(), v.scope, v.name, action, pred))
            fired.append({"scope": v.scope, "ev": v.name, "value": val, "why": why,
                          "action": action, "prediction": pred})
        self.s.db.commit()
        return fired

    def resolve(self, scope, ev):
        """Score pending step-changes: restored iff the variable is back in bounds."""
        v = self.vars[(scope, ev)]
        val = self.latest(scope, ev)
        ok = val is not None and v.lo <= val <= v.hi
        self.s.db.execute(
            "UPDATE step_change SET outcome=? WHERE scope=? AND ev=? AND outcome IS NULL",
            ("restored" if ok else "failed", scope, ev))
        self.s.db.commit()
        return ok

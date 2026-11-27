# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""P10 Pérez López guard: track efficiency per action class, retire classes that keep falling.

effectiveness = task completed (what the agent is rewarded for).
efficiency    = delta in codebase-health essential variables attributable to the change.
An action class whose effectiveness rises while efficiency falls is negative learning.
Rule (mirrors ultrastable PR #2625): retire after N consecutive falling windows.
"""
import time


class ActionLedger:
    def __init__(self, store, retire_after=5):
        self.s, self.n = store, retire_after

    def record(self, action_class, window, effectiveness, efficiency):
        self.s.db.execute(
            "INSERT INTO action_outcome(ts,action_class,window,effectiveness,efficiency) VALUES(?,?,?,?,?)",
            (time.time(), action_class, window, effectiveness, efficiency))
        self.s.db.commit()

    def _series(self, action_class):
        return [(r["effectiveness"], r["efficiency"]) for r in self.s.db.execute(
            "SELECT effectiveness, efficiency FROM action_outcome WHERE action_class=? ORDER BY window",
            (action_class,))]

    def consecutive_falling(self, action_class):
        ser, run = self._series(action_class), 0
        for (_, e0), (_, e1) in zip(ser, ser[1:]):
            run = run + 1 if e1 < e0 else 0
        return run

    def negative_learning(self, action_class):
        ser = self._series(action_class)
        if len(ser) < 2:
            return False
        return ser[-1][0] > ser[0][0] and ser[-1][1] < ser[0][1]

    def retired(self):
        classes = [r["action_class"] for r in self.s.db.execute(
            "SELECT DISTINCT action_class FROM action_outcome")]
        return sorted(c for c in classes if self.consecutive_falling(c) >= self.n)

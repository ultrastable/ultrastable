# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# Ultrastable is the foundation for any autonomous system.
import json, shutil, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _repo  # noqa: E402
from foundation import goalscheck as gc

ROOT = Path(__file__).resolve().parents[2]


class GoalsCheck(unittest.TestCase):
    def tree(self):
        t = _repo.scratch(); (t / "seed/autonomy").mkdir(parents=True); (t / "doctrine").mkdir()
        shutil.copy(ROOT / gc.GOALS, t / gc.GOALS); shutil.copy(ROOT / gc.BASE, t / gc.BASE)
        return t

    def test_repo_is_clean(self):
        self.assertEqual(gc.check(ROOT), [])

    def test_missing_deadline_and_knob_fail(self):
        t = self.tree(); g = json.loads((t / gc.GOALS).read_text())
        for x in g["goals"]:
            if x["id"] == "core.cost.peak":
                del x["deadline"]
        g["knobs"] = [k for k in g["knobs"] if k["goal_id"] != "core.cost.peak"]
        (t / gc.GOALS).write_text(json.dumps(g))
        bad = gc.check(t)
        self.assertTrue(any("deadline" in b for b in bad) and any("no knob" in b for b in bad))

    def test_baseline_only_shrinks(self):
        t = self.tree(); b = json.loads((t / gc.BASE).read_text()); b["no_knob"].append("core.cost.peak")
        (t / gc.BASE).write_text(json.dumps(b))
        self.assertTrue(any("shrink-only" in x for x in gc.check(t)))


if __name__ == "__main__":
    unittest.main()

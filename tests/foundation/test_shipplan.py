# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""SHIP-PLAN-1: unfinished work is a record; an entry lands when its marker files exist, and --check fails until all have."""
import sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import shipplan  # noqa: E402

PLAN = {"store": {"repository": "r", "bundle": "b", "slicing": "s", "workflow": "w", "held_adapter": "h"},
        "slices": [{"id": "S1", "markers": ["a.txt"], "title": "first"}, {"id": "S2", "markers": ["b.txt"], "title": "second"}],
        "remaining": [{"id": "R1", "what": "piece", "markers": ["c.txt", "d.txt"]}]}


class Shipplan(unittest.TestCase):
    def test_an_entry_lands_only_when_every_marker_exists(self):
        with tempfile.TemporaryDirectory() as d:
            for n in ("a.txt", "c.txt"): Path(d, n).write_text("x")
            by = {e["id"]: e for e in shipplan.status(Path(d), PLAN)}
        self.assertEqual((by["S1"]["landed"], by["S2"]["landed"], by["R1"]["landed"]), (True, False, False))
        self.assertEqual(by["R1"]["missing"], ["d.txt"])

    def test_the_real_plan_loads_and_every_entry_has_markers(self):
        plan = shipplan.load()
        for e in plan["slices"] + plan["remaining"]:
            self.assertTrue(e["markers"], e["id"])


if __name__ == "__main__":
    unittest.main()

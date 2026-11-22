# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Intent Yield (core feature, docs/intent-yield-design.md): the anti-gaming rules stay in the design."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "docs/intent-yield-design.md"


class IntentYieldTests(unittest.TestCase):
    def test_measure_is_not_a_count_and_never_scores_the_person(self):
        design = DESIGN.read_text(encoding="utf-8").lower()
        self.assertIn("never the person", design)
        self.assertIn("no person is scored", design)
        for banned in ("points", "streaks", "badges", "rankings"):
            self.assertIn(banned, design, "the design must keep the explicit ban on " + banned)
        for guard in ("substance-1", "settle window", "restatement", "unit is the intent", "running unattended for a year"):
            self.assertIn(guard, design)

    def test_it_is_core_not_a_seed(self):
        self.assertFalse((ROOT / "instances/intent-yield").exists())


if __name__ == "__main__":
    unittest.main()

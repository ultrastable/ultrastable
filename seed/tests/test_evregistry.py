# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import evregistry as ev


class EvRegistry(unittest.TestCase):
    def test_kit_registry_matches_goal_tree(self):
        self.assertEqual(ev.check(), [])

    def test_missing_reading_is_a_breach(self):
        reg = [{"id": "a", "op": "<=", "limit": 0}, {"id": "b", "op": ">=", "limit": 1}]
        self.assertEqual(ev.breached(reg, {"a": 0}), ["b"])
        self.assertEqual(ev.breached(reg, {"a": 2, "b": 3}), ["a"])
        self.assertEqual(ev.breached(reg, {"a": 0, "b": 1}), [])


if __name__ == "__main__":
    unittest.main()

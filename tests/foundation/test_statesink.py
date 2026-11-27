# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation import statesink

class StateSink(unittest.TestCase):
    def test_every_state_area_has_a_stage_and_one_canary(self):
        self.assertEqual(statesink.check(), [])

    def test_canary_moves_first_then_stops_when_all_moved(self):
        s = {"areas": {"a": {"stage": "git", "canary": False}, "c": {"stage": "git", "canary": True}}}
        self.assertEqual(statesink.next_move(s), ("c", "dual"))
        s["areas"]["c"]["stage"] = "moved"
        self.assertEqual(statesink.next_move(s), ("a", "dual"))
        s["areas"]["a"]["stage"] = "moved"
        self.assertEqual(statesink.next_move(s), (None, None))

if __name__ == "__main__": unittest.main()

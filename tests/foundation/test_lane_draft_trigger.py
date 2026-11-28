# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""LANE-DRAFT-1: the lane starts on a PR event, because a draft's checks run fails on purpose and the success-only workflow_run trigger never fires for it."""
import re, unittest
from pathlib import Path

LANE = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "lane.yml"


class LaneDraftTrigger(unittest.TestCase):
    def test_pr_events_start_the_lane(self):
        text = LANE.read_text(encoding="utf-8")
        block = re.search(r"^on:\n(.*?)^\S", text, re.S | re.M).group(1)
        m = re.search(r"pull_request:\s*\n\s*types:\s*\[([^\]]*)\]", block)
        self.assertIsNotNone(m, "lane.yml must trigger on pull_request")
        types = {t.strip() for t in m.group(1).split(",")}
        self.assertTrue({"opened", "ready_for_review"} <= types, types)


if __name__ == "__main__":
    unittest.main()

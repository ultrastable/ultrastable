# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

class LiveCount(unittest.TestCase):
    def test_probe_fails_when_live_shows_zero_but_github_merged(self):
        from datetime import datetime, timezone
        from foundation import transparency as t
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        rest = [{"mergedAt": now}]
        self.assertEqual(t.probe_merged(live={"throughput": {"merged": {"total": 0}}}, rest=rest), 1)
        self.assertEqual(t.probe_merged(live={"throughput": {"merged": {"total": 5}}}, rest=rest), 0)


if __name__ == "__main__":
    unittest.main()

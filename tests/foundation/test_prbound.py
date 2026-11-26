# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation import prbound
NOW = 1_800_000_000
def ts(min_ago):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(NOW - min_ago * 60, timezone.utc).isoformat().replace("+00:00", "Z")
def pr(n, created, updated, *labels): return {"number": n, "createdAt": ts(created), "updatedAt": ts(updated), "labels": [{"name": l} for l in labels]}
class Bound(unittest.TestCase):
    def test_closes_past_bound_only(self):
        close, _ = prbound.read([pr(1, 50, 40, "conflict"), pr(2, 20, 10, "conflict"), pr(3, 90, 70, "ci-failed"), pr(4, 90, 50, "ci-failed")], NOW)
        self.assertEqual([n for n, _ in close], [1, 3])
    def test_hold_never_closed_and_stale_counted(self):
        close, stale = prbound.read([pr(5, 600, 400, "conflict", "hold"), pr(6, 180, 1)], NOW)
        self.assertEqual(close, []); self.assertEqual([n for n, _ in stale], [6])
if __name__ == "__main__": unittest.main()

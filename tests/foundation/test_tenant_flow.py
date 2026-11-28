# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLOW-AUDIT-1: idle tenant issues and pull requests are findings; fresh ones and merged work are not."""
import unittest
from datetime import datetime, timedelta, timezone
from foundation import tenant_flow as T

NOW = datetime(2026, 11, 28, 12, tzinfo=timezone.utc)
ago = lambda **k: (NOW - timedelta(**k)).isoformat()


class Flow(unittest.TestCase):
    def test_idle_items_are_findings(self):
        out = T.findings("o/r", [{"number": 1, "title": "old", "created_at": ago(days=2, hours=1), "comments": 3},
                                 {"number": 2, "title": "new", "created_at": ago(hours=2)}],
                         [{"number": 5, "created_at": ago(minutes=90), "draft": True, "head": {"ref": "ccr-x"}, "user": {"type": "User"}},
                          {"number": 6, "created_at": ago(minutes=10), "draft": True, "head": {"ref": "ccr-y"}, "user": {"type": "User"}},
                          {"number": 7, "created_at": ago(minutes=90), "draft": False, "head": {"ref": "f"}, "user": {"type": "User"}},
                          {"number": 8, "created_at": ago(minutes=90), "draft": True, "head": {"ref": "wip"}, "user": {"type": "User"}}], NOW)
        self.assertEqual([x.split(":")[0] for x in out], ["o/r#1", "o/r#5", "o/r#7"])

    def test_nothing_idle_is_clean(self):
        self.assertEqual(T.findings("o/r", [], [], NOW), [])


if __name__ == "__main__":
    unittest.main()

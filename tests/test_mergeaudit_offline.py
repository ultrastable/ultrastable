# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# Replaces tests/test_mergeaudit.py, whose basename duplicated tests/foundation/test_mergeaudit.py (test_rootcause) and which called gh live.
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from foundation.mergeaudit import gate


class MergeAuditOffline(unittest.TestCase):
    def test_gate_reads_the_checks_run_without_network(self):
        self.assertEqual(gate("a", lambda *a: (0, json.dumps(["success"]))), "success")
        self.assertEqual(gate("b", lambda *a: (0, "[]")), "missing")
        self.assertEqual(gate("c", lambda *a: (0, json.dumps(["failure"]))), "failure")
        with self.assertRaises(RuntimeError):  # unreadable is not green
            gate("d", lambda *a: (1, "boom"))


if __name__ == "__main__":
    unittest.main()

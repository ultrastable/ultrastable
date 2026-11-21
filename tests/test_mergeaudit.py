# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation.mergeaudit import gate, merged

class TestMergeAudit(unittest.TestCase):
    def test_gate(self):
        self.assertEqual(gate("head_sha"), "success")

    def test_merged(self):
        self.assertGreater(len(merged()), 0)

if __name__ == "__main__":
    unittest.main()

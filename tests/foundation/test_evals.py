# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation import evals


class ExecutorEvals(unittest.TestCase):
    def test_patch_step_holds_golden_set(self):
        r = evals.run()
        self.assertGreaterEqual(r["cases"], 7)
        self.assertEqual(r["failed"], [], r)


if __name__ == "__main__":
    unittest.main()

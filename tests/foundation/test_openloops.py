# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest

from foundation import openloops


class OpenLoops(unittest.TestCase):
    def test_repo_clean(self):
        self.assertEqual(openloops.check(), [])


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import unittest
from foundation import phasework as pw


class PhasedWork(unittest.TestCase):
    def test_platform_uses_the_kernel_engine_and_passes_its_check(self):
        self.assertEqual(pw.check(pw.REPO / "seed"), [])

    def test_main_check_exit_code(self):
        self.assertEqual(pw.main(["--check"]), 0)

# SPDX-License-Identifier: LicenseRef-Ultrastable
import unittest
from foundation import kernellock

class KernelLock(unittest.TestCase):
    def test_every_live_tenant_has_a_row(self):
        self.assertEqual(kernellock.check(), [])

    def test_status_orders_canary_first_and_reads_pins(self):
        cur = "a" * 40
        rows = kernellock.status(current=cur)
        self.assertTrue(rows[0]["canary"])
        self.assertTrue(all(r["state"] in ("unpinned", "current", "behind") for r in rows))

if __name__ == "__main__": unittest.main()

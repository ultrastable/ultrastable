# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# PEREZ-LOPEZ-1: the doctrine guard rules from Perez Lopez (IESE WP 5, 1974) hold on their drills.
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import perezlopez as p


class PerezLopez(unittest.TestCase):
    def test_drills(self):
        for name, ok in p.drills().items():
            self.assertTrue(ok, name)

    def test_retire_needs_enough_history(self):
        self.assertFalse(p.retire([{"effectiveness": 1, "efficiency": 0.5 - i * 0.1} for i in range(3)]))


if __name__ == "__main__":
    unittest.main()

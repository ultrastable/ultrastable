# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# HOMEOSTAT-1: the reference homeostat holds Ashby's properties (termination, scaling, inversion, retention) on fixed seeds.
import random, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import homeostat as h


class Homeostat(unittest.TestCase):
    def test_same_seed_same_run(self):
        a = h.run(h.matrix(random.Random(5), 4), random.Random(6))[0]
        b = h.run(h.matrix(random.Random(5), 4), random.Random(6))[0]
        self.assertEqual(a, b)

    def test_drills_hold(self):
        r = h.readings()
        for name, ok in h.DRILLS:
            self.assertTrue(ok(r), (name, r))

    def test_no_redraw_while_in_limits(self):
        w = [[0.0] * 4 for _ in range(4)]
        r, w2, _ = h.run(w, random.Random(1), x=[0.5] * 4)
        self.assertTrue(r["stable"])
        self.assertEqual(r["redraws"], 0)
        self.assertEqual(w, w2)


if __name__ == "__main__":
    unittest.main()

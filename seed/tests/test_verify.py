"""VERIFY-1 in the seed: every new system inherits the model checker; it finds seeded defects and passes on this repository. Ultrastable is the foundation for any autonomous system."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import verify as V


class Verify(unittest.TestCase):
    def test_this_repo_passes(self):
        self.assertTrue(V.run()["ok"])

    def test_hard_cap_band_is_caught(self):
        r = V.governor_model([{"level": "full", "below": 0.5, "pace": 1}, {"level": "stop", "below": None, "pace": None}])
        self.assertFalse(r["ok"])

    def test_stall_is_caught(self):
        r = V.check([0], lambda s: [("step", s + 1)] if s < 3 else [], {}, goal=lambda s: False)
        self.assertEqual({v["kind"] for v in r["violations"]}, {"deadlock", "liveness"})


if __name__ == "__main__":
    unittest.main()

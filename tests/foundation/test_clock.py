"""CLOCKWORK-1: a clock's status is measured from its beats; chaining is bounded and backs off; the declaration is complete."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import clock as C  # noqa: E402


class Clock(unittest.TestCase):
    def test_declaration_is_complete(self):
        self.assertEqual(C.check(), [])

    def test_status_thresholds(self):
        self.assertEqual(C.status(100, 600), "ticking")
        self.assertEqual(C.status(900, 600), "ticking")
        self.assertEqual(C.status(901, 600), "late")
        self.assertEqual(C.status(1801, 600), "stopped")
        self.assertEqual(C.status(None, 600), "stopped")
        self.assertEqual(C.status(99999, 600, idle=True), "idle")

    def test_jitter_and_measure(self):
        beats = [0, 600, 1200, 1805, 2400]
        self.assertEqual(C.jitter(beats, 600), 2.5)
        m = C.measure(beats, 600, now=2500)
        self.assertEqual(m["status"], "ticking"); self.assertEqual(m["beats_24h"], 5)
        self.assertIsNone(C.measure(beats, 600, now=2500, periodic=False)["median_jitter_s"])
        self.assertEqual(C.measure([], 600, now=1)["status"], "stopped")

    def test_chain_is_bounded_and_backs_off(self):
        self.assertEqual(C.should_chain(1, 4, 5, ["success"], 3), (True, "5 takeable item(s), 1 of 4 runs used today"))
        self.assertFalse(C.should_chain(4, 4, 5, [], 3)[0])          # daily cap
        self.assertFalse(C.should_chain(0, 4, 0, [], 3)[0])          # nothing to do
        self.assertFalse(C.should_chain(0, 4, -1, [], 3)[0])         # queue unreadable
        self.assertFalse(C.should_chain(1, 4, 5, ["failure"] * 3, 3)[0])   # three failures in a row
        self.assertTrue(C.should_chain(1, 4, 5, ["failure", "failure", "success"], 3)[0])
        self.assertFalse(C.should_chain(0, 4, 5, [], 3, budget_ok=False)[0])

    def test_executor_workflow_runs_the_chain_step(self):
        t = (C.REPO / ".github/workflows/executor.yml").read_text(encoding="utf-8")
        self.assertIn("foundation clock --chain --apply", t)
        self.assertIn("github.token", t)


if __name__ == "__main__":
    unittest.main()

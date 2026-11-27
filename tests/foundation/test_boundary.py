"""BOUNDARY-1: the boundary is data, trust widens inside only, egress and reserved classes never open, the repo rebuilds, sessions are reaped."""
import copy, json, unittest
from datetime import datetime, timezone
from pathlib import Path
from foundation import boundary

REPO = Path(__file__).resolve().parents[2]


class Boundary(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(boundary.check(REPO), [])

    def test_rebuild_drill(self):
        self.assertEqual(boundary.drill(REPO), [])

    def test_egress_and_reserved_never_allowed_even_at_top_trust(self):
        """US-06-R23, US-06-T09: egress and reserved action classes are denied at the top rung as at the bottom."""
        led = {"rows": {"s|x": {"rung": "self-extending", "score": 1}}}
        for a in ("credentials", "money", "secrets", "interrupt-gate", "harness-permissions"):
            self.assertFalse(boundary.decide("s", a, REPO, led)["allow"], a)

    def test_trust_widens_inside(self):
        lo = {"rows": {"s|x": {"rung": "assisted", "score": 0.6}}}
        hi = {"rows": {"s|x": {"rung": "autonomous", "score": 0.8}}}
        self.assertFalse(boundary.decide("s", "destroy-instance", REPO, lo)["allow"])
        self.assertTrue(boundary.decide("s", "destroy-instance", REPO, hi)["allow"])

    def test_non_monotone_permissions_fail(self):
        d = copy.deepcopy(boundary.load(REPO))
        d["permissions"]["inside"]["destroy-derived"] = "observed"
        self.assertTrue(boundary.policy_check(REPO, d))

    def test_ungated_egress_fails(self):
        d = copy.deepcopy(boundary.load(REPO))
        d["egress"][0]["probe"] = "file:nope"
        self.assertTrue(boundary.policy_check(REPO, d))

    def test_reaper(self):
        d = boundary.load(REPO)
        now = datetime(2026, 11, 12, tzinfo=timezone.utc)
        s = [{"id": "a", "state": "done", "last_active": "2026-11-12T00:00:00Z"},
             {"id": "b", "state": "working", "last_active": "2026-11-10T00:00:00Z"},
             {"id": "c", "state": "working", "last_active": "2026-11-11T20:00:00Z"}]
        self.assertEqual([r["id"] for r in boundary.reap(s, d, now)], ["a", "b"])

    def test_improvement_with_dead_probe_fails(self):
        d = boundary.load(REPO)
        led = REPO / d["strange_loop"]["ledger"]
        old = led.read_text()
        try:
            j = json.loads(old); j["entries"].append({"loop": "fleet-lane", "improvement": "x", "probe": "file:missing", "at": "now"})
            led.write_text(json.dumps(j))
            self.assertTrue(boundary.improvements_check(REPO, d))
        finally:
            led.write_text(old)


if __name__ == "__main__":
    unittest.main()

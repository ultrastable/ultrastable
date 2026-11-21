# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# YEAR-SIM-1 in the seed: every new system carries the simulator, a fault register and the standing goal.
import datetime as dt, json, sys, unittest
from pathlib import Path
SEED = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED / "scripts"))
import yearsim as y

TODAY = dt.date(2026, 11, 21)


class T(unittest.TestCase):
    def test_config_is_well_formed(self):
        self.assertEqual(y.check(SEED), [])

    def test_every_generic_fault_has_a_drill_that_exists(self):
        for f in y.cfg(SEED)["faults"]:
            self.assertTrue(f.get("drill"), f["id"])
            self.assertTrue((SEED / f["drill"][-1]).is_file(), f"{f['id']}: {f['drill'][-1]}")

    def test_standing_goal_is_declared(self):
        g = {x["id"]: x for x in json.loads((SEED / "autonomy/goals.json").read_text())["goals"]}
        self.assertEqual(g["core.year.unattended"]["target"], 365)

    def test_undrilled_fault_is_not_a_pass(self):
        c = {**y.cfg(SEED), "faults": [{"id": "x", "what": "w", "rate_per_year": 1, "duration_days": [1, 1], "basis": "assumed: t"}]}
        r = y.drills(SEED, c)["x"]
        self.assertFalse(r["exercised"])

    def test_sensitivity_ranks_the_fault_that_kills(self):
        c = {**y.cfg(SEED), "faults": [{"id": "dies", "rate_per_year": 6, "duration_days": [1, 1]}, {"id": "ok", "rate_per_year": 6, "duration_days": [1, 1]}], "scheduled": []}
        res = {"dies": y.R("degrades", 0.5, False, True, "e"), "ok": y.R("recovers", 0.9, True, True, "e")}
        s = y.sensitivity(c, res, TODAY, runs=40)
        self.assertEqual(s["ranked"][0]["id"], "dies")

    def test_horizon_is_deterministic(self):
        c = y.cfg(SEED)
        res = {f["id"]: y.R("recovers", 0.9, True, True, "e") for f in c["faults"]}
        self.assertEqual(y.horizon(c, res, 30, TODAY), y.horizon(c, res, 30, TODAY))


if __name__ == "__main__":
    unittest.main()

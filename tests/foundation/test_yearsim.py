# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# YEAR-SIM-1: the year simulation and its drills. Read by failure-mode probes in doctrine/registers.json (test_exercised_drills_recover).
import datetime as dt, json, shutil, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # removed when the test ends
from foundation import yearsim as y

REPO = Path(__file__).resolve().parents[2]
TODAY = dt.date(2026, 11, 21)


class T(unittest.TestCase):
    def test_check(self):
        self.assertEqual(y.check(REPO), [])

    def test_exercised_drills_recover(self):
        # The drills that inject the fault into real code must keep recovering; a regression is a failure mode (fm-model-retired and peers).
        for fid in ("model-retirement", "merge-conflict", "ai-quota", "dependency-break", "scheduler-silent"):
            r = y.drills(REPO, TODAY, only=fid)[fid]
            self.assertTrue(r["exercised"] and r["recover"], f"{fid}: {r['evidence']}")

    def test_model_heal_exercised(self):
        r = y.drill_model_ladder(REPO, TODAY)
        self.assertIn("on a healed rung", r["evidence"])
        self.assertNotIn(" 0 on a healed rung", r["evidence"])

    def test_simulation_is_deterministic_and_bounded(self):
        c = y.cfg(REPO)
        results = {f["id"]: y.R("recovers", 0.9, True, True, "sim") for f in c["faults"]}
        a = y.one_year(c, results, "s|1", TODAY)
        self.assertEqual(a, y.one_year(c, results, "s|1", TODAY))
        self.assertEqual(a["horizon"], c["days"])  # nothing permanent: the span survives

    def test_permanent_loss_kills(self):
        c = {**y.cfg(REPO), "faults": [{"id": "x", "rate_per_year": 365, "duration_days": [1, 1]}], "scheduled": []}
        a = y.one_year(c, {"x": y.R("degrades", 0.5, False, True, "sim")}, "s", TODAY)
        self.assertTrue(a["died"])
        self.assertEqual(a["killer"], "x")

    def test_strict_fails_gates(self):
        c = {**y.cfg(REPO), "faults": [], "scheduled": [{"id": "g", "drill": "domain_renewal"}]}
        r = {"g": y.R("recovers", 0.95, True, False, "sim", gate=True, date="2027-01-01")}
        self.assertTrue(y.one_year(c, r, "s", TODAY, strict=True)["died"])
        self.assertFalse(y.one_year(c, r, "s", TODAY)["died"])

    def test_findings(self):
        fs = y.findings({}, {"a": y.R("fatal", 0, False, True, "e"), "b": y.R("recovers", 1, True, False, "e"), "c": y.R("recovers", 1, True, True, "e")},
                        {"release_horizon_p10": 0, "self_rate_per_day": 0})
        self.assertEqual([f["id"] for f in fs], ["a", "b", "self-release"])

    def test_rewrite_node(self):
        self.assertEqual(y.rewrite_node("node-version: 20\nnode-version: '26'", "24"), "node-version: 24\nnode-version: '26'")

    def test_close_recovered(self):
        d = Path(scratch())
        (d / "docs/issues").mkdir(parents=True)
        c = y.cfg(REPO)
        y._item(d, c, {"id": "gone", "why": "w", "evidence": "e"})
        y._item(d, c, {"id": "still", "why": "w", "evidence": "e"})
        closed = y._close_recovered(d, c, [{"id": "still"}], {"gone": {"evidence": "now passes"}}, {}, "t")
        self.assertEqual(closed, [c["item_prefix"] + "-gone"])
        self.assertIn("**Status:** closed", json.loads((d / "docs/issues" / (c["item_prefix"] + "-gone.json")).read_text())["body"])


if __name__ == "__main__":
    unittest.main()

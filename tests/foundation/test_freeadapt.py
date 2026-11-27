# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FREELY-ADAPTIVE-1: both verdicts on every action and the three survival levels (Pérez López, IESE WP 5, 1974). Ultrastable is the foundation for any autonomous system."""
import datetime as dt, json, tempfile, unittest
from pathlib import Path

from foundation import freeadapt as FA, research as R, specgate

T0 = dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc)
iso = lambda h: (T0 + dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")


def reading(h, var, ok, value=1.0):
    return {"at": iso(h), "ev": "reading", "var": var, "ok": ok, "value": value}


class Base(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        for sub in ("ops/decisions", "ops/growth", "doctrine", "docs/issues", "research/studies"):
            (self.d / sub).mkdir(parents=True, exist_ok=True)
        (self.d / "doctrine/criticality.json").write_text(json.dumps({"k_floor": 1.0}))
        (self.d / FA.STUDY).write_text(json.dumps({"findings": [{"mechanisms": [{"path": "foundation/freeadapt.py"}]}]}))

    def ledger(self, rows):
        (self.d / "ops/ultrastability.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))

    def outcomes(self, rows):
        (self.d / "ops/decisions/outcomes.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))


class Efficiency(Base):
    def test_both_kinds_of_learning(self):
        # guard B is inside its limits, leaves them during decision d2 only; decision d3 missed its own target
        self.ledger([reading(0, "B", True), reading(10, "B", True), reading(25, "B", False), reading(40, "B", True)])
        self.outcomes([{"id": "d1", "point": "p", "decided_at": iso(1), "at": iso(9), "hit": True},
                       {"id": "d2", "point": "p", "decided_at": iso(20), "at": iso(30), "hit": True},
                       {"id": "d3", "point": "p", "decided_at": iso(41), "at": iso(50), "hit": False}])
        rows = {r["id"]: r for r in FA.classify(self.d)}
        self.assertEqual(rows["d1"]["learning"], "sound")
        self.assertEqual(rows["d2"]["learning"], "incomplete")
        self.assertEqual(rows["d2"]["disturbed"], ["B"])
        self.assertEqual(rows["d3"]["learning"], "incorrect")

    def test_already_disturbed_is_not_attributed_and_no_prior_reading_is_unmeasured(self):
        self.ledger([reading(0, "B", False), reading(5, "B", False), reading(100, "C", True)])
        self.outcomes([{"id": "d1", "point": "p", "decided_at": iso(1), "at": iso(9), "hit": True}])
        r = FA.classify(self.d)[0]
        self.assertTrue(r["efficient"])  # B was outside its limits before the action; C has no earlier reading
        self.assertEqual(r["read"], 1)
        self.ledger([reading(100, "C", True)])
        self.assertIsNone(FA.classify(self.d)[0]["efficient"])

    def test_unmeasured_readings_are_not_disturbances(self):
        self.ledger([reading(0, "B", True), {"at": iso(5), "ev": "reading", "var": "B", "ok": False, "value": None, "unmeasured": True}])
        self.outcomes([{"id": "d1", "point": "p", "decided_at": iso(1), "at": iso(9), "hit": True}])
        self.assertTrue(FA.classify(self.d)[0]["efficient"])

    def test_second_loop_step_ignores_its_own_variable_and_other_scopes(self):
        self.ledger([reading(0, "A", True), reading(0, "t1:B", True), reading(5, "A", False), reading(6, "t1:B", False),
                     {"at": iso(1), "ev": "step", "id": "s1", "var": "t1:A"}, {"at": iso(9), "ev": "verdict", "step_id": "s1", "var": "t1:A", "verdict": "kept"},
                     {"at": iso(1), "ev": "step", "id": "s2", "var": "A"}, {"at": iso(9), "ev": "verdict", "step_id": "s2", "var": "A", "verdict": "reverted"}])
        rows = {r["id"]: r for r in FA.classify(self.d)}
        self.assertEqual(rows["s1"]["scope"], "t1")
        self.assertEqual(rows["s1"]["disturbed"], ["t1:B"])  # A is platform scope, not the tenant's
        self.assertIsNone(rows["s2"]["efficient"])  # the platform has no other variable read before it
        self.assertEqual(rows["s2"]["learning"], "incorrect")


class Consistency(Base):
    def setUp(self):
        super().setUp()
        rows, outs = [reading(0, "B", True)], []
        for i in range(5):  # five decisions of one class, each open while B leaves its limits and comes back
            h = 10 + 20 * i
            rows += [reading(h + 2, "B", False), reading(h + 8, "B", True)]
            outs.append({"id": f"d{i}", "point": "noisy", "decided_at": iso(h), "at": iso(h + 5), "hit": True})
        self.ledger(rows)
        self.outcomes(outs)

    def test_inconsistent_class_files_one_gated_item_and_probe_fails(self):
        r = FA.run(self.d, apply=True)
        self.assertEqual(r["filed"], ["Q-FAS-decision-noisy"])
        item = json.loads((self.d / "docs/issues/Q-FAS-decision-noisy.json").read_text())
        self.assertEqual(specgate.missing(item["body"]), [])
        self.assertTrue(R.PRED.match("action_classes_consistent_share >= 0.9 within 336 h"))
        self.assertEqual(FA.run(self.d, apply=True)["filed"], [])  # idempotent
        ok, msg = FA.probe(self.d, "decision:noisy")
        self.assertFalse(ok)
        self.assertIn("0.0", msg)

    def test_too_few_actions_are_not_judged(self):
        self.outcomes([{"id": "d0", "point": "rare", "decided_at": iso(10), "at": iso(15), "hit": True}])
        self.assertFalse(FA.report(self.d)["classes"]["decision:rare"]["judged"])
        self.assertEqual(FA.run(self.d, apply=True)["filed"], [])
        self.assertFalse(FA.probe(self.d, "decision:rare")[0])


class Levels(Base):
    def test_three_levels(self):
        now = T0 + dt.timedelta(days=5)
        (self.d / "ops/criticality.jsonl").write_text(json.dumps({"at": iso(1), "k": 2.0, "k_self": 0.0, "deploys": 4}) + "\n")
        res = ["pr-closed", "pr-closed", "pr-merged", "pr-merged", "verified-no-change", "pr-merged"]
        (self.d / "ops/executor-log.jsonl").write_text("".join(json.dumps({"at": iso(i), "result": x}) + "\n" for i, x in enumerate(res)))
        lv = FA.levels(self.d, now)
        self.assertTrue(lv["effective"]["ok"])
        self.assertEqual(lv["attractive"]["value"], 0.6)  # the no-change run is not an attempt
        self.assertTrue(lv["consistent"]["ok"])  # later half merged more than the earlier half
        self.assertEqual(lv["met"], 3)

    def test_unmeasured_level_is_not_met(self):
        lv = FA.levels(self.d, T0)
        self.assertEqual((lv["met"], lv["measured"]), (0, 0))
        self.assertFalse(lv["attractive"]["ok"])


class Wiring(Base):
    def test_check_and_research_metrics(self):
        self.assertEqual(FA.check(self.d), [])
        (self.d / FA.STUDY).write_text("{}")
        self.assertTrue(FA.check(self.d))
        for k in ("efficiency_verdict_share", "action_classes_consistent_share", "survival_levels_met", "essential_measured_share", "lessons_enforced_share"):
            self.assertIn(k, R.METRICS)
        rows = [reading(0, "A", True), {"at": iso(1), "ev": "reading", "var": "B", "ok": False, "value": None, "unmeasured": True}]
        self.assertEqual(R.essential_measured(rows, T0 + dt.timedelta(days=1))["value"], 0.5)

    def test_repo_study_names_the_module(self):
        self.assertEqual(FA.check(), [])


if __name__ == "__main__":
    unittest.main()

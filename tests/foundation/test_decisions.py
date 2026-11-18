# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import datetime as dt, json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests.foundation._repo import copy_repo
from foundation import decisions as D

T0 = dt.datetime(2026, 11, 18, 12, 0, tzinfo=dt.timezone.utc)


class Decisions(unittest.TestCase):
    def test_registry_complete_in_repo(self):
        self.assertEqual(D.check(), [])

    def test_unmarked_decision_function_fails(self):
        root = copy_repo()
        (root / "foundation/zzz_new.py").write_text("def choose_thing(x):\n    return x\n")
        self.assertTrue(any("zzz_new.py" in b and "no declared metric" in b for b in D.check(root)))

    def test_marker_for_unregistered_point_and_missing_marker_fail(self):
        root = copy_repo()
        (root / "foundation/zzz_new.py").write_text("# DECISION-METRIC: made-up\ndef choose_thing(x):\n    return x\n")
        self.assertTrue(any("unregistered decision point made-up" in b for b in D.check(root)))
        p = root / "foundation/spinoff.py"; p.write_text(p.read_text().replace("DECISION-METRIC: spinoff-launch", "x"))
        self.assertTrue(any("spinoff-launch" in b and "lacks the marker" in b for b in D.check(root)))

    def test_not_decisions_needs_reason_and_goes_stale(self):
        root = copy_repo()
        cfg = json.loads((root / "doctrine/decisions.json").read_text())
        cfg["not_decisions"]["foundation/conflicts.py"] = "too short"
        (root / "doctrine/decisions.json").write_text(json.dumps(cfg))
        self.assertTrue(any("conflicts.py" in b and "six words" in b for b in D.check(root)))

    def test_record_settle_and_trend(self):
        root = copy_repo()
        for f in ("ops/decisions/ledger.jsonl", "ops/decisions/outcomes.jsonl"):
            (root / f).unlink(missing_ok=True)
        (root / "ops/free-tier.json").write_text(json.dumps({"level": "ok"}))
        for i in range(4):
            self.assertIsNotNone(D.record(root, "idea-loop", f"i{i}", f"i{i}", 1.0, "priced", now=T0))
        self.assertIsNone(D.record(root, "idea-loop", "i0", "i0", 1.0, "priced", now=T0), "idempotent")
        self.assertEqual(D.settle(root, True, T0)["scored"], 0, "window not passed")
        later = T0 + dt.timedelta(hours=25)
        self.assertEqual(D.settle(root, True, later)["scored"], 4)
        p = [x for x in D.status(root, later)["points"] if x["id"] == "idea-loop"][0]
        self.assertEqual((p["decisions"], p["scored"], p["hit_rate"]), (4, 4, 1.0))
        self.assertEqual(p["trend"]["verdict"], "flat")

    def test_unreadable_source_is_never_scored(self):
        root = copy_repo()
        (root / "ops/decisions/ledger.jsonl").unlink(missing_ok=True); (root / "ops/decisions/outcomes.jsonl").unlink(missing_ok=True)
        (root / "ops/free-tier.json").unlink()
        D.record(root, "idea-loop", "a", "a", 1.0, "x", now=T0)
        r = D.settle(root, True, T0 + dt.timedelta(hours=30))
        self.assertEqual((r["scored"], r["overdue_unmeasurable"]), (0, 1))

    def test_probe_flags_decisions_logged_but_never_scored(self):
        root = copy_repo()
        (root / "ops/decisions/ledger.jsonl").unlink(missing_ok=True); (root / "ops/decisions/outcomes.jsonl").unlink(missing_ok=True)
        for i in range(3):
            D.record(root, "work-queue-priority", f"issue {i}", f"zz{i}", 1.0, "x", now=T0)
        live = {"points": {"ai-router": {"decisions": 5, "scored": 5}, "free-tier-governor": {"decisions": 2, "scored": 1}}}
        st, d = D.probe(root, T0 + dt.timedelta(days=3), fetch=lambda u: live)
        self.assertEqual(st, "violated"); self.assertIn("work-queue-priority", d)


if __name__ == "__main__":
    unittest.main()

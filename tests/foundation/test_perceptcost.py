# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import datetime as dt, json, tempfile, unittest
from pathlib import Path

from foundation import perceptcost as pc


def _root(d: Path):
    (d / "foundation").mkdir(); (d / "doctrine").mkdir(); (d / "ops").mkdir()
    (d / "foundation/a.py").write_text('def churn_gate():\n    pass\n' + "# churn\n" * 50)
    (d / "foundation/b.py").write_text("# churn too and zzz\n" * 400)
    (d / "doctrine/replay-set.json").write_text(json.dumps({"interval_days": 7, "min_saving": 0.15,
        "questions": [{"id": "q", "keywords": ["churn"], "answer": "foundation/a.py"}, {"id": "miss", "keywords": ["zzz"], "answer": "foundation/b.py"}]}))


class PerceptCostTest(unittest.TestCase):
    def test_hit_saves_and_miss_costs_baseline(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _root(d)
            paths = ["foundation/a.py", "foundation/b.py"]
            r = pc.score(d, paths)
            hit, miss = r["rows"]
            self.assertTrue(hit["map_hit"]); self.assertLess(hit["with_map"], hit["without_map"])
            self.assertFalse(miss["map_hit"]); self.assertGreaterEqual(miss["with_map"], miss["without_map"])
            self.assertEqual(r["map_hits"], 1)
            self.assertEqual(pc.check(d), [])

    def test_due_after_interval(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _root(d)
            self.assertTrue(pc.due(d))
            (d / pc.LOG).write_text(json.dumps({"date": "2026-11-20"}) + "\n")
            self.assertFalse(pc.due(d, dt.date(2026, 11, 26)))
            self.assertTrue(pc.due(d, dt.date(2026, 11, 27)))


class Envelope(unittest.TestCase):
    def test_row_is_a_cloudevent_and_due_reads_it(self):
        from foundation import cloudevents, openstd
        r = {"date": "2026-11-27", "rows": []}
        e = pc.envelope(r)
        self.assertEqual(cloudevents.conforms(e), [])
        self.assertEqual(cloudevents.unwrap(e), r)
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _root(d)
            (d / pc.LOG).write_text(json.dumps(e) + "\n")
            self.assertTrue(openstd.ledger_ok(d, pc.LOG))
            self.assertFalse(pc.due(d, dt.date(2026, 11, 28)))
            self.assertTrue(pc.due(d, dt.date(2026, 12, 4)))

    def test_repo_ledger_conforms(self):
        from foundation import openstd
        self.assertTrue(openstd.ledger_ok(pc.REPO, pc.LOG))


if __name__ == "__main__":
    unittest.main()

"""CRITICALITY-1: the score, the mantra, predictions and the from-nothing ignition proof."""
import datetime as dt, json, tempfile, unittest
from pathlib import Path
from foundation import criticality as cr, ignition, queue

ROOT = Path(__file__).resolve().parents[2]
C = cr.cfg(ROOT)


class Score(unittest.TestCase):
    def test_config_and_invariants(self):
        self.assertEqual(cr.check(ROOT), [])

    def test_first_real_measurement_is_not_critical(self):
        # 2026-11-12, measured from GitHub runs and Cloudflare analytics: 1 zero-human deploy, 110 human-attended, 117 interventions
        d = cr.score_day("2026-11-12", {"auto": 1, "human": 110}, {"d1_rows_read": 1713691126, "ai_neurons": 1497340.58}, 117, 1.0, C)
        self.assertLess(d["k"], 0.01); self.assertFalse(d["critical"]); self.assertEqual(d["limiter"], "attention")

    def test_critical_when_output_beats_binding_load(self):
        d = cr.score_day("t", {"auto": 20}, {"d1_rows_read": 5e7, "ai_neurons": 5e4}, 1, 1.0, C)
        self.assertTrue(d["critical"]); self.assertGreater(d["k"], 1)

    def test_spend_rows_parse(self):
        r = {"data": {"viewer": {"accounts": [{"d1": [{"dimensions": {"date": "d"}, "sum": {"rowsRead": 5}}], "ai": [{"dimensions": {"date": "d"}, "sum": {"totalNeurons": 7.5}}]}]}}}
        self.assertEqual(cr.spend_rows(r), {"d": {"d1_rows_read": 5, "ai_neurons": 7.5}})


class Mantra(unittest.TestCase):
    def test_every_declared_loop_is_checked(self):
        flows = json.loads((ROOT / "doctrine/flows.json").read_text())["flows"]
        got = {r["loop"] for r in cr.mantra_all(ROOT)}
        self.assertEqual(got, set(flows))

    def test_prediction_grammar_and_grading_files_revert(self):
        with tempfile.TemporaryDirectory() as td:
            t = Path(td); (t / "ops").mkdir(); (t / "docs/issues").mkdir(parents=True); (t / cr.LOG).touch()
            with self.assertRaises(ValueError):
                cr.predict(t, "x", "k will be better")
            cr.predict(t, "chg-1", "k > 5 within 1 h", at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2))
            rec = {"at": "2026-11-13T12:00:00", "headline": {"k": 0.1, "deploys": {"auto_verified": 0}, "spend": {"d1_load": 1, "ai_load": 1}, "attention": {"load": 1}}}
            g = cr.grade(rec, t, apply=True)
            self.assertEqual(len(g), 1); self.assertFalse(g[0]["hit"])
            self.assertTrue(list((t / "docs/issues").glob("Q-CRIT-REVERT-*.json")))
            self.assertEqual(cr.grade(rec, t, apply=True), [])  # graded once


class Ignition(unittest.TestCase):
    def test_from_nothing_to_a_scored_system(self):
        r = ignition.prove()
        self.assertTrue(r["ok"], r); self.assertEqual(r["seed"]["missing"], []); self.assertGreater(r["ignite"]["loops"], 20)

    def test_alert_item_is_a_valid_queue_item(self):
        with tempfile.TemporaryDirectory() as td:
            t = Path(td); (t / "ops").mkdir(); (t / "docs/issues").mkdir(parents=True)
            rec = cr.score({"at": "2026-11-13T00:00:00", "deploys": {"d": {"auto": 0}}, "spend": {"d": {"d1_rows_read": 9e8, "ai_neurons": 1}}, "interventions": {"d": 0}, "coupling": 1.0}, C)
            self.assertIn("Q-CRIT-COST-D1", cr.alert(rec, C, None, t, apply=True))
            self.assertEqual(queue.check(t), [])


if __name__ == "__main__":
    unittest.main()

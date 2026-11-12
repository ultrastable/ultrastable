"""CLOCKWORK-1: freshness, missed ticks, drift, escalation steps and settlement by name, on recorded evidence."""
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import clockwork as C  # noqa: E402
import _repo  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
S = {"id": "x", "loop": "l", "cadence_minutes": 60, "evidence": "e.jsonl", "max_late_minutes": 30, "catch_up": "c"}


def at(h, m=0):
    return C._t(f"2026-11-12T{h:02d}:{m:02d}:00Z")


class Clock(unittest.TestCase):
    def test_declaration_is_valid(self):
        self.assertEqual(C.check(REPO), [])

    def test_on_time_then_missed_then_escalates(self):
        ts = [at(8), at(9), at(10)]
        self.assertEqual(C.measure(S, ts, at(10, 50))["verdict"], "on-time")
        r = C.measure(S, ts, at(14)); self.assertEqual((r["verdict"], r["missed"]), ("missed", 3))
        self.assertEqual(C.step(1, C.load(REPO)["escalation"]), "catch-up"); self.assertEqual(C.step(3, C.load(REPO)["escalation"]), "item"); self.assertEqual(C.step(7, C.load(REPO)["escalation"]), "reroute")

    def test_drift_is_deviation_from_cadence(self):
        self.assertEqual(C.measure(S, [at(8), at(9, 10), at(10, 20)], at(10, 30))["drift_min"], 10.0)

    def test_never_ran_is_a_miss(self):
        self.assertEqual(C.measure(S, [], at(10))["verdict"], "never")

    def test_run_files_item_for_a_missed_stage_and_settles_by_name(self):
        d = _repo.tiny_repo() if hasattr(_repo, "tiny_repo") else _repo.scratch()
        d = Path(d); (d / "docs/issues").mkdir(parents=True, exist_ok=True); (d / "doctrine").mkdir(exist_ok=True)
        cfg = C.load(REPO); cfg["stages"] = [S]; (d / C.PATH).write_text(json.dumps(cfg))
        (d / "e.jsonl").write_text(json.dumps({"at": "2026-11-12T08:00:00Z"}) + "\n")
        out = C.run(d, at(14), apply=True)
        self.assertEqual([i["id"] for i in out], ["Q-CLOCK-x"]); self.assertTrue((d / "docs/issues/Q-CLOCK-x.json").is_file())
        self.assertFalse(C.settle(d, "x", at(12)))
        (d / "e.jsonl").write_text((d / "e.jsonl").read_text() + json.dumps({"at": "2026-11-12T13:00:00Z"}) + "\n")
        self.assertTrue(C.settle(d, "x", at(12)))

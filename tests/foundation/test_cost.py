"""COST-GUARD-1: the declaration is complete; the cost level is the largest share of budget used."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _repo  # noqa: E402
from foundation import cost as C  # noqa: E402

THR = {"rows_read_max": 100, "rows_read_override": {"ultrastable-big": 1000}, "neurons_max": 50, "file_prefixes": ["ultrastable-"]}


class Cost(unittest.TestCase):
    def test_declaration(self):
        self.assertEqual(C.check(), [])

    def test_level(self):
        self.assertEqual(C.level({"d1": [{"name": "ultrastable-a", "rows_read": 250}, {"name": "ultrastable-big", "rows_read": 500}], "ai": {"neurons": 10}}, THR), 2.5)
        self.assertEqual(C.level({"d1": [], "ai": {"neurons": 100}}, THR), 2.0)
        self.assertEqual(C.level({"d1": [{"name": "ultrastable-a", "rows_read": 1}], "ai": {"neurons": 1}}, THR), 0.02)

    def test_level_reads_probe_rows(self):
        """COST-LEVEL-SHAPES-1: a cost-probe day row (rowsRead by databaseId, top-level neurons) is scaled to the window, never read as 0."""
        thr = dict(THR, window_days=7)
        row = {"d1": [{"databaseId": "x", "rowsRead": 20}], "d1Size": [{"databaseId": "x", "name": "ultrastable-a", "bytes": 1}], "neurons": 5}
        self.assertEqual(C.level(row, thr), 1.4)

    def _root(self, rows, **thr):
        import json
        d = _repo.scratch(); (d / "ops").mkdir()
        (d / "ops/cost-thresholds.json").write_text(json.dumps(dict(THR, window_days=7, neurons_max=1000, **thr)))
        (d / "ops/cost.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        return d

    def test_guard(self):
        """US-24-R62: a stale, empty or unmeasured cost reading fails the guard and is never read as zero."""
        import datetime as dt
        ok = {"ts": "t", "date": "2026-11-25", "d1": [{"databaseId": "x", "rowsRead": 1}], "neurons": 1, "breaches": [],
              "d1Size": [{"databaseId": "x", "name": "ultrastable-a", "bytes": 100}]}
        today = dt.date(2026, 11, 25)
        self.assertEqual(C.guard(self._root([ok]), today), [])
        self.assertTrue(any("days old" in m for m in C.guard(self._root([ok]), dt.date(2026, 12, 1))))
        self.assertTrue(any("no D1" in m for m in C.guard(self._root([dict(ok, d1=[])]), today)))
        self.assertTrue(any("unmeasured" in m for m in C.guard(self._root([dict(ok, unmeasured="no token")]), today)))
        grow = [dict(ok, date="2026-11-15", d1Size=[{"name": "ultrastable-a", "bytes": 100}]), dict(ok, d1Size=[{"name": "ultrastable-a", "bytes": 600}])]
        self.assertTrue(any("reaches" in m for m in C.guard(self._root(grow, d1_size_max_bytes=1000, d1_size_horizon_days=90), today)))
        self.assertEqual(C.guard(self._root([]), today), ["no cost reading in ops/cost.jsonl: cost is unmeasured"])


if __name__ == "__main__":
    unittest.main()

"""METRIC-LOOP-1: a breach files one remedy, a remedy that did not move its metric in the window is replaced, no lever left asks for a new one."""
import json, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import metricloop as M  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

T0 = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
REG = {"efficacy_days": 7, "min_move_share": 0.1, "metrics": [
    {"id": "backlog", "kind": "target", "reader": "r_backlog", "op": "<=", "threshold": 10, "owner": "operations",
     "levers": [{"id": "a", "action": "do a"}, {"id": "b", "action": "do b", "code_task": "repo=x path=y"}]},
    {"id": "spend", "kind": "guard", "reader": "r_spend", "op": "<=", "threshold": 1.0, "owner": "operations", "levers": [{"id": "s", "action": "cut"}]}]}


class Box:
    def __init__(self, backlog, spend=0.5):
        self.backlog, self.spend = backlog, spend

    def readers(self):
        return {"r_backlog": lambda root: self.backlog, "r_spend": lambda root: self.spend}


def repo():
    d = scratch()
    (d / "doctrine").mkdir(); (d / "docs/issues").mkdir(parents=True)
    (d / M.REGISTRY).write_text(json.dumps(REG))
    return d


def body(d, iid):
    return json.loads((d / "docs/issues" / f"{iid}.json").read_text())["body"]


class MetricLoop(unittest.TestCase):
    def test_repo_registry_valid(self):
        self.assertEqual(M.check(ROOT), [])

    def test_breach_files_one_item_with_first_lever(self):
        d, box = repo(), Box(30)
        r = M.tick(d, apply=True, now=T0, readers=box.readers())
        self.assertEqual((r["breached"], r["filed"]), (["backlog"], ["Q-METRIC-BACKLOG.json"]))
        b = body(d, "Q-METRIC-BACKLOG")
        self.assertIn("Lever now: **a**", b); self.assertIn("Done check:** cmd:python3 -m foundation metricloop --probe backlog", b)
        r = M.tick(d, apply=True, now=T0 + timedelta(hours=1), readers=box.readers())
        self.assertEqual(r["filed"], [], "a running remedy is not filed twice")

    def test_unmoved_remedy_is_replaced_then_exhausted(self):
        d, box = repo(), Box(30)
        M.tick(d, apply=True, now=T0, readers=box.readers())
        r = M.tick(d, apply=True, now=T0 + timedelta(days=7, minutes=1), readers=box.readers())
        self.assertEqual(r["verdicts"], [("backlog", "not-moved")])
        b = body(d, "Q-METRIC-BACKLOG")
        self.assertIn("Lever now: **b**", b); self.assertIn("retired for not moving the metric: a", b); self.assertIn("code-task: repo=x path=y", b)
        r = M.tick(d, apply=True, now=T0 + timedelta(days=14, minutes=2), readers=box.readers())
        self.assertEqual(r["exhausted"], ["backlog"])
        self.assertIn("originate a new lever", json.loads((d / "docs/issues/Q-METRIC-BACKLOG-LEVER.json").read_text())["title"])
        self.assertEqual(r["efficacy_30d"], 0.0)

    def test_moved_remedy_is_kept_and_recovery_counts(self):
        d, box = repo(), Box(30)
        M.tick(d, apply=True, now=T0, readers=box.readers())
        box.backlog = 25  # moved 5 of a 20 gap: kept, a new window starts on the same lever
        r = M.tick(d, apply=True, now=T0 + timedelta(days=7, minutes=1), readers=box.readers())
        self.assertEqual(r["verdicts"], [("backlog", "moved")])
        self.assertEqual(M.state(__import__("foundation.ledger", fromlist=["rows"]).rows(d, M.LEDGER, branch=False))["backlog"]["active"]["lever"], "a")
        box.backlog = 4
        r = M.tick(d, apply=True, now=T0 + timedelta(days=8), readers=box.readers())
        self.assertEqual((r["verdicts"], r["breached"], r["efficacy_30d"]), ([("backlog", "recovered")], [], 1.0))
        self.assertEqual(M.probe("backlog", d, readers=box.readers())[0], True)

    def test_guard_regression_recorded(self):
        d, box = repo(), Box(30, spend=0.5)
        M.tick(d, apply=True, now=T0, readers=box.readers())
        box.backlog, box.spend = 20, 0.9
        r = M.tick(d, apply=True, now=T0 + timedelta(hours=1), readers=box.readers())
        self.assertEqual(r["regressions"], [{"target": "backlog", "guard": "spend"}], "a target gain bought with a worse guard is a regression")

    def test_unreadable_metric_is_a_breach(self):
        d = repo()
        r = M.tick(d, apply=False, now=T0, readers={"r_backlog": lambda root: 1 / 0, "r_spend": lambda root: 0.1})
        self.assertIn("backlog", r["breached"])


if __name__ == "__main__":
    unittest.main()

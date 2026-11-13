"""CRITICALITY-1: each clause of the mantra is a computed check; k gates the queue; an unchanged tick is a failure."""
import json, sys, unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import criticality as C  # noqa: E402
from tests.foundation._repo import scratch  # noqa: E402

NOW = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)


def repo(deploys, cost_rows=()):
    d = scratch()
    for rel in ("doctrine", "ops", "docs/issues"):
        (d / rel).mkdir(parents=True)
    root = Path(__file__).resolve().parents[2]
    for f in ("criticality.json", "cost.json"):
        (d / "doctrine" / f).write_text((root / "doctrine" / f).read_text(encoding="utf-8"), encoding="utf-8")
    (d / "ops/cost-thresholds.json").write_text((root / "ops/cost-thresholds.json").read_text(encoding="utf-8"), encoding="utf-8")
    (d / "ops/deploys.jsonl").write_text("".join(json.dumps(x) + "\n" for x in deploys), encoding="utf-8")
    (d / "ops/cost.jsonl").write_text("".join(json.dumps(x) + "\n" for x in cost_rows), encoding="utf-8")
    return d


GOOD = {"at": "2026-11-13T08:00:00Z", "worker": "w", "uploaded": True, "live_matches_commit": True}


class Criticality(unittest.TestCase):
    def test_repo_declaration(self):
        self.assertEqual(C.check(), [])

    def test_clauses_computed(self):
        r = C.compute(repo([GOOD]), NOW, feed_ok=True)
        self.assertEqual(r["clauses"], {"ship": True, "verify": True, "spend": True, "feed": True})
        bad = C.compute(repo([GOOD, dict(GOOD, live_matches_commit=False)], [{"d1": [{"name": "a", "rows_read": 10**10}], "ai": {"neurons": 1}}]), NOW, feed_ok=False)
        self.assertEqual(bad["clauses"], {"ship": True, "verify": False, "spend": False, "feed": False})
        self.assertEqual(C.compute(repo([]), NOW, feed_ok=True)["clauses"]["ship"], False)

    def test_k_below_floor_filters_queue(self):
        d = repo([], [])
        items = [{"number": "Q-FEATURE-1", "labels": []}, {"number": "Q-COST-9", "labels": []}, {"number": "X", "labels": [{"name": "raises-deploys"}]}]
        self.assertEqual([i["number"] for i in C.gate(items, d)], ["Q-COST-9", "X"])
        d2 = repo([GOOD])
        self.assertEqual(len(C.gate(items, d2)), 3)

    def test_control_rods_narrow_to_cost_when_cost_runs_away(self):
        d = repo([GOOD], [{"d1": [{"name": "a", "rows_read": 10**10}], "ai": {"neurons": 1}}])
        items = [{"number": "Q-DEPLOY-1", "labels": []}, {"number": "Q-COST-2", "labels": []}, {"number": "F", "labels": []}]
        self.assertEqual([i["number"] for i in C.gate(items, d)], ["Q-COST-2"])

    def test_chain_is_the_share_of_flows_on_a_cycle(self):
        self.assertEqual(C.compute(feed_ok=True)["chain"], 1.0)

    def test_unchanged_tick_is_stall(self):
        d = repo([GOOD])
        a = C.tick(d, apply=True, now=NOW, feed_ok=True)
        self.assertFalse(a["stalled"])
        b = C.tick(d, apply=True, now=NOW, feed_ok=True)
        self.assertTrue(b["stalled"])
        self.assertTrue((d / "docs/issues/Q-CRIT-STALL.json").is_file())


if __name__ == "__main__":
    unittest.main()

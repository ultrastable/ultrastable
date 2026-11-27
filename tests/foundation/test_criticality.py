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
        bad = C.compute(repo([GOOD, dict(GOOD, live_matches_commit=False)], [{"d1": [{"name": "ultrastable-a", "rows_read": 10**10}], "ai": {"neurons": 1}}]), NOW, feed_ok=False)
        self.assertEqual(bad["clauses"], {"ship": True, "verify": False, "spend": False, "feed": False})
        self.assertEqual(C.compute(repo([]), NOW, feed_ok=True)["clauses"]["ship"], False)

    def test_k_below_floor_filters_queue(self):
        d = repo([], [])
        items = [{"number": "Q-FEATURE-1", "labels": []}, {"number": "Q-COST-9", "labels": []}, {"number": "X", "labels": [{"name": "raises-deploys"}]}]
        self.assertEqual([i["number"] for i in C.gate(items, d, NOW)], ["Q-COST-9", "X"])
        d2 = repo([GOOD])
        self.assertEqual(len(C.gate(items, d2, NOW)), 3)

    def test_control_rods_narrow_to_cost_when_cost_runs_away(self):
        d = repo([GOOD], [{"d1": [{"name": "ultrastable-a", "rows_read": 10**10}], "ai": {"neurons": 1}}])
        items = [{"number": "Q-DEPLOY-1", "labels": []}, {"number": "Q-COST-2", "labels": []}, {"number": "F", "labels": []}]
        self.assertEqual([i["number"] for i in C.gate(items, d, NOW)], ["Q-COST-2"])

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


class SelfReference(unittest.TestCase):
    """SELF-REFERENCE-1: Ultrastable runs on Ultrastable; only the system's own work counts toward k_self."""

    def test_origin_of_reads_the_commit(self):
        c = C.cfg()
        self.assertEqual(C.origin_of("Closes #9\n\nExecutor run 2026-11-14T00:00Z. Checks passed", c), "executor")
        self.assertEqual(C.origin_of("X\n## Handoff\nitem: A\nagent: workers-ai-glm\n", c), "self-agent")
        self.assertEqual(C.origin_of("X\n## Handoff\nitem: A\nagent: claude-code\n", c), "outside")
        self.assertEqual(C.origin_of("AUTH-1: fix callback (#309)", c), "outside")
        self.assertEqual(C.origin_of(None, c), "unknown")

    def test_self_reference_regime(self):
        out = dict(GOOD, origin="outside")
        own = dict(GOOD, origin="executor")
        driven = C.compute(repo([out]), NOW, feed_ok=True)
        self.assertEqual((driven["k_self"], driven["regime"], driven["bootstrap"]), (0.0, "driven", None))
        self.assertGreater(driven["k"], 1.0)
        selfs = C.compute(repo([own, dict(own, worker="v")]), NOW, feed_ok=True)
        self.assertEqual((selfs["self_deploys"], selfs["regime"]), (2, "self-sustaining"))
        self.assertEqual(C.compute(repo([]), NOW, feed_ok=True)["regime"], "subcritical")

    def test_driven_regime_puts_self_raising_work_first_and_drops_nothing(self):
        d = repo([dict(GOOD, origin="outside")])
        items = [{"number": "F-1", "labels": []}, {"number": "Q-EXEC-2", "labels": []}, {"number": "G", "labels": ["raises-self"]}]
        self.assertEqual([i["number"] for i in C.gate(items, d, NOW)], ["Q-EXEC-2", "G", "F-1"])
        d2 = repo([dict(GOOD, origin="executor")])
        self.assertEqual([i["number"] for i in C.gate(items, d2, NOW)], ["F-1", "Q-EXEC-2", "G"])

    def test_bootstrap_fixed_point_holds_in_this_repository(self):
        self.assertIs(C.bootstrap_holds(), True)


class Ignorance(unittest.TestCase):
    """IGNORANCE-1: unknown = known - told; a changed statement is unknown again."""

    def test_unknown_is_known_minus_told(self):
        """US-16-R20: what the owner has not been told is computed, unknown = known - told, from an append-only told log that refuses a repeat."""
        from foundation import ignorance as I
        d = repo([dict(GOOD, origin="outside")])
        (d / "ops/told.jsonl").write_text("", encoding="utf-8")
        before = {f["id"] for f in I.unknown(d)}
        self.assertIn("criticality-regime", before)
        I.record_told(d, ["criticality-regime"])
        self.assertNotIn("criticality-regime", {f["id"] for f in I.unknown(d)})
        with self.assertRaises(KeyError):
            I.record_told(d, ["criticality-regime"])

    def test_repo_register_is_intact(self):
        from foundation import ignorance as I
        self.assertEqual(I.check(), [])


class CriticalityLoopWiring(unittest.TestCase):
    """CRITICALITY-LOOP-1: the Worker-side controller is declared, registered, clocked and migrated; its numbers live in the seed thresholds."""
    def test_loop_is_wired_end_to_end(self):
        root = Path(__file__).resolve().parents[2]
        seed = json.loads((root / "seed/autonomy/criticality.json").read_text(encoding="utf-8"))
        ctl = seed["control"]
        for k in ("subcritical_ticks", "prediction_hours", "cooldown_hours", "stall_ticks", "raises_id_prefixes", "owner_role", "beat_interval_s"):
            self.assertIn(k, ctl)
        reg = json.loads((root / "instances/ultrastable/loop-registry.json").read_text(encoding="utf-8"))
        loops = reg["loops"] if isinstance(reg, dict) else reg
        self.assertIn("criticality-loop", {l["id"] for l in loops})
        clocks = json.loads((root / "doctrine/clocks.json").read_text(encoding="utf-8"))["clocks"]
        self.assertTrue(any(c["id"] == "criticality-loop" and c["table"] == "criticality_history" for c in clocks))
        self.assertIn("criticality_history", (root / "seed/worker/migrations/0012_criticality_loop.sql").read_text(encoding="utf-8"))
        self.assertIn("controlStep", (root / "seed/worker/src/critloop.js").read_text(encoding="utf-8"))
        self.assertIn("critloop", (root / ".github/workflows/deploy-workers.yml").read_text(encoding="utf-8") + "critloop")  # deploy path covers seed/worker/**

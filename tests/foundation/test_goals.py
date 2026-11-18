# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import datetime as dt, json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests.foundation._repo import copy_repo
from foundation import goals as G

T0 = dt.datetime(2026, 11, 18, 12, 0, tzinfo=dt.timezone.utc)
H = lambda n: T0 + dt.timedelta(hours=n)
GOOD = {"criticality.regime_score": 1.0, "criticality.self_deploys": 5, "criticality.cost": 0.4, "criticality.k": 5, "criticality.verified_share": 1.0, "criticality.autonomy_rate": 0.995,
        "spinoff.apps_used": 6, "spinoff.queued_ideas": 4, "tenants.served": 3, "free_tier.busiest_share": 0.5, "claims.drift": 0}


def lone(root, gid):
    """Keep one goal so a test reads one story."""
    p = root / "doctrine/goals.json"
    c = json.loads(p.read_text())
    c["goals"] = [dict(g, parent=None, children=[]) for g in c["goals"] if g["id"] == gid]
    c["goals"][0]["level"] = 0
    p.write_text(json.dumps(c, indent=1))
    for rel in ("ops/ultrastability.jsonl", "ops/growth/knob-log.jsonl", "ops/goals/ledger.jsonl", "ops/goals/proposals.jsonl", "ops/decisions/ledger.jsonl", "ops/decisions/outcomes.jsonl"):
        if (root / rel).is_file():
            (root / rel).write_text("")  # a scratch copy starts with no history of its own
    return c


def knob(root, kid):
    c = G.load(root)
    return G.knob_value(root, next(k for k in c["knobs"] if k["id"] == kid))


class Goals(unittest.TestCase):
    def test_registry_and_page_ok_in_repo(self):
        self.assertEqual(G.check(), [])

    def test_goal_without_knob_or_reading_fails(self):
        root = copy_repo()
        p = root / "doctrine/goals.json"
        c = json.loads(p.read_text())
        c["goals"][1]["knobs"] = []
        c["goals"][2]["reading"] = "made.up"
        p.write_text(json.dumps(c, indent=1))
        bad = "\n".join(G.check(root))
        self.assertIn("missing knobs", bad)
        self.assertIn("which nothing computes", bad)

    def test_tree_has_standing_goal_and_system_proposed_goals(self):
        ids = {g["id"]: g for g in G.tree(Path(G.REPO))}
        self.assertEqual(ids["bootstrap-to-criticality"]["level"], 0)
        self.assertTrue(any(g["proposed_by"] == "system" for g in ids.values()))

    def test_in_bounds_turns_nothing_and_unmeasured_is_never_ok(self):
        root = copy_repo(); lone(root, "unattended-deploys")
        for i in range(4):
            out = G.tick(root, True, H(i), read={**GOOD})
        self.assertEqual(out["steps"], [])
        out = G.tick(root, True, H(5), read={**GOOD, "criticality.self_deploys": None})
        self.assertEqual(out["unmeasured"], ["unattended-deploys"]); self.assertEqual(out["steps"], [])

    def test_patience_then_one_knob_one_step_logged_as_decision(self):
        root = copy_repo(); lone(root, "unattended-deploys")
        before = knob(root, "chain_max_runs_per_day")
        bad = {**GOOD, "criticality.self_deploys": 0}
        out1 = G.tick(root, True, H(0), read=bad)
        self.assertEqual(out1["steps"], [])  # patience: one miss is noise
        out2 = G.tick(root, True, H(1), read=bad)
        self.assertEqual(len(out2["steps"]), 1)
        s = out2["steps"][0]
        self.assertEqual((s["knob"], s["before"], s["after"]), ("chain_max_runs_per_day", before, before + 1))
        self.assertEqual(knob(root, "chain_max_runs_per_day"), before + 1)
        led = [json.loads(l) for l in (root / "ops/decisions/ledger.jsonl").read_text().splitlines() if l.strip()]
        self.assertTrue(any(r["point"] == "goal-knob" and r["ref"].startswith("unattended-deploys:") for r in led))
        # no second knob while the first step is still being judged
        self.assertEqual(G.tick(root, True, H(2), read=bad)["steps"], [])

    def test_step_kept_when_variable_moves_toward_target(self):
        root = copy_repo(); lone(root, "unattended-deploys")
        bad = {**GOOD, "criticality.self_deploys": 0}
        G.tick(root, True, H(0), read=bad); G.tick(root, True, H(1), read=bad)
        out = G.tick(root, True, H(2), read={**GOOD, "criticality.self_deploys": 1})
        self.assertEqual([v["verdict"] for v in out["verdicts"]], ["kept"])

    def test_step_reverted_and_knob_marked_spent_when_no_improvement(self):
        root = copy_repo(); lone(root, "unattended-deploys")
        before = knob(root, "chain_max_runs_per_day")
        bad = {**GOOD, "criticality.self_deploys": 0}
        for i in range(5):
            G.tick(root, True, H(i * 30), read=bad)
        self.assertEqual(knob(root, "chain_max_runs_per_day"), before)  # restored
        st = G.status(root, H(200), read=bad)["goals"][0]
        self.assertEqual(st["adjustments"][0]["verdict"], "reverted")

    def test_replan_when_every_knob_is_spent_or_at_limit(self):
        root = copy_repo(); lone(root, "autonomy-rate")
        p = root / "doctrine/clocks.json"
        c = json.loads(p.read_text()); c["chain"]["max_runs_per_day"] = 8; p.write_text(json.dumps(c, indent=2))
        bad = {**GOOD, "criticality.autonomy_rate": 0.5}
        out = {}
        for i in range(3):
            out = G.tick(root, True, H(i), read=bad)
        self.assertEqual(out["replans"][0]["goal"], "autonomy-rate")
        self.assertTrue((root / "docs/issues/Q-GOAL-autonomy-rate-REPLAN.json").is_file())
        props = [json.loads(l) for l in (root / "ops/goals/proposals.jsonl").read_text().splitlines()]
        self.assertEqual(props[-1]["ev"], "replan")

    def test_down_direction_knob_for_a_ceiling_goal(self):
        root = copy_repo(); lone(root, "spend-under-budget")
        before = knob(root, "chain_max_runs_per_day")
        bad = {**GOOD, "criticality.cost": 0.95}
        G.tick(root, True, H(0), read=bad); out = G.tick(root, True, H(1), read=bad)
        self.assertEqual(out["steps"][0]["after"], before - 1)

    def test_ratchet_raises_a_target_after_a_met_streak(self):
        root = copy_repo(); lone(root, "unattended-deploys")
        for i in range(G.load(root)["ratchet_after_met_ticks"]):
            G.tick(root, True, H(i), read={**GOOD})
        out = G.propose(root, True, H(50), read={**GOOD})
        self.assertEqual(out["revised"][0]["goal"], "unattended-deploys")
        self.assertGreater(G.tree(root)[0]["target"], 3)
        self.assertEqual(G.propose(root, True, H(51), read={**GOOD})["revised"], [])  # one revision per streak

    def test_write_knob_keeps_file_formatting_and_changes_one_number(self):
        root = copy_repo()
        p = root / "doctrine/spinoff-ideas.json"
        before = p.read_text()
        k = next(k for k in G.load(root)["knobs"] if k["id"] == "spinoff_min_score")
        G._write_knob(root, k, 5)
        after = p.read_text()
        self.assertEqual(len([1 for a, b in zip(before.splitlines(), after.splitlines()) if a != b]), 1)
        self.assertEqual(json.loads(after)["min_score"], 5)


if __name__ == "__main__":
    unittest.main()

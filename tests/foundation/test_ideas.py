# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import datetime as dt, json, shutil, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import ideas, spinoff  # noqa: E402
from _repo import scratch  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
T = dt.datetime(2026, 11, 17, 21, 30, tzinfo=dt.timezone.utc)


def sandbox():
    d = scratch()
    for f in ("doctrine/spinoff.json", "doctrine/blindspots.json", "doctrine/spinoff-ideas.json", "ops/free-tier.json", "ops/transparency.json", "ops/changelog.json", "spinoffs/registry.json"):
        (d / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / f, d / f)
    (d / "instances/ultrastable").mkdir(parents=True)
    shutil.copy(REPO / "instances/ultrastable/loop-registry.json", d / "instances/ultrastable/loop-registry.json")
    (d / "docs/issues").mkdir(parents=True)
    return d


class Ideas(unittest.TestCase):
    def test_repo_consistent(self):
        self.assertEqual(ideas.check(REPO), [])

    def test_level_follows_the_governor_thresholds(self):
        self.assertEqual(ideas.level_of({"a": {"used": 10, "limit": 100}}), "ok")
        self.assertEqual(ideas.level_of({"a": {"used": 80, "limit": 100}}), "degrade")
        self.assertEqual(ideas.level_of({"a": {"used": 95, "limit": 100}}), "shed")

    def test_cadence_fills_headroom_then_slows_and_stops(self):
        d = sandbox()
        self.assertEqual(ideas.daily_cap(d, T), 3)
        self.assertEqual(ideas.daily_cap(d, T + dt.timedelta(days=3)), 1)  # a stale snapshot is never read as spare room
        s = json.loads((d / "ops/free-tier.json").read_text())
        s["resources"]["d1_rows_read"]["used"] = 4_900_000
        (d / "ops/free-tier.json").write_text(json.dumps(s))
        self.assertEqual(ideas.daily_cap(d, T), 0)

    def test_nothing_is_planned_past_the_reserve(self):
        d = sandbox()
        s = json.loads((d / "ops/free-tier.json").read_text())
        s["resources"]["workers_requests"]["used"] = 74_000  # 75% of the day is the planning ceiling (25% reserve)
        (d / "ops/free-tier.json").write_text(json.dumps(s))
        r = ideas.rank(d, T)
        self.assertTrue(r and not any(i["fits"] for i in r))  # queued, never dropped

    def test_ranked_ideas_are_scored_by_value_over_cost(self):
        r = {i["id"]: i for i in ideas.rank(sandbox(), T)}
        self.assertTrue(r["free-tier-meter"]["fits"])
        self.assertFalse(r["security-txt-writer"]["implemented"])  # high impact, blocked by its archetype: the loop files that as scope
        self.assertGreater(r["numbers-board"]["score"], r["security-txt-writer"]["score"])

    def test_launches_boards_up_to_the_daily_cap_with_facts(self):
        d = sandbox()
        got = [spinoff.launch(d, True, T)["launched"] for _ in range(3)]
        self.assertTrue(all(g and g["archetype"] == "status-board" for g in got))
        self.assertIn("daily launch cap 3", spinoff.launch(d, True, T)["why"])
        b = json.loads((d / "spinoffs/registry.json").read_text())
        self.assertEqual(len(b["boards"]), 3)
        self.assertTrue(all(v["rows"] for v in b["boards"].values()))
        self.assertEqual(spinoff.check(d), [])

    def test_brainstorm_adds_ledger_boards_and_one_scope_item_and_is_idempotent(self):
        d = sandbox()
        (d / "ops").mkdir(exist_ok=True)
        (d / "ops/widgets.jsonl").write_text("".join(json.dumps({"at": "2026-11-17T00:00:00Z", "n": i}) + "\n" for i in range(12)))
        (d / "ops/provenance.jsonl").write_text("".join(json.dumps({"at": "x"}) + "\n" for i in range(12)))
        r = ideas.brainstorm(d, True, T)
        self.assertEqual(r["new_ideas"], ["board-widgets"])  # a private ledger is never shown
        self.assertEqual(len(r["scope_items"]), 1)
        self.assertEqual(ideas.brainstorm(d, True, T)["new_ideas"], [])
        self.assertEqual(ideas.resolve_fact(d, {"path": "ops/widgets.jsonl", "kind": "jsonl", "rows": [{"label": "n", "ptr": "#lines"}]})["rows"][0]["value"], 12)

    def test_a_board_of_a_missing_source_shows_unmeasured_not_zero(self):
        r = ideas.resolve_fact(sandbox(), {"path": "ops/none.json", "rows": []})
        self.assertEqual(r["rows"], [])
        self.assertIn("error", r)

    def test_roadmap_is_generated_and_a_malformed_file_fails_the_check(self):
        d = sandbox()
        (d / "site").mkdir()
        ideas.write_roadmap(d)
        self.assertEqual(ideas.check(d), [])
        p = d / "site/spinoff-roadmap-data.js"
        p.write_text("export default {};\n")
        self.assertTrue(any("malformed" in b for b in ideas.check(d)))

    def test_token_is_never_leaked_and_no_token_keeps_the_snapshot(self):
        d = sandbox()
        self.assertFalse(ideas.refresh_headroom(d, True, T, token="")["refreshed"])
        def boom(q):
            raise OSError("auth failed for tok-SECRET")
        r = ideas.refresh_headroom(d, True, T, fetch=boom, token="tok-SECRET")
        self.assertFalse(r["refreshed"])
        self.assertNotIn("tok-SECRET", json.dumps(r))


if __name__ == "__main__":
    unittest.main()

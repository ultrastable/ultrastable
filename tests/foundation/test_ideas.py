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
    for f in ("doctrine/spinoff.json", "doctrine/blindspots.json", "doctrine/spinoff-ideas.json", "ops/free-tier.json", "ops/transparency.json", "ops/changelog.json", "spinoffs/registry.json", "spinoffs/live.js"):
        (d / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / f, d / f)
    # The cadence tests state their own spare-room snapshot at T: reading the committed ops/free-tier.json made them depend on the
    # live account's usage today (it was at 6x its D1 read limit, so the level read shed and the cap read 0).
    snap = {"at": T.strftime("%Y-%m-%dT%H:%M:%SZ"), "resources": {
        "d1_rows_read": {"used": 100_000, "limit": 5_000_000, "basis": "measured"},
        "d1_rows_written": {"used": 1_000, "limit": 100_000, "basis": "measured"},
        "workers_requests": {"used": 1_000, "limit": 100_000, "basis": "measured"},
        "ai_neurons": {"used": 100, "limit": 10_000, "basis": "measured"}}}
    (d / "ops/free-tier.json").write_text(json.dumps(snap))
    (d / "instances/ultrastable").mkdir(parents=True)
    shutil.copy(REPO / "instances/ultrastable/loop-registry.json", d / "instances/ultrastable/loop-registry.json")
    for s in ("base-rates", "did-it-work", "open-questions"):  # DEPTH-1 seeds
        (d / "instances" / s).mkdir(parents=True)
        shutil.copy(REPO / "instances" / s / "IDEA.md", d / "instances" / s / "IDEA.md")
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
        self.assertTrue(r and not any(i["fits"] for i in r if i.get("kind") == "spinoff"))  # queued, never dropped

    def test_ranked_ideas_are_scored_by_value_over_cost(self):
        r = {i["id"]: i for i in ideas.rank(sandbox(), T)}
        self.assertFalse(r["free-tier-meter"]["fits"])  # DEPTH-1: a board is a cheap thrill and never launches
        self.assertIn("thesis", r["free-tier-meter"]["depth"]["missing"])
        self.assertFalse(r["security-txt-writer"]["implemented"])  # high impact, blocked by its archetype: the loop files that as scope
        self.assertGreater(r["numbers-board"]["score"], r["security-txt-writer"]["score"])

    def test_no_shallow_board_or_lookup_launches(self):
        d = sandbox()
        got = [spinoff.launch(d, True, T).get("launched") for _ in range(3)]
        self.assertFalse(any(got))  # DEPTH-1: lookups and boards stay queued; deep ideas go through the seed pipeline
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

    def test_scope_items_carry_a_probe_on_code_never_one_on_their_own_issue_file(self):
        # PROBE-REAL-1: `grep:docs/issues/<id>.json::Status:** closed` passes the moment the item is marked closed and proves nothing
        self.assertIsNone(ideas.scope_probe({"probe": "grep:docs/issues/Q-SPIN-X.json::Status:\\*\\* closed"}))
        self.assertIsNone(ideas.scope_probe({}))
        self.assertEqual(ideas.scope_probe({"probe": "file:spinoffs/worker.js"}), "file:spinoffs/worker.js")
        self.assertTrue(all(ideas.scope_probe(s) for s in json.loads((REPO / "doctrine/spinoff-ideas.json").read_text())["scope_templates"]))
        d = sandbox()
        r = ideas.brainstorm(d, True, T)
        for iid in r["scope_items"]:
            body = json.loads((d / "docs/issues" / f"{iid}.json").read_text())["body"]
            self.assertNotIn("docs/issues/", body)
            want = next(s["probe"] for s in json.loads((d / "doctrine/spinoff-ideas.json").read_text())["scope_templates"] if "Q-SPIN-" + s["id"].upper() == iid)
            self.assertIn("**Closing probe:** " + want, body)

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

    def test_tick_samples_read_through_the_oidc_route_when_the_secret_is_refused(self):
        """FREE-TIER-ROUTE-1: the same select-only read, through a call that needs no stored secret."""
        seen = []
        def call(path, body=None):
            seen.append(path)
            if body is None:
                return {"result": [{"uuid": "u-1"}]}
            return {"result": [{"results": [{"resource": "d1_rows_read", "u": 1200000}, {"resource": "ai_neurons", "u": 9}]}]}
        self.assertEqual(ideas._tick_samples("acct", "", T, call=call), {"d1_rows_read": 1200000})
        self.assertEqual(seen, ["?name=ultrastable-org", "/u-1/query"])


if __name__ == "__main__":
    unittest.main()


def test_live_public_benefit_ideas_have_sources_and_pass_the_gate():
    """SPINOFF-GOOD-1: the four public-benefit ideas are live archetypes with a source in spinoffs/live.js and clear the safety gate."""
    from foundation import ideas, spinoff
    live = [i for i in ideas.ideas() if i.get("live")]
    assert {i["id"] for i in live} >= {"country-snapshot", "air-quality", "quake-watch", "access-check"}
    assert all(i["archetype"].startswith("live-") for i in live)
    assert ideas.check() == [] and spinoff.check() == []


def test_public_benefit_score_prefers_global_reach_and_treats_unmeasured_use_as_neutral():
    """BENEFIT-1: region x need x use; a single-country idea scores 0.4 of a global one with the same need, and no use data never scores zero."""
    from foundation import ideas
    cfg = ideas.load()
    g = ideas.benefit(REPO, cfg, {"id": "zz-a", "regions": "global", "need": 4})
    one = ideas.benefit(REPO, cfg, {"id": "zz-b", "regions": ["US"], "need": 4})
    two = ideas.benefit(REPO, cfg, {"id": "zz-c", "regions": ["US", "CA"], "need": 4})
    assert g == 20.0 and one == 8.0 and two == 14.0
    assert ideas.benefit(REPO, cfg, {"id": "old", "reach": 3}) is None


class Depth(unittest.TestCase):
    """DEPTH-1 (Rowan, 2026-11-22): a self-chosen app needs the depth of Unlearn and Practical Solutions."""

    def test_lookup_is_refused_and_seed_clears_the_bar(self):
        from foundation import ideas as I
        cfg = I.load()
        shallow = {"id": "x", "archetype": "live-lookup", "thesis": "t" * 60, "corpus": "c" * 60, "loop": "l" * 60, "returns": "r" * 60, "hook": "h" * 60, "public_good": "p" * 60, "horizon": ["a", "b", "c"], "change": ["guess-first", "outside-view", "implementation-intention"]}
        self.assertFalse(I.depth(cfg, shallow)["ok"])
        self.assertFalse(I.depth(cfg, {"id": "y", "kind": "seed", "thesis": "too short"})["ok"])
        shop = {**shallow, "archetype": None, "tagline": "A bakery and ordering site with checkout"}
        self.assertTrue(I.depth(cfg, shop)["commerce"])
        self.assertFalse(I.depth(cfg, shop)["ok"])
        self.assertFalse(I.depth(cfg, {**shallow, "archetype": None, "hook": ""})["ok"])
        self.assertTrue(I.depth(cfg, {**shallow, "archetype": None})["ok"])
        self.assertIn("change", I.depth(cfg, {**shallow, "archetype": None, "change": ["guess-first", "outside-view"]})["missing"])  # CHANGE-1: no act step
        self.assertIn("change", I.depth(cfg, {**shallow, "archetype": None, "change": ["guess-first", "outside-view", "made-up"]})["missing"])
        seeds = [i for i in I.ideas() if i.get("kind") == "seed"]
        self.assertGreaterEqual(len(seeds), 3)
        for i in seeds:
            self.assertTrue(I.depth(cfg, i)["ok"], i["id"])

    def test_no_shallow_app_stays_live_and_none_launches(self):
        from foundation import ideas as I
        self.assertEqual(I.shallow_live(), [])
        self.assertTrue(all(i["depth"]["ok"] for i in I.rank() if i["fits"]))

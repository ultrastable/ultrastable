"""GROWTH-2 and CLOCKWORK-2: targets, experiments, knobs, filing; per-stage freshness, settlement by name, escalation. Injected measurements, temp repositories, no network."""
import json, shutil, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import pm, clock, clockwork as W, growth as G  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
START = pm._ts("2026-11-12T00:00:00Z")
DAY = 86400


def temp_root():
    r = scratch()
    (r / "doctrine").mkdir()
    for f in ("growth.json", "knobs.json", "clocks.json"):
        shutil.copy2(REPO / "doctrine" / f, r / "doctrine" / f)
    # The product manager tunes this knob on main; the tests pin their own starting value so a live change cannot fail them.
    c = json.loads((r / "doctrine/clocks.json").read_text()); c["chain"]["max_runs_per_day"] = 4
    (r / "doctrine/clocks.json").write_text(json.dumps(c))
    (r / "docs/issues").mkdir(parents=True)
    return r


def item(root, iid, status="open", labels=("p1", "growth"), metric="agent_hits_7d", pct=15):
    body = f"**Owner:** product-manager\n**Trigger:** t\n**Done check:** file:x\n**Status:** {status}\n\nMetric moved: {metric}. Prediction: {metric} rises at least {pct} percent."
    (root / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "title": iid, "body": body, "labels": list(labels)}))


OK = {"pageviews_7d": 1600, "visitors_7d": 700, "pilot_page_views_7d": 450, "growth_share": 0.45, "takeable": 3, "executor_merged_7d": 1}
VALS0 = {"pageviews_7d": 1310, "visitors_7d": 564, "agent_hits_7d": 817, "pilot_page_views_7d": 326, "growth_share": 0.45, "takeable": 3, "executor_merged_7d": 1}


class Targets(unittest.TestCase):
    def test_trajectory_line_and_behind(self):
        cfg = G.load(REPO)
        m = cfg["metrics"][2]   # agent hits: baseline 817 -> 1000 over 28 days
        half = pm.trajectory(m, cfg, 850, START + 14 * DAY)
        self.assertAlmostEqual(half["expected_today"], 908.5, places=1)
        self.assertTrue(half["behind"])
        self.assertFalse(pm.trajectory(m, cfg, 880, START + 14 * DAY)["behind"])
        self.assertIsNone(pm.trajectory(m, cfg, None, START)["behind"])


class Filing(unittest.TestCase):
    def test_behind_metrics_get_the_next_idea_once(self):
        r = temp_root()
        vals = {**OK, "agent_hits_7d": 800}
        rep = pm.run(r, apply=True, now=START + 14 * DAY, use_live=False, vals=vals, stage_rows=[])
        self.assertEqual(rep["filed"]["growth"], ["Q-GROW-MARKDOWN-PAGES"])
        j = json.loads((r / "docs/issues/Q-GROW-MARKDOWN-PAGES.json").read_text())
        self.assertIn("growth", j["labels"]); self.assertIn("Metric moved: agent_hits_7d", j["body"])
        again = pm.run(r, apply=True, now=START + 14 * DAY, use_live=False, vals=vals, stage_rows=[])
        self.assertEqual(again["filed"]["growth"], [])      # an open growth item for that metric exists: do not pile on
        self.assertFalse((r / pm.REPORT).exists())     # a quiet pass writes no report file: nothing to commit, no daily pull request

    def test_replaced_experiment_files_the_next_idea_not_the_same(self):
        r = temp_root()
        item(r, "Q-GROW-MARKDOWN-PAGES", status="closed")
        vals = {**OK, "agent_hits_7d": 820}                # +0.4 percent against a 15 percent prediction
        pm.run(r, apply=True, now=START + 1 * DAY, use_live=False, vals={**OK, "agent_hits_7d": 817}, stage_rows=[])           # registers the experiment at baseline 817
        rep = pm.run(r, apply=True, now=START + 9 * DAY, use_live=False, vals=vals, stage_rows=[])
        self.assertEqual(rep["experiments"][0]["verdict"], "replace")
        self.assertEqual(rep["filed"]["growth"], ["Q-GROW-AGENT-DOCS"])

    def test_weekly_report_once_a_week_with_deltas_and_three_untried_experiments(self):
        r = temp_root()
        item(r, "Q-GROW-MARKDOWN-PAGES", status="closed")
        pm.run(r, apply=True, now=START + 1 * DAY, use_live=False, vals={**OK, "agent_hits_7d": 817}, stage_rows=[])
        w1 = json.loads((r / "ops/growth/weekly.json").read_text())
        self.assertEqual(len(w1["next_experiments"]), 3)
        self.assertNotIn("Q-GROW-MARKDOWN-PAGES", [n["item"] for n in w1["next_experiments"]], "a running experiment is not proposed again")
        self.assertRegex(w1["next_experiments"][0]["prediction"], r"^\w+ >= \d+ within 168 h$")
        again = pm.run(r, apply=True, now=START + 1 * DAY + 3600, use_live=False, vals={**OK, "agent_hits_7d": 900}, stage_rows=[])
        self.assertEqual(again["weekly"]["generated"], w1["generated"], "one report per week")
        rep = pm.run(r, apply=True, now=START + 9 * DAY, use_live=False, vals={**OK, "agent_hits_7d": 820, "pageviews_7d": 1760}, stage_rows=[])
        w2 = rep["weekly"]
        self.assertEqual(w2["previous_week"], w1["week"])
        self.assertEqual(next(m for m in w2["metrics"] if m["id"] == "pageviews_7d")["delta_pct"], 10.0)
        self.assertEqual([(v["item"], v["verdict"]) for v in w2["verdicts"]], [("Q-GROW-MARKDOWN-PAGES", "replace")])
        self.assertNotIn("Q-GROW-MARKDOWN-PAGES", [n["item"] for n in w2["next_experiments"]], "a replaced experiment is replaced, not repeated")
        r2 = temp_root()
        un = pm.run(r2, apply=True, now=START + DAY, use_live=False, vals={"growth_share": 0.45, "takeable": 0}, stage_rows=[])
        self.assertTrue(un["weekly"]["unmeasured"]); self.assertFalse((r2 / "ops/growth/weekly.json").exists())

    def test_kept_experiment(self):
        ex = [{"item": "X", "metric": "agent_hits_7d", "baseline": 800, "predicted_pct": 15, "started": "2026-11-12T00:00:00Z", "check_after_days": 7, "verdict": None}]
        self.assertEqual(pm.review_experiments(ex, {"agent_hits_7d": 1000}, START + 8 * DAY)[0]["verdict"], "kept")
        ex[0]["verdict"] = None
        self.assertEqual(pm.review_experiments(ex, {"agent_hits_7d": 1000}, START + 8 * DAY, guards_ok=False)[0]["verdict"], "replace")
        ex[0]["verdict"] = None
        self.assertIsNone(pm.review_experiments(ex, {"agent_hits_7d": 1000}, START + 3 * DAY)[0]["verdict"])   # not due yet

    def test_repair_item_only_at_the_incident_step(self):
        r = temp_root()
        ladder = clock.load(REPO)["escalation"]
        rows = [{"id": "merge", "what": "merged", "status": "stale", "missed": 2, "age_s": 9, "sla_s": 3}, {"id": "deploy", "what": "deployed", "status": "expired", "missed": 5, "age_s": 9, "sla_s": 1}]
        self.assertEqual(pm.file_repairs(r, rows, ladder), ["Q-REPAIR-STAGE-DEPLOY"])
        self.assertIn("p0", json.loads((r / "docs/issues/Q-REPAIR-STAGE-DEPLOY.json").read_text())["labels"])
        self.assertEqual(pm.file_repairs(r, rows, ladder), [])


class Knobs(unittest.TestCase):
    def knob(self, r, kid):
        return next(k for k in json.loads((r / "doctrine/knobs.json").read_text())["knobs"] if k["id"] == kid)

    def test_bounds_are_enforced_and_changes_are_logged(self):
        r = temp_root(); k = self.knob(r, "chain_max_runs_per_day")
        self.assertFalse(pm.set_knob(r, k, 99, "x", "y", 0, START)["changed"])
        self.assertTrue(pm.set_knob(r, k, 5, "x", "y", 0, START)["changed"])
        self.assertEqual(json.loads((r / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"], 5)
        self.assertEqual(len(pm.knob_log(r)), 1)

    def test_tune_raises_runs_when_work_waits_then_waits_a_week_then_reverts_if_no_gain(self):
        r = temp_root()
        state = {"takeable": 9, "executor_merged_7d": 0, "growth_share": 0.4}
        self.assertEqual(pm.tune(r, state, START)["changed"]["new"], 5)
        self.assertIsNone(pm.tune(r, state, START + 2 * DAY)["changed"])       # one change a week
        rv = pm.tune(r, state, START + 8 * DAY)                                  # merged is still 0: an added-capacity knob must move its metric
        self.assertFalse(rv["reviewed"]["kept"])
        self.assertEqual(json.loads((r / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"], 4)

    def test_a_knob_that_helped_is_kept(self):
        r = temp_root(); k = self.knob(r, "chain_max_runs_per_day")
        pm.set_knob(r, k, 5, "x", "y", 0, START)
        rv = pm.tune(r, {"executor_merged_7d": 2}, START + 8 * DAY)
        self.assertTrue(rv["reviewed"]["kept"])
        self.assertEqual(pm.knob_log(r)[-1]["reviewed"], "kept")
        self.assertEqual(json.loads((r / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"], 5)

    def test_review_reverts_when_the_metric_got_worse(self):
        r = temp_root(); k = self.knob(r, "chain_max_runs_per_day")
        pm.set_knob(r, k, 5, "x", "y", 3, START)
        rv = pm.tune(r, {"executor_merged_7d": 1}, START + 8 * DAY)
        self.assertFalse(rv["reviewed"]["kept"])
        self.assertEqual(json.loads((r / "doctrine/clocks.json").read_text())["chain"]["max_runs_per_day"], 4)


class Clockwork(unittest.TestCase):
    def test_item_name_from_title_or_branch(self):
        self.assertEqual(W.item_name({"title": "Serve a feed (#Q-10)", "headRefName": "agent/x"}), "Q-10")
        self.assertEqual(W.item_name({"title": "no name", "headRefName": "agent/Q-SYS-TOPOLOGY-build", "number": 7}), "Q-SYS-TOPOLOGY")
        self.assertEqual(W.item_name({"title": "no name", "headRefName": "x", "number": 7}), "unnamed-7")

    def test_stage_freshness_idle_missing_stale_expired(self):
        c = {"id": "s", "what": "w", "sla_s": 100, "needs_work": True}
        self.assertEqual(W.stage_state(c, 950, 1000, True)["status"], "fresh")
        self.assertEqual(W.stage_state(c, 800, 1000, True)["status"], "stale")
        self.assertEqual(W.stage_state(c, 100, 1000, True)["status"], "expired")
        self.assertEqual(W.stage_state(c, None, 1000, True)["status"], "missing")
        self.assertEqual(W.stage_state(c, None, 1000, False)["status"], "idle")
        self.assertEqual(W.stage_state(c, 700, 1000, True)["missed"], 3)

    def test_settlement_by_name(self):
        base = "2026-11-12T00:00:00Z"
        prs = [{"number": 1, "title": "a (#Q-1)", "state": "MERGED", "createdAt": base, "mergedAt": base, "headRefName": "agent/Q-1-x"},
               {"number": 2, "title": "b (#Q-2)", "state": "CLOSED", "createdAt": base, "mergedAt": None, "headRefName": "agent/Q-2-x"},
               {"number": 3, "title": "c (#Q-3)", "state": "OPEN", "createdAt": base, "mergedAt": None, "headRefName": "agent/Q-3-x"},
               {"number": 4, "title": "d (#Q-4)", "state": "OPEN", "createdAt": "2026-11-12T11:00:00Z", "mergedAt": None, "headRefName": "agent/Q-4-x"}]
        now = pm._ts("2026-11-12T12:00:00Z")
        s = W.settlement(temp_root(), now, prs)
        self.assertEqual({n: v["state"] for n, v in s["names"].items() if n.startswith("Q-")}, {"Q-1": "merged", "Q-2": "closed", "Q-3": "expired", "Q-4": "open"})
        self.assertEqual({u["name"] for u in s["unsettled"]}, {"Q-3", "Q-4"})

    def test_escalation_ladder_is_stateless_and_ordered(self):
        ladder = clock.load(REPO)["escalation"]
        plan = {p["id"]: p["action"] for p in W.escalation_plan([{"id": "a", "missed": 1}, {"id": "b", "missed": 2}, {"id": "c", "missed": 3}, {"id": "d", "missed": 9}], ladder)}
        self.assertEqual(plan, {"a": "catch-up", "b": "mutate", "c": "mutate", "d": "incident"})

    def test_heal_plans_without_applying(self):
        st = [{"id": "author", "status": "stale", "missed": 2, "what": "w", "age_s": 1, "sla_s": 1}, {"id": "heartbeat", "status": "fresh", "missed": 0}]
        r = W.heal(REPO, apply=False, st=st, sett={"unsettled": [], "names": {}, "counts": {}})
        self.assertEqual([a["action"] for a in r["actions"]], ["mutate"])
        self.assertFalse(r["actions"][0]["done"])

    def test_an_unmeasured_clock_is_not_a_missing_stage(self):
        import unittest.mock as m
        with m.patch.object(clock, "report", return_value=[{"id": "tick-heartbeat", "status": "unmeasured", "why": "no token"}]), m.patch.object(clock, "gh_run_beats", return_value=[]),              m.patch.object(W, "_gh_json", return_value=[]):
            st = {s["id"]: s for s in W.stages(REPO, now=1e9, prs=[])}
        self.assertEqual(st["heartbeat"]["status"], "unmeasured")
        self.assertEqual(st["heartbeat"]["missed"], 0)

    def test_heal_steps_carry_the_cloudflare_token(self):
        for f in ("product-manager.yml", "executor.yml", "lane.yml"):
            t = (REPO / ".github/workflows" / f).read_text(encoding="utf-8")
            i = t.index("run: python3 -m foundation clock --heal --apply")
            self.assertIn("CLOUDFLARE_API_TOKEN", t[i:i + 400], f)

    def test_a_pm_pull_request_is_not_mistaken_for_an_executor_change(self):
        src = (REPO / "foundation/executor.py").read_text(encoding="utf-8")
        i = src.index("def publish_change")
        self.assertNotIn("Executor run", src[i:src.index("def gh_json")])

    def test_publish_change_kicks_checks_without_a_name_error(self):
        """PM-PUBLISH-1: run 44346775629 died with NameError ('remote' undefined) after the PR was opened, so every product manager pass ended red."""
        from foundation import executor
        calls = []
        def fake(argv, root=None, *a, **k):
            calls.append(argv)
            return (0, "https://github.com/x/y/pull/1" if argv[:3] == ["gh", "pr", "create"] else "")
        old = executor.sh
        executor.sh = fake
        try:
            res = executor.publish_change("x/y", ".", "agent/pm-x", "s", "b")
        finally:
            executor.sh = old
        self.assertEqual(res["pr"], "https://github.com/x/y/pull/1")
        self.assertTrue(any(c[:3] == ["gh", "workflow", "run"] and c[3] == "checks.yml" for c in calls))

    def test_workflows_run_heal_and_pm(self):
        ex = (REPO / ".github/workflows/executor.yml").read_text(encoding="utf-8")
        self.assertIn("foundation clock --heal --apply", ex)
        pmw = (REPO / ".github/workflows/product-manager.yml").read_text(encoding="utf-8")
        self.assertIn("foundation pm --run --apply --pr", pmw)
        self.assertIn("foundation clock --heal --apply", pmw)
        lane = (REPO / ".github/workflows/lane.yml").read_text(encoding="utf-8")  # Q-CLOCK-LANE-HOOK: a stale stage is caught within one merge cycle
        i = lane.index("foundation clock --heal --apply")
        self.assertIn("timeout-minutes", lane[lane.rindex("- name:", 0, i):i])


if __name__ == "__main__":
    unittest.main()


class GrowthStarve(unittest.TestCase):
    def test_unmeasured_metrics_file_growth_when_share_below_target(self):
        import time
        from foundation import pm
        vals = {"pageviews_7d": None, "visitors_7d": None, "agent_hits_7d": None, "pilot_page_views_7d": None}
        tgt = pm.targets(pm.REPO, vals, time.time())
        # SELFTEST-1: read no live queue. Against main's docs/issues this went red exactly when the product manager had already filed the
        # items, so every product-manager PR (2080, 2087) failed CI and was superseded, and the loop that refills the queue never landed.
        from unittest import mock
        with mock.patch.object(pm, "_items", return_value=[]), mock.patch.object(pm, "_item_exists", return_value=False):
            self.assertEqual(pm.file_growth(pm.REPO, tgt, [], write=False), [])
            self.assertTrue(pm.file_growth(pm.REPO, tgt, [], write=False, growth_share=0.0))

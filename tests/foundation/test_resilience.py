# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, shutil, unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _repo  # noqa: E402
from foundation import resilience as R

REPO = Path(__file__).resolve().parents[2]
NOW = 1_800_000_000.0


class T(unittest.TestCase):
    def setUp(self):
        self.d = _repo.scratch()
        for f in ("doctrine/resilience.json", "doctrine/clocks.json"):
            (self.d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(REPO / f, self.d / f)
        shutil.copytree(REPO / ".github/workflows", self.d / ".github/workflows")
        (self.d / "docs/issues").mkdir(parents=True); (self.d / "ops").mkdir()
        self.pokes, self.runs = [], []

    def beats(self, stale):
        """Every clock ticks, except those named in `stale` (their last beat is ten intervals old)."""
        def f(c):
            if c["source"] == "d1":
                return [] if c["id"] in stale else [NOW - 5]
            return [NOW - 10 * c["expected_interval_s"]] if c["id"] in stale else [NOW - 5]
        return f

    def run_(self, stale, poke_status=200, dispatch_ok=True, now=NOW):
        def poke(u): self.pokes.append(u); return poke_status
        def dispatch(w, root=None): self.runs.append(w); return dispatch_ok, "ok" if dispatch_ok else "HTTP 403"
        return R.run(self.d, True, now, self.beats(stale), poke, dispatch)

    def test_repo_check(self):
        self.assertEqual(R.check(REPO), [])

    def test_cron_intervals(self):
        self.assertEqual(R.cron_interval_s("23 */6 * * *"), 21600)
        self.assertEqual(R.cron_interval_s("*/10 * * * *"), 600)
        self.assertEqual(R.cron_interval_s("17 6 * * *"), 86400)
        self.assertEqual(R.cron_interval_s("0 5 * * 1"), 604800)
        self.assertEqual(R.cron_interval_s("7 * * * *"), 3600)

    def test_every_scheduled_workflow_is_a_clock(self):
        ids = {c.get("workflow") for c in R.all_clocks(REPO) if c["source"] == "workflow"}
        self.assertTrue({w["workflow"] for w in R.scheduled_workflows(REPO)} <= ids)
        self.assertIn("watchdog", ids)

    def test_healthy_run_restarts_nothing_and_beats_zero(self):
        r = self.run_(set())
        self.assertEqual(r["restarts"], []); self.assertEqual(r["beat"]["stalled"], 0)
        self.assertEqual(R.stalled_reading(self.d, NOW + 60), 0)

    def test_a_declared_manager_workflow_clock_is_restarted_under_its_own_id(self):
        """MANAGERS-1: a scheduled manager workflow declared in doctrine/clocks.json keeps the watchdog's restart, under its declared id."""
        ids = {c["id"] for c in R.all_clocks(self.d)}
        self.assertIn("cost-guard", ids); self.assertNotIn("wf:cost-guard", ids)
        r = self.run_({"cost-guard"})
        self.assertEqual(self.runs, ["cost-guard"]); self.assertEqual(r["restarts"][0]["route"], "workflow_dispatch")

    def test_stalled_workflow_is_dispatched_and_recorded(self):
        r = self.run_({"wf:failure-audit"})
        self.assertEqual(self.runs, ["failure-audit"]); self.assertTrue(r["restarts"][0]["ok"]); self.assertEqual(r["beat"]["stalled"], 1)
        rows = [json.loads(x) for x in (self.d / "ops/resilience.jsonl").read_text().splitlines()]
        self.assertEqual([x["kind"] for x in rows], ["restart", "beat"])

    def test_stalled_tick_is_woken_on_every_account_until_one_answers(self):
        self.run_({"tick-heartbeat"}, poke_status=503)
        self.assertEqual(len(self.pokes), 2)  # both independent accounts tried
        self.pokes.clear(); self.run_({"tick-heartbeat"}, poke_status=200, now=NOW + 60)
        self.assertEqual(len(self.pokes), 1)  # first account answered; no need for the second

    def test_restart_is_bounded_per_day_and_escalates_after_failures(self):
        for i in range(3):
            self.run_({"wf:failure-audit"}, dispatch_ok=False, now=NOW + i * 600)
        self.assertEqual(len(self.runs), 3)
        r = self.run_({"wf:failure-audit"}, dispatch_ok=False, now=NOW + 3000)
        self.assertEqual(len(self.runs), 3); self.assertIn("cap", r["skipped"][0]["why"])  # the fourth is over the daily cap
        item = json.loads((self.d / "docs/issues/Q-STALL-wf-failure-audit.json").read_text())
        self.assertIn("p0", item["labels"]); self.assertIn("resilience --probe wf:failure-audit", item["body"])

    def test_unmeasured_is_never_restarted_and_never_healthy(self):
        r = R.run(self.d, True, NOW, lambda c: None, lambda u: 200, lambda w, root=None: (True, ""))
        self.assertEqual(self.runs, [])
        self.assertTrue(all(c["status"] == "unmeasured" for c in r["clocks"]))
        idem = {k for k, v in json.loads((self.d / "doctrine/resilience.json").read_text())["restart_routes"].items() if v.get("kind") == "http" and v.get("idempotent")}
        self.assertEqual(len([x for x in r["restarts"] if x["clock"] not in idem]), 0)  # idempotent http wakes only (each runs only when its clock is stale)

    def test_halt_stops_restarts(self):
        (self.d / "ops/halt.json").write_text('{"halt": true}')
        r = self.run_({"wf:failure-audit"})
        self.assertEqual(self.runs, []); self.assertIn("halt", r["skipped"][0]["why"])

    def test_silent_watchdog_reads_unmeasured(self):
        self.run_(set())
        self.assertEqual(R.stalled_reading(self.d, NOW + 3600), 0)
        self.assertIsNone(R.stalled_reading(self.d, NOW + 86400))  # beat older than beat_fresh_s

    def test_watchers_watch_each_other(self):
        cfg = R.load(REPO)
        by = {w["id"]: w for w in cfg["watchers"]}
        for w in by.values():
            self.assertNotEqual(w["watched_by"], w["id"]); self.assertNotEqual(by[w["watched_by"]]["host"], w["host"] if w["host"] == "github-actions" else None)
        self.assertEqual({w["host"] for w in by.values()}, {"github-actions", "cloudflare-worker"})


class Truth(T):
    def test_a_200_that_does_not_restart_the_clock_escalates(self):
        for i in range(3):
            self.run_({"tick-heartbeat"}, poke_status=200, now=NOW + i * 600)
        self.assertTrue((self.d / "docs/issues/Q-STALL-tick-heartbeat.json").exists())

    def test_d1_clock_reads_every_account(self):
        from foundation import clock as C
        seen = []
        orig = C.d1_beats
        try:
            def fake(c, tok, acct):
                seen.append(acct)
                if acct == "dead":
                    raise OSError("x")
                return [NOW]
            C.d1_beats = fake
            c = {"d1_id": "a", "replicas": [{"account_id": "dead", "d1_id": "a"}, {"account_id": "live", "d1_id": "b"}]}
            self.assertEqual(C.d1_beats_any(c, "t", "x"), [NOW]); self.assertEqual(seen, ["dead", "live"])
            C.d1_beats = lambda *a: (_ for _ in ()).throw(OSError("x"))
            with self.assertRaises(RuntimeError):
                C.d1_beats_any(c, "t", "x")
        finally:
            C.d1_beats = orig

    def test_unchanged_run_is_not_committed(self):
        self.run_(set())
        self.assertFalse(self.run_(set(), now=NOW + 60)["changed"])
        self.assertTrue(self.run_({"wf:failure-audit"}, now=NOW + 120)["changed"])

    def test_repo_d1_clocks_are_in_the_ultrastable_account_only(self):
        # SINGLE-ACCOUNT-1 (2026-11-18): the quniverse standby replica is gone; every beat source is in the ultrastable account.
        import json as j
        for c in j.loads((REPO / "doctrine/clocks.json").read_text())["clocks"]:
            if c["source"] == "d1":
                self.assertEqual({r["account_id"] for r in c["replicas"]}, {"81e3a4efb4eb66e613529b87682911bb"})


class Health(T):
    def test_health_urls_need_no_credential(self):
        got = R.health_beats(["a", "b"], lambda u: {"last_tick": {"started_at": "2026-11-17 18:30:34"}} if u == "b" else None)
        self.assertEqual(len(got), 1)
        self.assertIsNone(R.health_beats(["a"], lambda u: None))
        self.assertEqual(R.health_beats(["a"], lambda u: {"ok": False}), [])

    def test_repo_tick_clock_health_urls_are_in_the_ultrastable_account(self):
        # SINGLE-ACCOUNT-1: the second route is the site worker's watchTick (doctrine/resilience.json restart_routes), not a quniverse URL.
        import json as j
        c = next(x for x in j.loads((REPO / "doctrine/clocks.json").read_text())["clocks"] if x["id"] == "tick-heartbeat")
        self.assertTrue(c["health_urls"])
        self.assertTrue(all(u.endswith(".ultrastable.workers.dev/health") for u in c["health_urls"]))


class SiteProbe(unittest.TestCase):
    def test_503_redeploys_and_200_is_quiet(self):
        cfg = {"site_probes": [{"id": "s", "url": "u", "repo": "o/r", "workflow": "deploy-tenant"}], "max_restarts_per_clock_per_day": 3}
        calls = []
        bad = R.site_probes(cfg, [], 1.0, True, None, get=lambda u: 503, dispatch=lambda r, w: (calls.append((r, w)) or (True, "")))
        self.assertEqual(calls, [("o/r", "deploy-tenant")]); self.assertTrue(bad[0]["redeploy"])
        calls.clear()
        good = R.site_probes(cfg, [], 1.0, True, None, get=lambda u: 200, dispatch=lambda r, w: calls.append(1))
        self.assertTrue(good[0]["ok"]); self.assertEqual(calls, [])


class WorkNotPulse(T):
    """A failed run is not a beat, a weekly loop restarts inside two weeks, and the budget pause exempts a public repository."""
    DAY = 86400

    def test_failed_run_is_not_a_beat_for_a_success_clock(self):
        iso = lambda t: R._iso(t)
        runs = [{"createdAt": iso(NOW - 2 * self.DAY), "status": "completed", "conclusion": "failure"},
                {"createdAt": iso(NOW - 9 * self.DAY), "status": "completed", "conclusion": "success"}]
        scout = next(c for c in R.all_clocks(REPO) if c["id"] == "scout")
        self.assertEqual(scout["beat"], "success")
        self.assertEqual(R.run_beats(scout, runs), [NOW - 9 * self.DAY])
        self.assertEqual(len(R.run_beats({"id": "x"}, runs)), 2)  # a clock that does not ask keeps counting every run
        running = [{"createdAt": iso(NOW - 60), "status": "in_progress", "conclusion": ""}]
        self.assertEqual(len(R.run_beats(scout, running)), 1)  # a restart in flight is not restarted again

    def test_scout_is_restarted_after_one_and_a_half_intervals_without_a_success(self):
        cfg = R.load(REPO)
        scout = next(c for c in R.all_clocks(REPO) if c["id"] == "scout")
        self.assertEqual(R.probe(scout, NOW, lambda c: [NOW - 9 * self.DAY], cfg)["status"], "ticking")
        self.assertEqual(R.probe(scout, NOW, lambda c: [NOW - 11 * self.DAY], cfg)["status"], "stopped")
        other = {"id": "o", "source": "workflow", "expected_interval_s": 7 * self.DAY}
        self.assertEqual(R.probe(other, NOW, lambda c: [NOW - 11 * self.DAY], cfg)["status"], "late")  # the default bound is unchanged
        def beats(c):
            return [NOW - 11 * self.DAY] if c["id"] == "scout" else [NOW - 5]
        r = R.run(self.d, True, NOW, beats, lambda u: 200, lambda w, root=None: (self.runs.append(w) or (True, "ok")))
        self.assertEqual(self.runs, ["scout"]); self.assertEqual(r["beat"]["stalled_ids"], ["scout"])

    def test_budget_pause_exempts_a_public_repository_only(self):
        (self.d / "actions-budget.json").write_text(json.dumps({"paused": True, "paused_workflows": []}))
        self.assertEqual(R._paused(self.d, public=False), {"*"})
        self.assertEqual(R._paused(self.d, public=True), set())
        beats = self.beats({"wf:failure-audit"})
        dispatch = lambda w, root=None: (self.runs.append(w) or (True, "ok"))
        r = R.run(self.d, True, NOW, beats, lambda u: 200, dispatch, public=False)
        self.assertEqual(self.runs, []); self.assertEqual(r["skipped"][0]["why"], "paused by actions-budget.json")
        r = R.run(self.d, True, NOW + 1, beats, lambda u: 200, dispatch, public=True)
        self.assertEqual(self.runs, ["failure-audit"])

    def test_scout_commit_step_runs_after_a_failed_step(self):
        y = (REPO / ".github/workflows/scout.yml").read_text(encoding="utf-8")
        tail = y[y.index("- name: Commit findings"):]
        self.assertIn("if: ${{ !cancelled() }}", tail.split("run:")[0])

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import resilience as R

REPO = Path(__file__).resolve().parents[2]
NOW = 1_800_000_000.0


class T(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
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

    def test_stalled_workflow_is_dispatched_and_recorded(self):
        r = self.run_({"wf:cost-guard"})
        self.assertEqual(self.runs, ["cost-guard"]); self.assertTrue(r["restarts"][0]["ok"]); self.assertEqual(r["beat"]["stalled"], 1)
        rows = [json.loads(x) for x in (self.d / "ops/resilience.jsonl").read_text().splitlines()]
        self.assertEqual([x["kind"] for x in rows], ["restart", "beat"])

    def test_stalled_tick_is_woken_on_every_account_until_one_answers(self):
        self.run_({"tick-heartbeat"}, poke_status=503)
        self.assertEqual(len(self.pokes), 2)  # both independent accounts tried
        self.pokes.clear(); self.run_({"tick-heartbeat"}, poke_status=200, now=NOW + 60)
        self.assertEqual(len(self.pokes), 1)  # first account answered; no need for the second

    def test_restart_is_bounded_per_day_and_escalates_after_failures(self):
        for i in range(3):
            self.run_({"wf:cost-guard"}, dispatch_ok=False, now=NOW + i * 600)
        self.assertEqual(len(self.runs), 3)
        r = self.run_({"wf:cost-guard"}, dispatch_ok=False, now=NOW + 3000)
        self.assertEqual(len(self.runs), 3); self.assertIn("cap", r["skipped"][0]["why"])  # the fourth is over the daily cap
        item = json.loads((self.d / "docs/issues/Q-STALL-wf-cost-guard.json").read_text())
        self.assertIn("p0", item["labels"]); self.assertIn("resilience --probe wf:cost-guard", item["body"])

    def test_unmeasured_is_never_restarted_and_never_healthy(self):
        r = R.run(self.d, True, NOW, lambda c: None, lambda u: 200, lambda w, root=None: (True, ""))
        self.assertEqual(self.runs, [])
        self.assertTrue(all(c["status"] == "unmeasured" for c in r["clocks"]))
        self.assertEqual(len([x for x in r["restarts"] if x["clock"] not in ("tick-heartbeat", "criticality-loop")]), 0)  # idempotent tick wakes only

    def test_halt_stops_restarts(self):
        (self.d / "ops/halt.json").write_text('{"halt": true}')
        r = self.run_({"wf:cost-guard"})
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

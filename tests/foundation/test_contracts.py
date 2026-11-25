"""CONTRACTS-1: an item closes only on its own probe, after a recorded failure and two consecutive passes (Q-LESSON-VACUOUS-CLOSE); a relapse
reopens it, and a reopened item closes again only after the hold."""
import json, shutil, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import contracts as C, queue  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

T0 = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)


def item(d, iid, status="open", probe="file:marker.txt"):
    body = f"**Owner:** operations\n**Trigger:** t\n**Done check:** {probe}\n**Status:** {status}\n\nx" + ("\n\n**Evidence:** e\n" if status != "open" else "")
    (d / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "title": iid, "body": body, "labels": []}), encoding="utf-8")


def repo():
    d = scratch()
    (d / "docs/issues").mkdir(parents=True); (d / "doctrine").mkdir(); (d / "ops").mkdir()
    shutil.copy(ROOT / "doctrine/qnfo-port.json", d / "doctrine/qnfo-port.json")
    return d


def status(d, iid):
    return next(i["status"] for i in queue.items(d) if i["id"] == iid)


class Contracts(unittest.TestCase):
    def test_probe_kinds(self):
        d = repo()
        self.assertEqual(C.run_probe(d, "file:nope")[0], "fail")
        (d / "marker.txt").write_text("hello")
        self.assertEqual(C.run_probe(d, "file:marker.txt")[0], "pass")
        self.assertEqual(C.run_probe(d, "grep:marker.txt::hel+o")[0], "pass")
        self.assertEqual(C.run_probe(d, "pending:waiting on the owner card")[0], "deferred")
        self.assertEqual(C.run_probe(d, "probe:python3 -m foundation x")[0], "unusable")
        self.assertEqual(C.run_probe(d, "cmd:rm -rf /")[0], "unusable", "a command outside the allow-list never runs")
        self.assertEqual(C.run_probe(d, "")[0], "unusable")

    def test_closes_after_failure_then_two_passes(self):
        d = repo(); item(d, "OL-1"); item(d, "OL-2", probe="pending:x"); item(d, "OL-3", probe="probe:not-runnable")
        r = C.tick(d, apply=True, now=T0)
        self.assertEqual(status(d, "OL-1"), "open", "failing probe keeps it open")
        (d / "marker.txt").write_text("x")
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=10))
        self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("open", "hold"), "a single pass never closes")
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=20))
        self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("closed", "close"))
        self.assertIn("**Evidence:** closing probe passed", json.loads((d / "docs/issues/OL-1.json").read_text())["body"])
        self.assertEqual(status(d, "OL-2"), "open"); self.assertEqual(status(d, "OL-3"), "open")
        self.assertEqual(r["unusable_open"], ["OL-3"], "a probe that cannot run is a gap, never a pass")
        self.assertEqual(queue.check(d), [], "closed with evidence: the queue check accepts it")

    def test_vacuous_probe_never_closes(self):
        d = repo(); item(d, "OL-1"); (d / "marker.txt").write_text("x")
        for m in (0, 10, 20):
            r = C.tick(d, apply=True, now=T0 + timedelta(minutes=m))
            self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("open", "vacuous"), "a probe never seen failing proves nothing")
        body = json.loads((d / "docs/issues/OL-1.json").read_text())["body"]
        self.assertEqual(body.count("**Vacuous:**"), 1, "marked once, not on every pass")
        self.assertEqual(r["vacuous_open"], ["OL-1"])
        (d / "marker.txt").unlink(); C.tick(d, apply=True, now=T0 + timedelta(minutes=30))
        (d / "marker.txt").write_text("x")
        C.tick(d, apply=True, now=T0 + timedelta(minutes=40)); C.tick(d, apply=True, now=T0 + timedelta(minutes=50))
        self.assertEqual(status(d, "OL-1"), "closed", "once the probe is seen failing, two passes close it")

    def test_lane_filed_pr_item_closes_once_its_pr_closes(self):
        # LANE-FILED-FAIL-1: the lane filed OL-PR-<n> on seeing PR n stuck, so two passes of `loopowner --closed n` close it without the vacuous hold
        d = repo(); item(d, "OL-PR-7", probe="cmd:python3 -m foundation loopowner --closed 7"); item(d, "OL-9", probe="cmd:python3 -m foundation loopowner --closed 9")
        p = lambda spec: ("pass", "pull request is merged")
        C.tick(d, apply=True, now=T0, probe=p); r = C.tick(d, apply=True, now=T0 + timedelta(minutes=10), probe=p)
        self.assertEqual(status(d, "OL-PR-7"), "closed")
        self.assertEqual(status(d, "OL-9"), "open", "only the lane's own PR items carry a recorded failure from filing")

    def test_queue_run_survives_an_unmeasured_balance(self):
        # a shallow checkout leaves balance unmeasured (empty sla); the pass reports it, never crashes and never reads it as balanced
        from unittest import mock
        from foundation import balance
        d = repo(); item(d, "OL-1")
        with mock.patch.object(balance, "run", return_value={"unmeasured": "shallow", "tipped": False, "windows": {}, "sla": {}, "actions": {}}):
            rows = queue.run(d)
        b = next(r for r in rows if r["id"] == "FLOW-BALANCE-1")
        self.assertFalse(b["passed"]); self.assertIn("shallow", b["evidence"])

    def test_single_pass_after_failure_holds(self):
        d = repo(); item(d, "OL-1")
        C.tick(d, apply=True, now=T0)
        (d / "marker.txt").write_text("x")
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=10))
        self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("open", "hold"))
        self.assertIn("1 of 2", r["rows"][0]["why"])
        (d / "marker.txt").unlink(); C.tick(d, apply=True, now=T0 + timedelta(minutes=20))
        (d / "marker.txt").write_text("x")
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=30))
        self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("open", "hold"), "the passes must be consecutive")

    def test_relapse_reopens_and_hold_blocks_flapping_close(self):
        d = repo(); item(d, "OL-1")
        C.tick(d, apply=True, now=T0 - timedelta(minutes=20)); (d / "marker.txt").write_text("x")
        C.tick(d, apply=True, now=T0 - timedelta(minutes=10)); C.tick(d, apply=True, now=T0)
        self.assertEqual(status(d, "OL-1"), "closed")
        (d / "marker.txt").unlink()
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=10))
        self.assertEqual(status(d, "OL-1"), "open")
        self.assertEqual([x["action"] for x in r["rows"]], ["reopen"])
        self.assertEqual(r["reopens"], 1); self.assertEqual(r["relapsed_open"], ["OL-1"])
        self.assertIn("**Relapse:**", json.loads((d / "docs/issues/OL-1.json").read_text())["body"])
        (d / "marker.txt").write_text("x")
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=20))
        self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("open", "hold"), "one pass after a reopen is not enough")
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=40))
        self.assertEqual(r["rows"][0]["action"], "hold", "two passes but spanning 20 of 60 minutes")
        r = C.tick(d, apply=True, now=T0 + timedelta(minutes=85))
        self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("closed", "close"))
        self.assertEqual(r["relapsed_open"], [])

    def test_hold_grows_with_reopens(self):
        c = C.cfg(repo())
        self.assertEqual([C.hold_minutes(n, c) for n in (0, 1, 2, 3, 7)], [0, 60, 60, 120, 120])

    def test_closed_before_contracts_is_baseline_not_reopened(self):
        d = repo(); item(d, "OL-9", status="done")
        r = C.tick(d, apply=True, now=T0)
        self.assertEqual((status(d, "OL-9"), r["rows"][0]["action"]), ("done", "baseline"), "the first run reopens nothing it never saw pass")

    def test_vacuous_item_closes_after_hold(self):
        d = repo(); item(d, "OL-1"); (d / "marker.txt").write_text("x")
        for m in (0, 60 * 24 + 1):
            r = C.tick(d, apply=True, now=T0 + timedelta(minutes=m))
        self.assertEqual((status(d, "OL-1"), r["rows"][0]["action"]), ("closed", "close"), "already-built code closes after the hold")

    def test_dry_run_writes_nothing(self):
        d = repo(); item(d, "OL-1"); (d / "marker.txt").write_text("x")
        r = C.tick(d, apply=False, now=T0)
        self.assertEqual(r["rows"][0]["action"], "vacuous")
        self.assertEqual(status(d, "OL-1"), "open"); self.assertFalse((d / C.LEDGER).exists())

    def test_closed_command_probes_are_budgeted(self):
        d = repo()
        for n in range(8):
            item(d, f"OL-{n}", status="closed", probe="cmd:python3 -m foundation queue --check")
        calls = []
        C.tick(d, apply=True, now=T0, probe=lambda s: calls.append(s) or ("pass", "ok"))
        self.assertEqual(len(calls), C.cfg(d)["relapse_cmd_per_pass"], "relapse re-probing of command probes is capped per pass")

    def test_queue_run_goes_through_contracts(self):
        d = repo(); item(d, "OL-1")
        queue.run(d, apply=True); (d / "marker.txt").write_text("x"); queue.run(d, apply=True)
        rows = queue.run(d, apply=True)
        self.assertEqual((rows[0]["passed"], rows[0]["action"]), (True, "close"))
        self.assertTrue((d / C.LEDGER).exists(), "the executor's queue run leaves contract evidence")


if __name__ == "__main__":
    unittest.main()

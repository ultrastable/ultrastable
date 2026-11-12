"""LIVENESS-1: the probe reads evidence that a loop ran, not that its code exists, and a loop that is not running becomes a queue item."""
import datetime as dt, json, unittest
from _repo import ROOT, copy_repo, edit
from foundation import doctrine, liveness

NOW = dt.datetime(2026, 11, 12, 12, 0, tzinfo=dt.timezone.utc)
ISO = lambda hours_ago: (NOW - dt.timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def api(runs=None, merged=None, status=200):
    def get(path):
        if "/actions/workflows/" in path:
            wf = path.split("/actions/workflows/")[1].split("/")[0]
            return status, {"workflow_runs": (runs or {}).get(wf, [])}
        return status, merged or []
    return get


class Liveness(unittest.TestCase):
    def test_repo_probes_are_well_formed_and_name_real_loops_and_workflows(self):
        self.assertEqual(liveness.check(ROOT), [])
        self.assertGreaterEqual(len(liveness.load(ROOT)["probes"]), 5)

    def test_each_verdict(self):
        P = {"id": "x", "loop": "l", "what": "w", "evidence": "workflow:a.yml", "max_age_hours": 26, "must_succeed": True}
        run = lambda h, c: {"updated_at": ISO(h), "conclusion": c, "run_number": 1}
        v = lambda get: liveness.verdict(P, liveness.evidence(P["evidence"], get, None), NOW)["verdict"]
        self.assertEqual(v(api({"a.yml": [run(2, "success")]})), "alive")
        self.assertEqual(v(api({"a.yml": [run(30, "success")]})), "stale")
        self.assertEqual(v(api({"a.yml": [run(2, "failure")]})), "failing")
        self.assertEqual(v(api({"a.yml": []})), "never")
        self.assertEqual(v(api({"a.yml": [run(1, "skipped"), run(1, "cancelled")]})), "never")     # a skipped run did no work
        self.assertEqual(v(api(status=0)), "unknown")                                              # no token: never guessed alive

    def test_log_rows_on_an_evidence_branch_count_with_epoch_or_iso_times(self):
        show = lambda ref, path: json.dumps({"at": ISO(3)}) + "\n" + json.dumps({"at": int((NOW - dt.timedelta(hours=1)).timestamp())}) + "\nnot json\n"
        ev = liveness.evidence("jsonl:origin/b:ops/x.jsonl:at", None, show)
        self.assertEqual(liveness.verdict({"id": "x", "loop": "l", "what": "w", "evidence": "", "max_age_hours": 2}, ev, NOW)["age_hours"], 1.0)
        self.assertFalse(liveness.evidence("jsonl:origin/b:ops/x.jsonl:at", None, lambda r, p: None)["readable"])

    def test_the_claim_holds_only_when_every_loop_is_alive(self):
        d = liveness.load(ROOT)
        wfs = {p["evidence"].split(":", 1)[1]: [{"updated_at": ISO(1), "conclusion": "success", "run_number": 9}] for p in d["probes"] if p["evidence"].startswith("workflow:")}
        show = lambda ref, path: json.dumps({"at": ISO(1)}) + "\n"
        rep = liveness.run(ROOT, now=NOW, get=api(wfs, [{"number": 7, "merged_at": ISO(1)}]), show=show)
        self.assertTrue(rep["claim_holds"], rep)
        wfs["loop.yml"] = []                                                                      # the launch workflow never ran
        rep = liveness.run(ROOT, now=NOW, get=api(wfs, [{"number": 7, "merged_at": ISO(1)}]), show=show)
        self.assertFalse(rep["claim_holds"])
        self.assertEqual([r["id"] for r in rep["probes"] if r["verdict"] == "never"], ["launch-loops"])

    def test_a_loop_that_is_not_running_becomes_one_queue_item_and_unknown_files_nothing(self):
        r = copy_repo()
        rep = {"at": "2026-11-12T12:00:00Z", "probes": [
            {"id": "a", "loop": "launch", "what": "w", "verdict": "never", "age_hours": None, "max_age_hours": 26, "evidence": "workflow:loop.yml", "detail": "no run"},
            {"id": "b", "loop": "launch", "what": "w", "verdict": "unknown", "age_hours": None, "max_age_hours": 26, "evidence": "workflow:loop.yml", "detail": "no token"},
            {"id": "c", "loop": "launch", "what": "w", "verdict": "alive", "age_hours": 1.0, "max_age_hours": 26, "evidence": "workflow:loop.yml", "detail": "ok"}]}
        self.assertEqual(liveness.file_items(r, rep), ["docs/issues/Q-LIVE-a.json"])
        item = json.loads((r / "docs/issues/Q-LIVE-a.json").read_text())
        self.assertIn("**Done check:** cmd:python3 -m foundation liveness --probe a", item["body"])
        self.assertIn("**Owner:** operations", item["body"])
        self.assertEqual(liveness.file_items(r, rep), [])                                          # idempotent
        from foundation import queue
        self.assertEqual([b for b in queue.check(r) if "Q-LIVE" in b], [])

    def test_a_probe_for_a_loop_or_workflow_that_does_not_exist_fails_the_doctrine_check(self):
        r = copy_repo()
        edit(r / "instances/ultrastable/liveness.json", lambda d: d["probes"].append({"id": "ghost", "loop": "no-such-loop", "what": "w", "evidence": "workflow:nope.yml", "max_age_hours": 26}))
        bad = doctrine.check(r)
        self.assertTrue(any("liveness: liveness probe ghost: loop no-such-loop" in b for b in bad), bad)
        self.assertTrue(any("workflow nope.yml does not exist" in b for b in bad))


if __name__ == "__main__":
    unittest.main()


class QueueStatusWords(unittest.TestCase):
    def test_done_and_closed_both_mean_finished_and_both_need_evidence(self):
        from foundation import queue
        r = copy_repo()
        item = lambda status, extra="": {"id": "Q-T", "title": "Q-T: t", "body": f"**Owner:** operations\n**Trigger:** t\n**Done check:** file:README.md\n**Status:** {status}\n\nx{extra}"}
        p = r / "docs/issues/Q-T.json"
        for status in ("done", "closed"):
            p.write_text(json.dumps(item(status, "\n\n**Evidence:** measured\n")))
            self.assertEqual([b for b in queue.check(r) if b.startswith("Q-T")], [], status)
            p.write_text(json.dumps(item(status)))
            self.assertTrue(any("Q-T: closed without evidence" in b for b in queue.check(r)), status)
        p.write_text(json.dumps(item("parked")))
        self.assertTrue(any("Q-T: status 'parked' is not open, closed or done" in b for b in queue.check(r)))

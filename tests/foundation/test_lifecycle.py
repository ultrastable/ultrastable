"""LIFECYCLE-1: no zombie sessions; loops score and mutate themselves."""
import atexit, datetime as dt, json, shutil, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import lifecycle as lc  # noqa: E402

T0 = dt.datetime(2026, 11, 12, 12, 0, tzinfo=dt.timezone.utc)
M = lambda n: T0 + dt.timedelta(minutes=n)


def scratch():
    d = Path(tempfile.mkdtemp()); atexit.register(shutil.rmtree, d, True)
    (d / "docs/issues").mkdir(parents=True)
    return d


def runs(*oks, sig="x"):
    return [{"at": lc._iso(T0 - dt.timedelta(hours=len(oks) - i)), "ok": ok, "sig": "" if ok else sig} for i, ok in enumerate(oks)]


class Sessions(unittest.TestCase):
    def test_heartbeat_keeps_a_session_alive_silence_makes_it_a_zombie(self):
        d = scratch()
        a, b = lc.open_session(d, "x", now=T0), lc.open_session(d, "y", now=T0)
        lc.beat(d, a, now=M(40))
        self.assertEqual(lc.check(d, now=M(50)), [f"zombie {b} (y): no heartbeat since {lc._iso(T0)}, ttl 45 min (run lifecycle --reap)"])
        r = lc.reap(d, now=M(50))
        self.assertEqual(r["reaped"], [b])
        self.assertEqual(lc.check(d, now=M(50)), [])
        self.assertEqual(lc.state(d)[b]["closed"]["disposition"], "reaped")

    def test_every_close_has_a_valid_disposition_and_backlog_needs_an_item(self):
        d = scratch()
        s = lc.open_session(d, "x", now=T0)
        with self.assertRaises(ValueError):
            lc.close_session(d, s, "gone")
        with self.assertRaises(ValueError):
            lc.close_session(d, s, "backlogged", "OL-NOPE")
        (d / "docs/issues/OL-A.json").write_text("{}")
        lc.close_session(d, s, "backlogged", "OL-A", now=M(1))
        self.assertEqual(lc.check(d, now=M(2)), [])

    def test_repeat_zombie_agent_gets_an_incident_with_a_probe(self):
        d = scratch()
        for i in range(3):
            lc.open_session(d, "flaky", now=M(i))
        r = lc.reap(d, now=M(500))
        self.assertEqual(r["incidents"], ["OL-ZOMBIE-flaky"])
        body = json.loads((d / "docs/issues/OL-ZOMBIE-flaky.json").read_text())["body"]
        self.assertIn("**Done check:** cmd:python3 -m foundation lifecycle --check --agent flaky", body)
        self.assertTrue(lc.check(d, "flaky", now=M(501)))

    def test_hooks_cover_start_beat_and_stop(self):
        self.assertEqual(set(lc.hooks()["hooks"]), {"SessionStart", "PostToolUse", "Stop"})


class StrangeLoop(unittest.TestCase):
    def test_two_identical_failures_mutate_three_redesign(self):
        d = scratch()
        lc.improve(d, T0, {"a": runs(True, False, False), "b": runs(False, False, False), "c": runs(True, True, True)})
        files = {p.stem for p in (d / "docs/issues").glob("*.json")}
        self.assertEqual(files, {"OL-MUTATE-a", "OL-REDESIGN-b"})
        self.assertEqual(json.loads((d / "ops/improvements.jsonl").read_text().splitlines()[-1])["ev"], "self")

    def test_different_failure_signatures_do_not_count_as_the_same_loop_failing_twice(self):
        s = lc.stats(runs(False, True) + [{"at": lc._iso(T0), "ok": False, "sig": "other"}], T0)
        self.assertEqual(s["fail_streak"], 1)

    def test_mutation_prediction_is_scored_kept_or_reverted(self):
        d = scratch()
        lc.improve(d, T0, {"a": runs(True, False, False)})
        later = T0 + dt.timedelta(days=8)
        better = {"a": [{"at": lc._iso(later - dt.timedelta(hours=1)), "ok": True, "sig": ""}] * 4}
        self.assertEqual(lc.score(d, later, better), [{"loop": "a", "kept": True}])
        self.assertEqual(lc.score(d, later, better), [])  # a verdict is recorded once
        d2 = scratch()
        lc.improve(d2, T0, {"a": runs(True, False, False)})
        worse = {"a": [{"at": lc._iso(later - dt.timedelta(hours=1)), "ok": False, "sig": "x"}] * 2}
        self.assertEqual(lc.score(d2, later, worse), [{"loop": "a", "kept": False}])
        self.assertTrue((d2 / "docs/issues/OL-REVERT-a.json").is_file())

    def test_the_improver_scores_itself(self):
        d = scratch()
        import os
        for i in range(5):
            p = d / "docs/issues" / f"OL-MUTATE-l{i}.json"
            p.write_text("{}")
            old = (T0 - dt.timedelta(days=30)).timestamp()
            os.utime(p, (old, old))
        r = lc.improve(d, T0, {})
        self.assertIn("OL-MUTATE-improve", r["filed"])

    def test_this_repo_is_clean(self):
        self.assertEqual(lc.check(ROOT), [])


if __name__ == "__main__":
    unittest.main()

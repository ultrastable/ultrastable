import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import loopowner, queue

REPO = Path(__file__).resolve().parents[2]


class LoopOwner(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(loopowner.check(REPO), [])

    def test_client_only_loop_and_missing_owner_fail(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        (d / "doctrine").mkdir(); (d / "instances/ultrastable").mkdir(parents=True)
        shutil.copy(REPO / "doctrine/loop-ownership.json", d / "doctrine")
        loop = {"id": "x", "paths": [{"id": "a", "class": "session"}], "done": "ok", "closing_probe": "p", "trigger": "t"}
        (d / "instances/ultrastable/loop-registry.json").write_text(json.dumps({"loops": [loop]}))
        errs = loopowner.check(d)
        self.assertTrue(any("server_owner" in e for e in errs) and any("no server-side path" in e for e in errs))
        loop.update(server_owner="ultrastable-tick", paths=[{"id": "a", "class": "free"}], done="owner will merge it")
        (d / "instances/ultrastable/loop-registry.json").write_text(json.dumps({"loops": [loop]}))
        self.assertEqual(len(loopowner.check(d)), 1)


def pr(n=7, **kw):
    base = {"number": n, "title": "T", "isDraft": False, "mergeable": "MERGEABLE", "labels": [], "headRefName": "claude/x", "headRefOid": "a" * 40,
            "author": {"login": "someone"}, "statusCheckRollup": [{"name": "checks", "conclusion": "SUCCESS"}], "files": [{"path": "a.py"}]}
    base.update(kw)
    return base


class NoHandBackAndAdoption(unittest.TestCase):
    def test_repo_passes(self):
        self.assertEqual(loopowner.policy_check(REPO), [])

    def test_handback_phrases_are_caught(self):
        d = loopowner.load(REPO)
        for phrase in ("lane: a check failed. Fix within 24h or this PR is closed.", "Rebase within 12h or it is closed", "Fix and remove the hold label.",
                       "The author must rebase the branch.", "Follow every PR you open until it merges.", "the session closes the loop", "waiting on the author"):
            self.assertTrue(loopowner.lint(phrase, d), phrase)

    def test_stating_the_rule_is_not_a_finding(self):
        d = loopowner.load(REPO)
        self.assertEqual(loopowner.lint(d["rule"], d), [])
        self.assertEqual(loopowner.lint("A client session never waits on the author.", d), [])

    def test_state(self):
        self.assertEqual(loopowner.state(pr()), "lane")
        self.assertEqual(loopowner.state(pr(statusCheckRollup=[])), "lane")
        self.assertEqual(loopowner.state(pr(mergeable="CONFLICTING")), "conflict")
        self.assertEqual(loopowner.state(pr(statusCheckRollup=[{"name": "checks", "conclusion": "FAILURE"}])), "ci-failed")
        self.assertEqual(loopowner.state(pr(labels=[{"name": "needs-pat"}])), "needs-pat")
        self.assertEqual(loopowner.state(pr(labels=[{"name": "hold"}], mergeable="CONFLICTING")), "held")

    def test_adopt_files_one_complete_queue_item_and_is_idempotent(self):
        d = loopowner.load(REPO)
        calls = []
        gh = lambda root, *a, **k: (calls.append(a), (0, ""))[1]
        with tempfile.TemporaryDirectory() as t:
            prs = [pr(1), pr(2, statusCheckRollup=[{"name": "checks", "conclusion": "FAILURE"}]), pr(3, mergeable="CONFLICTING")]
            rows = loopowner.adopt(prs, t, apply=True, d=d, gh=gh)
            self.assertEqual([r["state"] for r in rows], ["lane", "ci-failed", "conflict"])
            self.assertTrue(all(r["owner"] for r in rows), "every open pull request has a server-side owner")
            self.assertFalse((Path(t) / "docs/issues/OL-PR-1.json").exists())
            its = {i["id"]: i for i in queue.items(t)}
            self.assertEqual(sorted(its), ["OL-PR-2", "OL-PR-3"])
            for it in its.values():
                self.assertTrue(it["owner"] and it["trigger"] and it["status"] == "open")
                self.assertTrue(it["probe"].startswith("cmd:python3 -m foundation loopowner --closed "))
            self.assertEqual(queue.check(t), [])
            self.assertEqual(loopowner.lint(its["OL-PR-2"]["json"]["body"], d), [])
            n = len(calls)
            again = loopowner.adopt(prs, t, apply=True, d=d, gh=gh)
            self.assertEqual(len(calls), n, "a second pass neither comments nor labels again")
            self.assertFalse(any(r.get("filed") for r in again))

    def test_a_racing_lane_run_does_not_comment_twice(self):  # LANE-DEDUPE-1: PR 826 got the same comment five times
        d = loopowner.load(REPO)
        calls = []
        def gh(root, *a, **k):
            calls.append(a)
            return (0, "1\n") if a[:2] == ("pr", "view") else (0, "")
        with tempfile.TemporaryDirectory() as t:
            rows = loopowner.adopt([pr(2, statusCheckRollup=[{"name": "checks", "conclusion": "FAILURE"}])], t, apply=True, d=d, gh=gh)
            self.assertEqual(rows[0]["commented"], "already")
            self.assertFalse(any(c[:2] == ("pr", "comment") for c in calls))

    def test_closing_probe(self):
        self.assertEqual(loopowner.closed(5, REPO, gh=lambda *a, **k: (0, "MERGED\n")), (True, "MERGED"))
        self.assertFalse(loopowner.closed(5, REPO, gh=lambda *a, **k: (0, "OPEN\n"))[0])
        self.assertFalse(loopowner.closed(5, REPO, gh=lambda *a, **k: (1, "boom"))[0])


if __name__ == "__main__":
    unittest.main()

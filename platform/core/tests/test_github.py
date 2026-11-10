import unittest

from ultrastable.agents import GitHubConnector, GitHubPRAgent, build_agent


class Fake:
    """Stub GitHub transport recording calls."""

    def __init__(self, runs=None, labels=()):
        self.calls, self.runs, self.labels = [], runs if runs is not None else [("ci", "completed", "success")], labels

    def __call__(self, method, path, body):
        self.calls.append((method, path, body))
        if path.startswith("/repos/o/r/issues"):
            return 200, [
                {"number": 5, "title": "do five", "labels": [{"name": "agent-ready"}],
                 "body": "x\nClosing probe: merged PR with green checks"},
                {"number": 6, "title": "a PR", "labels": [], "pull_request": {}},
                {"number": 7, "title": "held", "labels": [{"name": "hold"}], "body": ""},
                {"number": 8, "title": "no probe", "labels": [], "body": None},
            ]
        if method == "POST" and path == "/repos/o/r/pulls":
            return 201, {"number": 42}
        if method == "GET" and path == "/repos/o/r/pulls/42":
            return 200, {"head": {"sha": "abc"}, "labels": [{"name": n} for n in self.labels]}
        if path == "/repos/o/r/commits/abc/check-runs":
            return 200, {"check_runs": [{"name": n, "status": s, "conclusion": c} for n, s, c in self.runs]}
        if method == "PUT" and path == "/repos/o/r/pulls/42/merge":
            return 200, {"merged": True}
        return 404, {"message": "nope"}


ITEM = {"id": "GH-5", "title": "do five", "done_check": "d"}


class GitHub(unittest.TestCase):
    def test_fetch_items_skips_prs_and_hold(self):
        items = GitHubConnector("o/r", Fake()).fetch_items()
        self.assertEqual([i["id"] for i in items], ["GH-5", "GH-8"])
        self.assertEqual(items[0]["done_check"], "merged PR with green checks")
        self.assertEqual(items[1]["done_check"], "linked PR merged with green checks")

    def _agent(self, fake):
        return GitHubPRAgent("d", "o/r", "feat", connector=GitHubConnector("o/r", fake))

    def test_pr_opened_and_merged_on_green(self):
        f = Fake()
        a = self._agent(f)
        res = a.do(ITEM)
        self.assertTrue(res.ok)
        opened = next(c for c in f.calls if c[0] == "POST")[2]
        self.assertIn("Refs #5", opened["body"])
        self.assertNotIn("closes", opened["body"].lower())
        ok, ev = a.verify(ITEM, res)
        self.assertTrue(ok, ev)
        self.assertTrue(any(c[0] == "PUT" for c in f.calls))

    def test_no_merge_when_red_pending_missing_or_held(self):
        for runs, labels in ([("ci", "completed", "failure")], ()), ([("ci", "in_progress", None)], ()), ([], ()), (None, ("hold",)):
            f = Fake(runs=runs, labels=labels)
            a = self._agent(f)
            res = a.do(ITEM)
            ok, ev = a.verify(ITEM, res)
            self.assertFalse(ok, ev)
            self.assertFalse(any(c[0] == "PUT" for c in f.calls))

    def test_open_failure_is_evidence(self):
        a = GitHubPRAgent("d", "o/r", "feat", connector=GitHubConnector("o/r", lambda m, p, b: (422, {"message": "no commits"})))
        res = a.do(ITEM)
        self.assertFalse(res.ok)
        self.assertIn("no commits", res.evidence)
        self.assertFalse(a.verify(ITEM, res)[0])

    def test_missing_token_raises(self):
        import os
        os.environ.pop("GITHUB_TOKEN", None)
        with self.assertRaises(RuntimeError):
            GitHubConnector("o/r").fetch_items()

    def test_build_agent(self):
        a = build_agent({"kind": "github-pr", "repo": "o/r", "head": "h"}, "n")
        self.assertEqual((a.kind, a.base), ("github-pr", "main"))


if __name__ == "__main__":
    unittest.main()

"""The cross-repo lane: one queue, merge on green, drift opens the dependent issue, surfaces fall through."""
import unittest
from _repo import ROOT
from foundation import fleet

CFG = fleet.load(ROOT)


def fake(pulls=None, issues=None, push=True, files=None):
    def api(method, path, body=None):
        if "/check-runs" in path:
            return 200, {"check_runs": [{"name": "checks", "status": "completed", "conclusion": "success"}]}
        if "/pulls?" in path:
            return 200, (pulls or {}).get(path.split("/")[3], [])
        if "/pulls/" in path and method == "PUT":
            return 200, {"merged": True}
        if "/pulls/" in path:
            return 200, {"mergeable": True}
        if "/issues?" in path:
            return 200, (issues or {}).get(path.split("/")[3], [])
        if path.count("/") == 3:
            return 200, {"permissions": {"push": push}}
        return 404, {}
    return api


class Fleet(unittest.TestCase):
    def test_queue_is_one_ordered_list_across_repos(self):
        iss = {"workers": [{"number": 5, "title": "a", "labels": []}], "spec": [{"number": 2, "title": "b", "labels": [{"name": "p1"}]}]}
        q = fleet.queue(CFG, fake(issues=iss))
        self.assertEqual([(i["repo"], i["number"]) for i in q], [("spec", 2), ("workers", 5)])

    def test_merge_on_green_skips_drafts_and_holds(self):
        prs = {"workers": [{"number": 1, "draft": False, "labels": [], "head": {"sha": "x"}}, {"number": 2, "draft": True, "labels": [], "head": {"sha": "y"}},
                           {"number": 3, "draft": False, "labels": [{"name": "hold"}], "head": {"sha": "z"}}]}
        rows = fleet.merge_lane(CFG, fake(pulls=prs), apply=True, repos=["workers"])
        self.assertEqual([(r["pr"], r["action"]) for r in rows], [(1, "merge"), (2, "skip"), (3, "skip")])
        self.assertTrue(rows[0]["merged"])

    def test_skipped_or_missing_checks_never_merge(self):
        # GATE-SKIP-1: a skipped `checks` run, a running one, or none at all holds the PR in the home repo.
        pr = {"number": 1, "draft": False, "labels": [], "head": {"sha": "abcdef1"}}
        for runs, why in (([{"name": "checks", "status": "completed", "conclusion": "skipped"}], "checks has not passed"),
                          ([{"name": "checks", "status": "in_progress", "conclusion": None}], "still running"),
                          ([], "checks has not passed"), (None, "unreadable")):
            ok, got = fleet.mergeable(CFG, pr, runs, "ultrastable")
            self.assertFalse(ok)
            self.assertIn(why, got)
        self.assertTrue(fleet.mergeable(CFG, pr, [{"name": "checks", "status": "completed", "conclusion": "success"}], "ultrastable")[0])

    def test_drift_and_dependent_issue(self):
        files = {("spec", "LICENSE"): "B"}
        d = [x for x in fleet.drift(CFG, lambda r, p: files.get((r, p), "A")) if x["copy"] == "license-text"]
        self.assertEqual([(x["repo"], x["problem"]) for x in d], [("spec", "differs")])
        self.assertIn("spec", [i["repo"] for i in fleet.dependent_issues(CFG, d)])

    def test_surface_falls_through_to_the_one_that_can_write(self):
        s = fleet.probe_surfaces({"org": "ultrastable", "repos": ["workers"]}, {"github-token": fake(push=False), "lane-pat": fake(push=True)})
        self.assertEqual(s["workers"]["surface"], "lane-pat")
        self.assertEqual(len(s["workers"]["tried"]), 2)


    def test_archived_repository_is_skipped_and_recorded(self):
        api = lambda m, p, b=None: (200, {"archived": True, "permissions": {"push": False}})
        s = fleet.probe_surfaces({"org": "ultrastable", "repos": ["seed"]}, {"github-token": api})
        self.assertTrue(s["seed"]["archived"])
        self.assertIsNone(s["seed"]["surface"])


if __name__ == "__main__":
    unittest.main()


def test_queue_reads_repo_data_when_issues_off(tmp_path):
    import json
    from foundation import fleet
    d = tmp_path / "docs/issues"; d.mkdir(parents=True)
    (d / "Q-1.json").write_text(json.dumps({"id": "Q-1", "title": "t", "body": "**Owner:** exec\n**Trigger:** x\n**Done check:** file:a\n**Status:** open"}))
    cfg = {"org": "ultrastable", "repos": ["ultrastable"]}
    q = fleet.queue(cfg, lambda m, p, b=None: (410, {}), None, tmp_path)
    assert [i["number"] for i in q] == ["Q-1"] and q[0]["repo"] == "ultrastable"


class ProbeDrift(unittest.TestCase):
    def test_probe_reads_this_repository_from_the_tree_and_unreadable_is_not_a_pass(self):
        from foundation import fleet
        ok, _ = fleet.probe_drift("publication-files@ultrastable")
        self.assertTrue(ok)
        ok, why = fleet.probe_drift("publication-files@spec")  # no remote reader: unreadable, so not a pass
        self.assertFalse(ok)
        self.assertFalse(fleet.probe_drift("no-such-copy@ultrastable")[0])

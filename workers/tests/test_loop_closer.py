# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import datetime as dt
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import loop_closer as lc  # noqa: E402

NOW = dt.datetime(2026, 11, 12, 12, 0, tzinfo=dt.timezone.utc)
OLD = "2026-11-10T00:00:00Z"
NEW = "2026-11-12T11:00:00Z"


class FakeGh:
    def __init__(self, issues, prs=()):
        self._issues, self._prs, self.log, self.next = [dict(i) for i in issues], list(prs), [], 100

    ci_result = "success"
    def latest_ci(self, branch="main", workflow="ci"): return self.ci_result
    def issues(self): return self._issues
    def prs(self): return self._prs
    def comment(self, n, t): self.log.append(("comment", n))
    def close(self, n, t): self.log.append(("close", n, t))
    def label(self, n, name): self.log.append(("label", n, name))
    def unlabel(self, n, name): self.log.append(("unlabel", n, name))
    def edit_body(self, n, body): self.log.append(("edit", n, body))
    def create(self, title, body):
        self.next += 1
        self.log.append(("create", self.next, title))
        return self.next


def issue(n, title="t", body="", state="OPEN", created=OLD, labels=()):
    return {"number": n, "title": title, "body": body, "state": state, "labels": [{"name": x} for x in labels], "createdAt": created, "updatedAt": created}


def pr(n, body, state="OPEN", merged=None, updated=NEW):
    return {"number": n, "title": "p", "body": body, "state": state, "isDraft": True, "updatedAt": updated, "mergedAt": merged}


class LoopCloser(unittest.TestCase):
    def run_(self, gh, apply=True, root="."):
        return lc.run(gh, Path(root), apply, NOW, 24, 7)

    def test_t23_2_us_23_r04_issue_with_no_probe_and_no_pr_is_an_open_loop_and_gets_labelled(self):
        gh = FakeGh([issue(1)])
        r = self.run_(gh)
        self.assertEqual([n for n, _ in r["open_loop"]], [1])
        self.assertIn(("label", 1, "open-loop"), gh.log)
        self.assertEqual(lc.main.__name__, "main")

    def test_us_23_r04_grace_period_protects_a_new_issue(self):
        r = self.run_(FakeGh([issue(1, created=NEW)]))
        self.assertEqual(r["open_loop"], [])

    def test_us_23_r02_a_linked_pull_request_is_a_closed_loop(self):
        r = self.run_(FakeGh([issue(2)], [pr(9, "Closes #2")]))
        self.assertEqual(r["open_loop"], [])

    def test_t23_1_us_23_r03_probe_pr_merged_closes_with_evidence(self):
        gh = FakeGh([issue(3, body="Closing probe: pr_merged:#9")], [pr(9, "x", state="MERGED", merged="2026-11-12T00:00:00Z")])
        r = self.run_(gh)
        self.assertEqual(r["closed"][0][0], 3)
        self.assertTrue(any(e[0] == "close" and "merged" in e[2] for e in gh.log))

    def test_us_23_r03_probe_file_exists_checks_the_checkout_and_refuses_escape(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "a.txt").write_text("x")
            self.assertTrue(lc.eval_probe("file_exists", "a.txt", {}, {}, Path(d))[0])
            self.assertFalse(lc.eval_probe("file_exists", "b.txt", {}, {}, Path(d))[0])
            self.assertIsNone(lc.eval_probe("file_exists", "../x", {}, {}, Path(d))[0])

    def test_us_23_r03_unknown_probe_is_not_evaluable_and_not_closed(self):
        r = self.run_(FakeGh([issue(4, body="Closing probe: vibes:good")]))
        self.assertEqual(r["closed"], [])

    def test_t23_3_us_23_r04_epic_files_a_child_for_each_unlinked_item_and_rewrites_the_epic(self):
        gh = FakeGh([issue(5, title="EPIC: x", body="- [ ] alpha: do alpha\n- [ ] beta: do beta")])
        r = self.run_(gh)
        self.assertEqual(len(r["children"]), 2)
        edit = [e for e in gh.log if e[0] == "edit"][0][2]
        self.assertIn("[ ] #101 alpha", edit)
        self.assertIn("[ ] #102 beta", edit)

    def test_t23_3_us_23_r03_epic_ticks_closed_children_and_closes_itself_when_all_are_ticked(self):
        gh = FakeGh([issue(6, title="EPIC: y", body="- [ ] #7 one\n- [x] #8 two"), issue(7, state="CLOSED"), issue(8, state="CLOSED")])
        r = self.run_(gh)
        self.assertEqual(r["ticked"], [(6, 7)])
        self.assertEqual(r["epics_closed"], [6])
        self.assertTrue(any(e[0] == "close" and e[1] == 6 for e in gh.log))

    def test_us_23_r03_dry_run_changes_nothing(self):
        gh = FakeGh([issue(1), issue(5, title="EPIC: z", body="- [ ] a")])
        self.run_(gh, apply=False)
        self.assertEqual(gh.log, [])

    def test_us_23_r04_stale_pull_request_labels_the_issue(self):
        gh = FakeGh([issue(10)], [pr(11, "Refs #10", updated="2026-11-01T00:00:00Z")])
        r = self.run_(gh)
        self.assertEqual(r["stalled"][0][0], 10)
        self.assertIn(("label", 10, "stalled"), gh.log)

    def test_us_23_r04_exit_status_is_one_while_an_open_loop_remains(self):
        r = self.run_(FakeGh([issue(1)]), apply=False)
        self.assertTrue(r["open_loop"])

    def test_t23_8_us_23_r12_a_red_main_opens_one_incident_and_a_green_main_closes_it_by_probe(self):
        gh = FakeGh([]); gh.ci_result = "failure"
        r = self.run_(gh)
        self.assertEqual(r["incidents"], ["failure"])
        self.assertEqual([e[0] for e in gh.log], ["create"])
        gh2 = FakeGh([issue(9, title="INCIDENT: ci is red on main", body="Closing probe: ci_green:main", created=NEW)]); gh2.ci_result = "failure"
        self.assertEqual(self.run_(gh2)["incidents"], [])  # not duplicated while open
        gh3 = FakeGh([issue(9, title="INCIDENT: ci is red on main", body="Closing probe: ci_green:main", created=NEW)]); gh3.ci_result = "success"
        r3 = self.run_(gh3)
        self.assertEqual(r3["closed"][0][0], 9)

    def test_us_23_r12_a_recurring_red_main_reopens_the_closed_incident_instead_of_filing_a_second(self):
        reopened = []

        class G(FakeGh):
            def reopen(self, n, t): reopened.append((n, t))
        title = "INCIDENT: ci is red on main"
        gh = G([issue(9, title=title, state="CLOSED", body="Closing probe: ci_green:main", created=NEW)]); gh.ci_result = "failure"
        r = self.run_(gh)
        self.assertEqual(r["incidents"], ["failure"])
        self.assertEqual([n for n, _ in reopened], [9])
        self.assertEqual([e for e in gh.log if e[0] == "create"], [], "a recurrence is the same incident, not a new one")
        dry = G([issue(9, title=title, state="CLOSED", body="Closing probe: ci_green:main", created=NEW)]); dry.ci_result = "failure"
        before = len(reopened)
        self.run_(dry, apply=False)
        self.assertEqual(len(reopened), before, "a dry run reopens nothing")
        none = FakeGh([issue(9, title=title, state="CLOSED", created=NEW)]); none.ci_result = "failure"
        self.run_(none)
        self.assertEqual([e[0] for e in none.log], ["create"], "a closer with no reopen path still files the incident")




class LatestCiWithoutActionsRead(unittest.TestCase):
    """Regression: the loops workflow token lacks `actions: read`; `gh run list` failed and crashed the closer before any issue was read."""

    def test_us_23_r06_returns_none_instead_of_raising_and_records_why(self):
        import subprocess
        gh = lc.Gh("o/r")

        def boom(*a, **k):
            raise subprocess.CalledProcessError(1, ["gh"], output="", stderr="HTTP 403: Resource not accessible by integration")
        gh._run = boom
        self.assertIsNone(gh.latest_ci("main"))
        self.assertIn("403", gh.unreadable["ci"], "the reason is kept so the gap can be filed (US-23-R06)")


class ReleaseProbe(unittest.TestCase):
    def test_us_23_r03_release_exists_closes_when_tag_published(self):
        class G(FakeGh):
            def release_tags(self): return {"v0.1.0"}
        gh = G([issue(1, body="Closing probe: release_exists:v0.1.0")])
        with tempfile.TemporaryDirectory() as d:
            r = lc.run(gh, Path(d), False, dt.datetime.now(dt.timezone.utc), 24, 7)
        self.assertEqual([n for n, _ in r["closed"]], [1])


class CapabilityGap(unittest.TestCase):
    """US-23-R06: a loop that can detect but is not permitted to act is itself an open loop and is filed."""

    class Blind(FakeGh):
        """A closer whose token cannot read Actions."""
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.unreadable = {"ci": "HTTP 403: Resource not accessible by integration"}
            self.ci_result = None

    def run_(self, gh, apply=True):
        return lc.run(gh, Path("."), apply, NOW, 24, 7)

    TITLE = "CAPABILITY GAP: the Actions runs of main cannot be read by the loop closer"

    def test_t23_7_us_23_r06_us_23_r17_a_closer_that_cannot_read_actions_files_one_capability_gap(self):
        gh = self.Blind([issue(1, body="Closing probe: ci_green:main", created=NEW), issue(2, body="Closing probe: ci_green:main", created=NEW)])
        r = self.run_(gh)
        self.assertEqual([c for c, _ in r["capability_gaps"]], ["ci"])
        creates = [e for e in gh.log if e[0] == "create"]
        self.assertEqual(len(creates), 1, "one gap issue however many probes need the capability")
        self.assertEqual(creates[0][2], self.TITLE)
        self.assertEqual(lc.main.__name__, "main")
        self.assertEqual(lc.summary(r).count("[capability-gap]"), 1)

    def test_us_23_r06_us_23_r17_the_gap_issue_is_deduplicated_and_closes_by_its_probe(self):
        body = "Closing probe: ci_readable:ci"
        open_gap = issue(7, title=self.TITLE, body=body, created=NEW)
        gh = self.Blind([issue(1, body="Closing probe: ci_green:main", created=NEW), open_gap])
        r = self.run_(gh)
        self.assertEqual([e for e in gh.log if e[0] == "create"], [], "an open gap issue is not filed twice")
        self.assertEqual(r["gap_issues"][0][1:], (7, "already filed"))
        self.assertEqual(r["closed"], [], "still unreadable, so the gap stays open")
        fixed = FakeGh([issue(1, body="Closing probe: ci_green:main", created=NEW), open_gap])
        fixed.ci_result = "success"
        r2 = self.run_(fixed)
        self.assertEqual([n for n, _ in r2["closed"]], [1, 7])
        self.assertEqual(r2["capability_gaps"], [])

    def test_us_23_r06_us_23_r17_a_closed_gap_that_recurs_is_reopened_not_duplicated(self):
        reopened = []

        class G(self.Blind):
            def reopen(self, n, t): reopened.append(n)
        gh = G([issue(1, body="Closing probe: ci_green:main", created=NEW), issue(7, title=self.TITLE, state="CLOSED", body="Closing probe: ci_readable:ci", created=NEW)])
        r = self.run_(gh)
        self.assertEqual(reopened, [7])
        self.assertEqual([e for e in gh.log if e[0] == "create"], [])
        self.assertEqual(r["gap_issues"][0][2], "reopened")

    def test_us_23_r06_dry_run_files_nothing(self):
        gh = self.Blind([issue(1, body="Closing probe: ci_green:main", created=NEW)])
        r = self.run_(gh, apply=False)
        self.assertEqual(gh.log, [])
        self.assertEqual(r["gap_issues"][0][2], "would file")
        self.assertEqual(len(r["capability_gaps"]), 1)

    def test_us_23_r06_unreadable_releases_are_a_gap_only_when_a_probe_needs_them(self):
        class G(FakeGh):
            def __init__(self, *a, **k):
                super().__init__(*a, **k)
                self.unreadable = {"releases": "HTTP 403"}
            def release_tags(self): return None
        needs = G([issue(1, body="Closing probe: release_exists:v1", created=NEW)])
        self.assertEqual([c for c, _ in self.run_(needs)["capability_gaps"]], ["releases"])
        none = G([issue(2, body="Closing probe: pr_merged:#3", created=NEW)])
        self.assertEqual(self.run_(none)["capability_gaps"], [])

    def test_us_23_r06_a_readable_closer_with_no_completed_run_is_not_a_gap(self):
        gh = FakeGh([issue(1, body="Closing probe: ci_green:main", created=NEW)])
        gh.ci_result = None
        self.assertEqual(self.run_(gh)["capability_gaps"], [])

    def test_us_23_r06_us_23_r17_the_exit_status_is_one_while_a_gap_exists(self):
        import io, contextlib
        gh = self.Blind([issue(1, body="Closing probe: ci_green:main", created=NEW)])
        gh.repo = "o/r"
        orig = lc.Gh
        lc.Gh = lambda repo: gh
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                rc = lc.main(["--repo", "o/r", "--root", "."])
        finally:
            lc.Gh = orig
        self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main()

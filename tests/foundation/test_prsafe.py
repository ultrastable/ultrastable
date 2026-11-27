# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PR-NEVER-LOSE-1: automation never closes a pull request main can still take, and pins the head of any it does close."""
import unittest
from foundation import prsafe
from foundation.prsafe import ApiError

class World:
    """A fake GitHub: pull request `d`, label deletes, update-branch behaviour, compare answer, refs."""
    def __init__(self, d, update_ok=False, ahead=3, ref_ok=True):
        self.d, self.update_ok, self.ahead, self.ref_ok, self.calls, self.refs = d, update_ok, ahead, ref_ok, [], {}
    def api(self, path, method="GET", fields=None):
        self.calls.append((method, path))
        if method == "GET" and path.endswith("/pulls/7"): return dict(self.d)
        if path.endswith("/update-branch"):
            if self.update_ok: return {}
            raise ApiError("merge conflict", 422)
        if "/compare/" in path: return {"ahead_by": self.ahead}
        if method == "POST" and path.endswith("/git/refs"):
            if not self.ref_ok: raise ApiError("boom", 500)
            self.refs[fields["ref"]] = fields["sha"]; return {}
        if "/git/ref/archive/" in path: return {"object": {"sha": self.refs.get("refs/archive/" + path.split("/git/ref/archive/")[1])}}
        return {}
    def closed(self): return ("PATCH", "repos/o/r/pulls/7") in self.calls

def pr(**k): return {"state": "open", "head": {"sha": "abcdef1234567890", "ref": "claude/x"}, "labels": [], **k}
close = lambda w: prsafe.safe_close("o/r", 7, "merge conflict unresolved for 40 min", w.api, sleep=lambda s: None)

class Guard(unittest.TestCase):
    def test_stale_conflict_label_on_a_mergeable_pr_is_not_closed(self):  # the #2615 failure
        w = World(pr(mergeable=True, mergeable_state="clean", labels=[{"name": "conflict"}]))
        r = close(w); self.assertFalse(r["closed"]); self.assertFalse(w.closed())
        self.assertIn(("DELETE", "repos/o/r/issues/7/labels/conflict"), w.calls, "the stale label is cleared so it cannot close the PR next pass")
    def test_unknown_state_is_not_a_conflict(self):
        w = World(pr(mergeable=None, mergeable_state="unknown")); self.assertFalse(close(w)["closed"]); self.assertFalse(w.closed())
    def test_behind_is_mergeable(self):
        w = World(pr(mergeable=True, mergeable_state="behind")); self.assertFalse(close(w)["closed"])
    def test_update_branch_is_tried_before_a_close(self):
        w = World(pr(mergeable=False, mergeable_state="dirty"), update_ok=True); r = close(w)
        self.assertFalse(r["closed"]); self.assertFalse(w.closed())
    def test_real_conflict_is_closed_only_after_the_head_is_pinned(self):
        w = World(pr(mergeable=False, mergeable_state="dirty")); r = close(w)
        self.assertTrue(r["closed"]); self.assertEqual(w.refs, {"refs/archive/pr-7-abcdef1": "abcdef1234567890"})
        self.assertLess(w.calls.index(("POST", "repos/o/r/git/refs")), w.calls.index(("PATCH", "repos/o/r/pulls/7")))
    def test_head_that_cannot_be_pinned_stays_open(self):
        w = World(pr(mergeable=False, mergeable_state="dirty"), ref_ok=False); r = close(w)
        self.assertFalse(r["closed"]); self.assertFalse(w.closed())
    def test_already_closed_is_a_noop(self):
        w = World(pr(state="closed")); self.assertFalse(close(w)["closed"])

class Recover(unittest.TestCase):
    def test_reopens_an_automation_closed_pr_that_main_lacks_once(self):
        calls = []
        def api(path, method="GET", fields=None):
            calls.append((method, path))
            if "pulls?state=closed" in path: return [{"number": 9, "merged_at": None, "closed_at": "2026-11-27T01:00:00Z", "head": {"sha": "s9", "ref": "claude/y"}}]
            if path.endswith("/comments?per_page=100"): return [{"body": "lane (PR-BOUND-1): closed after a conflict"}]
            if "/compare/" in path: return {"ahead_by": 4}
            return {}
        r = prsafe.recover("o/r", api=api, now=1_795_000_000 + 40 * 86400 * 0 + 1_000_000, apply=True)
        self.assertEqual(r["reopened"], [9]); self.assertIn(("PATCH", "repos/o/r/pulls/9"), calls)
    def test_not_reopened_twice_or_when_main_has_it(self):
        def api(path, method="GET", fields=None):
            if "pulls?state=closed" in path: return [{"number": 9, "merged_at": None, "closed_at": "2026-11-27T01:00:00Z", "head": {"sha": "s9", "ref": "b"}}]
            if path.endswith("/comments?per_page=100"): return [{"body": "PR-BOUND-1"}, {"body": "PR-RECOVER-1: reopened"}]
            return {"ahead_by": 0}
        r = prsafe.recover("o/r", api=api, now=1_795_000_000 + 1_000_000, apply=True); self.assertEqual(r["reopened"], [])

if __name__ == "__main__": unittest.main()

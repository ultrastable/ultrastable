"""CONFLICT-CLOSE-1: a conflicting PR ends resolved, requeued or (session work only) labeled; the checkout is always restored."""
import json, unittest
from pathlib import Path
from foundation import conflicts as K

REPO = Path(__file__).resolve().parents[2]


def fake(author, branch, merge=1, resolver=0, push=0):
    calls = []

    def sh(argv, root, timeout=180):
        calls.append(argv)
        if argv[:3] == ["gh", "pr", "view"]:
            return 0, json.dumps({"headRefName": branch, "author": {"login": author}, "isCrossRepository": False})
        if argv[:2] == ["git", "rev-parse"]:
            return 0, "abc123"
        if "merge" in argv and "--no-edit" in argv:
            return merge, ""
        if argv[-1] == "scripts/resolve_generated.py":
            return resolver, "still conflicting: []"
        if argv[:2] == ["git", "push"]:
            return push, "refused"
        return 0, ""
    return sh, calls


class Conflicts(unittest.TestCase):
    def test_decide(self):
        self.assertEqual(K.decide(True, False, True, False), "resolved")
        self.assertEqual(K.decide(False, True, True, True), "resolved")
        self.assertEqual(K.decide(False, False, False, True), "requeued")
        self.assertEqual(K.decide(False, True, False, True), "requeued")   # push refused
        self.assertEqual(K.decide(False, False, False, False), "left")     # session work is never closed

    def test_only_queue_reproducible_prs_are_executor_authored(self):
        self.assertTrue(K.executor_authored("app/github-actions", "agent/Q-GROW-x"))
        self.assertFalse(K.executor_authored("rwnq8", "agent/Q-GROW-x"))
        self.assertFalse(K.executor_authored("app/github-actions", "claude/thread"))

    def test_generated_conflict_is_resolved_pushed_and_checked(self):
        sh, calls = fake("rwnq8", "claude/thread")
        r = K.resolve(7, apply=True, sh=sh)
        self.assertEqual(r["result"], "resolved")
        self.assertIn(["gh", "workflow", "run", "checks.yml", "-R", K.GH, "--ref", "claude/thread"], calls)
        self.assertEqual(calls[-3], ["git", "checkout", "-f", "--detach", "abc123"])  # the lane's checkout is restored before anything else runs

    def test_unresolvable_executor_pr_is_closed_for_requeue(self):
        sh, calls = fake("app/github-actions", "agent/Q-X-y", resolver=1)
        self.assertEqual(K.resolve(8, apply=True, sh=sh)["result"], "requeued")
        self.assertTrue(any(c[:3] == ["gh", "pr", "close"] and "--delete-branch" in c for c in calls))

    def test_unresolvable_session_pr_is_left_open(self):
        sh, calls = fake("rwnq8", "claude/thread", resolver=1)
        self.assertEqual(K.resolve(9, apply=True, sh=sh)["result"], "left")
        self.assertFalse(any(c[:3] == ["gh", "pr", "close"] for c in calls))

    def test_dry_run_changes_nothing(self):
        sh, calls = fake("rwnq8", "claude/thread")
        self.assertEqual(K.resolve(9, sh=sh)["result"], "dry-run")
        self.assertEqual(len(calls), 1)

    def test_lane_calls_the_closer_before_labeling(self):
        s = (REPO / "scripts/lane.sh").read_text(encoding="utf-8")
        self.assertLess(s.index("foundation conflicts --pr"), s.index("--add-label conflict"))


if __name__ == "__main__":
    unittest.main()

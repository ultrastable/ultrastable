"""PUSH-MAIN-BATCH-1: a change larger than the Worker's per-commit file cap lands as consecutive commits instead of an HTTP 400 and a refused
direct push (fleet run 44486923943, 2026-11-19)."""
import importlib.util, sys, unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("push_main", ROOT / "tools/push_main.py")
pm = importlib.util.module_from_spec(spec); spec.loader.exec_module(pm)


class Batches(unittest.TestCase):
    def run_main(self, n, fail_on=None):
        files = [{"path": f"docs/issues/Q-{i}.json", "content": ""} for i in range(n)]
        sent = []
        def post(msg, part):
            sent.append((msg, len(part)))
            return 1 if fail_on == len(sent) else 0
        with mock.patch.object(pm, "git", return_value=b"queue: verdicts"), mock.patch.object(pm, "changes", return_value=files), \
             mock.patch.object(pm, "post", side_effect=post), mock.patch.object(pm, "fallback", return_value=99):
            return pm.main(), sent

    def test_cap_matches_the_worker(self):
        src = (ROOT / "seed/worker/src/maincommit.js").read_text(encoding="utf-8")
        self.assertIn(f"MAX_FILES = {pm.MAX_FILES};", src)

    def test_small_change_is_one_commit(self):
        rc, sent = self.run_main(5)
        self.assertEqual((rc, sent), (0, [("queue: verdicts [skip ci]", 5)]))

    def test_large_change_lands_in_parts_of_the_cap(self):
        rc, sent = self.run_main(45)
        self.assertEqual(rc, 0)
        self.assertEqual([k for _, k in sent], [20, 20, 5])
        self.assertEqual(sent[1][0], "queue: verdicts (part 2/3) [skip ci]")

    def test_failure_after_a_part_landed_does_not_direct_push(self):
        rc, sent = self.run_main(45, fail_on=2)
        self.assertEqual(rc, 1, "no fallback push once part 1 is on main")
        rc, _ = self.run_main(45, fail_on=1)
        self.assertEqual(rc, 99, "the second route still runs when nothing landed")


if __name__ == "__main__":
    unittest.main()

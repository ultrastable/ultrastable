"""EVIDENCE-APPEND-1 and QUEUE-PERSIST-1: evidence is appended onto the evidence branch tip, never force-pushed over it, so every pass's
ledger rows survive and a closing probe can reach the passes it needs to close an item."""
import subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import ledger  # noqa: E402


def git(d, *a):
    return subprocess.run(["git", "-C", str(d), *a], check=True, capture_output=True, text=True).stdout


def clone_pair(tmp: Path):
    """A bare remote with main, and one working clone of it (a fresh runner checkout of main)."""
    remote, seed = tmp / "remote.git", tmp / "seed"
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(seed)], check=True)
    (seed / "ops").mkdir()
    (seed / "ops/c.jsonl").write_text('{"at": "0", "id": "main-row"}\n')
    git(seed, "add", "-A"); git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "main")
    git(seed, "remote", "add", "origin", str(remote)); git(seed, "push", "-q", "origin", "main")
    return remote


def runner(tmp: Path, remote: Path, name: str) -> Path:
    d = tmp / name
    subprocess.run(["git", "clone", "-q", "-b", "main", str(remote), str(d)], check=True)
    return d


class MergedText(unittest.TestCase):
    def test_ledger_keeps_branch_rows_and_adds_only_new_local_rows(self):
        self.assertEqual(ledger.merged_text("a\nb\n", "a\nc\n", "x.jsonl"), "a\nb\nc\n")
        self.assertEqual(ledger.merged_text("a\nb\n", "a\n", "x.jsonl"), "a\nb\n")
        self.assertEqual(ledger.merged_text("a", "b\n", "x.jsonl"), "a\nb\n")

    def test_non_ledger_is_the_local_copy(self):
        self.assertEqual(ledger.merged_text("old", "new", "LATEST.md"), "new")


class Publish(unittest.TestCase):
    def test_two_passes_from_main_both_survive_on_the_branch(self):
        """The defect: each pass committed on main and force-pushed, so pass 2 deleted pass 1's rows."""
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t); remote = clone_pair(tmp)
            for n in (1, 2):
                d = runner(tmp, remote, f"run{n}")
                with (d / "ops/c.jsonl").open("a") as f:
                    f.write(f'{{"at": "{n}", "id": "pass-{n}"}}\n')
                res = ledger.publish(d, ["ops/c.jsonl"], f"pass {n}")
                self.assertTrue(res["ok"], res)
                self.assertEqual(git(d, "status", "--porcelain").strip(), "M ops/c.jsonl", "working copy and index untouched")
            rows = subprocess.run(["git", "--git-dir", str(remote), "show", "loop-evidence:ops/c.jsonl"], capture_output=True, text=True, check=True).stdout
            self.assertEqual(rows.splitlines(), ['{"at": "0", "id": "main-row"}', '{"at": "1", "id": "pass-1"}', '{"at": "2", "id": "pass-2"}'])
            log = subprocess.run(["git", "--git-dir", str(remote), "log", "--format=%s", "loop-evidence"], capture_output=True, text=True, check=True).stdout.split("\n")
            self.assertEqual(log[:2], ["pass 2", "pass 1"], "appended, not replaced")

    def test_nothing_new_publishes_nothing(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t); remote = clone_pair(tmp)
            d = runner(tmp, remote, "run")
            self.assertTrue(ledger.publish(d, ["ops/c.jsonl"], "first")["ok"])
            self.assertEqual(ledger.publish(d, ["ops/c.jsonl"], "again")["detail"], "nothing to publish")

    def test_rows_read_back_from_branch_after_publish(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t); remote = clone_pair(tmp)
            a = runner(tmp, remote, "a")
            with (a / "ops/c.jsonl").open("a") as f:
                f.write('{"at": "1", "id": "from-a"}\n')
            self.assertTrue(ledger.publish(a, ["ops/c.jsonl"], "a")["ok"])
            b = tmp / "b"  # a runner's checkout: main only, no remote-tracking ref for the evidence branch (actions/checkout)
            subprocess.run(["git", "clone", "-q", "--single-branch", "-b", "main", str(remote), str(b)], check=True)
            self.assertNotEqual(subprocess.run(["git", "-C", str(b), "rev-parse", "--verify", "-q", "origin/loop-evidence"], capture_output=True).returncode, 0)
            self.assertIn("from-a", [r["id"] for r in ledger.rows(b, "ops/c.jsonl")], "LEDGER-FETCH-1: a later runner fetches and replays the earlier pass")


if __name__ == "__main__":
    unittest.main()

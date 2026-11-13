"""CRITICALITY-1 seed: from the repository and its registry alone, with no account state (no ops history, an empty database), the kernel boots its own organization and the invariant computes."""
import json, subprocess, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests.foundation._repo import copy_repo  # noqa: E402


class SeedRebuild(unittest.TestCase):
    def test_boots_from_nothing(self):
        d = copy_repo()
        for f in (d / "ops").glob("*.jsonl"):
            f.unlink()  # no recorded history: a fresh account
        r = subprocess.run([sys.executable, "-m", "foundation", "selfhost", "--verify", "--no-node", "--db", str(d / "empty.db")], cwd=d, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("selfhost ok", r.stdout)
        t = subprocess.run([sys.executable, "-m", "foundation", "criticality", "--tick", "--apply"], cwd=d, capture_output=True, text=True)
        self.assertEqual(t.returncode, 0, t.stdout + t.stderr)
        rec = json.loads((d / "ops/criticality.jsonl").read_text().splitlines()[-1])
        self.assertEqual(rec["deploys"], 0)  # nothing shipped yet: the invariant reports it, gates the queue to deploys and cost, and the loops start from there
        self.assertEqual(rec["gate"], "deploys-and-cost-only")


if __name__ == "__main__":
    unittest.main()

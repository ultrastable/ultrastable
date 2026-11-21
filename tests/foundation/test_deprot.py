"""DEPROT-1: every manifest has a Dependabot entry, and the check notices a new one."""
import sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import deprot  # noqa: E402


class Deprot(unittest.TestCase):
    def test_repository_is_covered(self):
        self.assertEqual(deprot.check(ROOT), [])

    def test_new_manifest_is_caught(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d); (r / ".github").mkdir(); (r / ".github/dependabot.yml").write_text("version: 2\nupdates: []\n")
            (r / "svc").mkdir(); (r / "svc/package.json").write_text("{}")
            self.assertEqual(deprot.check(r), ["no Dependabot entry for npm at /svc"])


if __name__ == "__main__":
    unittest.main()

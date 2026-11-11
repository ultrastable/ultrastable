import json, subprocess, tempfile, unittest
from pathlib import Path
import check_license, split_repos

ROOT = Path(__file__).resolve().parent.parent


class LicenseSplit(unittest.TestCase):
    def test_repo_consistent(self):
        self.assertEqual(check_license.check(ROOT), [])

    def test_unassigned_file_is_reported(self):
        files = split_repos.tracked(ROOT) + ["mystery-dir/x.txt"]
        self.assertIn("unassigned: mystery-dir/x.txt", split_repos.check(ROOT, files))

    def test_longest_prefix_wins(self):
        which = split_repos.resolver(split_repos.load(ROOT))
        self.assertEqual(which("platform/core/ultrastable/engine.py"), "portable")
        self.assertEqual(which("platform/README.md"), "ops")
        self.assertEqual(which("seed/worker/src/tick.js"), "workers")

    def test_build_adds_license_everywhere_and_no_file_twice(self):
        files = [f for f in split_repos.tracked(ROOT) if (ROOT / f).is_file()][:400] + ["LICENSE"]
        with tempfile.TemporaryDirectory() as d:
            split_repos.build(d, ROOT, files)
            targets = list(split_repos.load(ROOT)["targets"])
            for t in targets:
                self.assertTrue((Path(d) / t / "LICENSE").is_file(), t)
                self.assertTrue((Path(d) / t / "README.md").is_file(), t)
            seen = {}
            for t in targets:
                for p in (Path(d) / t).rglob("*"):
                    if p.is_file():
                        rel = p.relative_to(Path(d) / t).as_posix()
                        if rel in split_repos.load(ROOT)["shared_files"] or rel == "README.md":
                            continue
                        self.assertNotIn(rel, seen, f"{rel} in {t} and {seen.get(rel)}")
                        seen[rel] = t

    def test_license_is_not_proprietary(self):
        text = (ROOT / "LICENSE").read_text(encoding="utf-8")
        self.assertNotIn("Proprietary and confidential", text)
        self.assertIn("COMMERCIAL USE REQUIRES A COMMERCIAL LICENSE", text)


if __name__ == "__main__":
    unittest.main()

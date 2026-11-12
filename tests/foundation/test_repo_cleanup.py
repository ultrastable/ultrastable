"""The test helpers clean up after themselves: a run leaves no copy of the repository in the temp directory."""
import io, os, re, subprocess, sys, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _repo  # noqa: E402


class Cleanup(unittest.TestCase):
    def test_a_copy_is_removed_as_soon_as_its_test_ends(self):
        seen = []

        class Inner(unittest.TestCase):
            def test_x(self):
                seen.append(_repo.copy_repo()); seen.append(_repo.tiny_repo())
                self.assertTrue((seen[0] / "agents/AGENTS.md").is_file() and (seen[1] / "README.md").is_file())

        res = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(Inner))
        self.assertTrue(res.wasSuccessful())
        self.assertEqual(len(seen), 2)
        self.assertEqual([p for p in seen if p.exists()], [])

    def test_a_copy_made_in_setupclass_is_removed_with_the_class(self):
        seen = []

        class Inner(unittest.TestCase):
            @classmethod
            def setUpClass(cls):
                seen.append(_repo.scratch())

            def test_x(self):
                self.assertTrue(seen[0].is_dir())

        unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(Inner))
        self.assertFalse(seen[0].exists())

    def test_a_whole_process_leaves_the_temp_directory_empty(self):
        """A fresh interpreter makes copies outside any test and inside a failing one, then exits: nothing is left."""
        with tempfile.TemporaryDirectory() as tmp:
            code = ("import sys, unittest; sys.path.insert(0, %r); import _repo\n"
                    "a = _repo.copy_repo(); b = _repo.tiny_repo(); assert a.is_dir() and b.is_dir()\n"
                    "class T(unittest.TestCase):\n"
                    "    def test_fails(self):\n"
                    "        _repo.copy_repo(); self.fail('on purpose')\n"
                    "unittest.main(argv=['x'], exit=False, testRunner=unittest.TextTestRunner(stream=__import__('io').StringIO()))\n") % str(HERE)
            r = subprocess.run([sys.executable, "-c", code], env={**os.environ, "TMPDIR": tmp}, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(os.listdir(tmp), [])

    def test_directories_of_a_killed_run_are_swept_and_fresh_ones_are_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            old, new, other = Path(tmp) / (_repo.PREFIX + "old"), Path(tmp) / (_repo.PREFIX + "new"), Path(tmp) / "someone-elses"
            for p in (old, new, other):
                p.mkdir()
            long_ago = time.time() - (_repo.STALE_HOURS + 1) * 3600
            os.utime(old, (long_ago, long_ago)); os.utime(other, (long_ago, long_ago))
            self.assertEqual(_repo.sweep_stale(tmp), 1)
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), sorted([new.name, other.name]))

    def test_no_test_makes_a_temp_directory_that_nothing_removes(self):
        """Static guard: in tests/foundation a bare mkdtemp is allowed only in the helper, or with its removal registered on the same line."""
        bad = []
        for p in sorted(HERE.glob("test_*.py")):
            for n, ln in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                if re.search(r"\bmkdtemp\(", ln) and "addCleanup" not in ln and p.name != Path(__file__).name:
                    bad.append(f"{p.name}:{n}")
        self.assertEqual(bad, [], "use _repo.scratch() (removed when the test ends) instead of a bare tempfile.mkdtemp()")


if __name__ == "__main__":
    unittest.main()

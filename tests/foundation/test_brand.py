"""Brand lint tests: the positioning must be visible on every repo's front page."""
import shutil, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import brandcheck  # noqa: E402
import sys as _sys; _sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (scratch directories are removed when the run ends)


class Brand(unittest.TestCase):
    def test_repo_clean(self):
        self.assertEqual(brandcheck.check(ROOT), [])

    def _copy(self):
        td = Path(scratch())
        for d in ("brand", "doctrine", "docs/ops"):
            shutil.copytree(ROOT / d, td / d, ignore=shutil.ignore_patterns("*.png"))
        for n in (ROOT / "brand/generated").rglob("*.png"):
            (td / n.relative_to(ROOT)).parent.mkdir(parents=True, exist_ok=True)
            (td / n.relative_to(ROOT)).write_bytes(b"x")
        return td

    def test_missing_tagline_and_link_fail(self):
        td = self._copy()
        f = td / "brand/repos/seed/README.block.md"
        f.write_text(f.read_text().replace("foundation for any autonomous system", "tool").replace("github.com/ultrastable/workers", "example.com"))
        bad = brandcheck.check(td)
        self.assertTrue(any("tagline" in b for b in bad) and any("link to ultrastable/workers" in b for b in bad), bad)

    def test_unregistered_contact_fails(self):
        td = self._copy()
        f = td / "docs/ops/contact.json"
        f.write_text(f.read_text().replace("pilot@ultrastable.io", "nobody" + "@ultrastable.io", 1))
        self.assertTrue(any("not registered" in b for b in brandcheck.check(td)))


if __name__ == "__main__":
    unittest.main()

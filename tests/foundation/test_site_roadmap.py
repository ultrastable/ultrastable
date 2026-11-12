"""SITE-PINS-1: the public site's status pins and honest gaps are tied to real issues and code."""
import shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_site_roadmap as b  # noqa: E402


class SiteRoadmap(unittest.TestCase):
    def test_repo_clean_and_fresh(self):
        r = subprocess.run([sys.executable, "scripts/build_site_roadmap.py", "--check"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def _copy(self):
        td = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, td, ignore_errors=True)
        (td / "site").mkdir()
        shutil.copy(ROOT / "site/pins.json", td / "site/pins.json")
        shutil.copytree(ROOT / "docs/issues", td / "docs/issues")
        for d in ("agents", "seed", "instances", "foundation", "deploy", "platform", "docs/bootstrapping", "site"):
            if (ROOT / d).is_dir():
                shutil.copytree(ROOT / d, td / d, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", "__pycache__", "assets"))
        return td

    def test_dangling_pin_fails(self):
        td = self._copy()
        f = td / "docs/issues/PIN-plussing.json"
        f.unlink()
        _, bad = b.load(td)
        self.assertTrue(any("PIN-plussing" in x and "does not exist" in x for x in bad), bad)

    def test_missing_code_path_fails(self):
        td = self._copy()
        (td / "foundation/selfhost.py").unlink()
        _, bad = b.load(td)
        self.assertTrue(any("selfhost.py" in x for x in bad), bad)

    def test_live_pin_with_failing_probe_fails(self):
        td = self._copy()
        (td / "seed/worker/src/tick.js").unlink()
        _, bad = b.load(td)
        self.assertTrue(any("marked live" in x for x in bad), bad)


if __name__ == "__main__":
    unittest.main()

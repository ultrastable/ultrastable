import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import pointclick

REPO = Path(__file__).resolve().parents[2]


class PointClick(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(pointclick.check(REPO), [])

    def test_a_step_that_asks_for_a_token_fails(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        (d / "doctrine").mkdir(); (d / "docs").mkdir()
        shutil.copy(REPO / "doctrine/point-and-click.json", d / "doctrine")
        (d / "docs/BOOTSTRAP-X.md").write_text("Step 1: create a personal access token and paste the token here.\nStep 2: click Authorize.\n")
        errs = pointclick.check(d)
        self.assertEqual(len(errs), 1); self.assertIn("BOOTSTRAP-X.md:1", errs[0])

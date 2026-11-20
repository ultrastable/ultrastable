# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""ADOPT-1: an existing repository gets the kernel and its loops without losing a byte of its own code."""
import json
import unittest

from _repo import ROOT, scratch
from foundation import adopt, upstream


def make_repo():
    d = scratch()
    (d / "src").mkdir(); (d / "tests").mkdir()
    (d / "src/app.py").write_text("def add(a, b):\n    return a + b\n")
    (d / "tests/test_app.py").write_text("import unittest\n\n\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(1 + 1, 2)\n")
    (d / "README.md").write_text("# Shop Tracker\n\nmine\n")
    (d / "wrangler.toml").write_text('name = "shop-tracker"\n')
    return d


class Adopt(unittest.TestCase):
    def test_scan_reads_only_what_is_there(self):
        s = adopt.scan(make_repo())
        self.assertEqual(s["test_command"], "python3 -m unittest discover -s tests")
        self.assertEqual(s["deploy"], ["cloudflare-workers"])
        self.assertEqual(s["ci"], [])
        self.assertEqual(s["languages"], {"python": 2})
        self.assertFalse(s["has_kernel"])

    def test_dry_run_writes_nothing(self):
        d = make_repo()
        before = sorted(p.relative_to(d).as_posix() for p in d.rglob("*"))
        r = adopt.adopt(d)
        self.assertEqual(before, sorted(p.relative_to(d).as_posix() for p in d.rglob("*")))
        self.assertIn("ci", r["gaps"]); self.assertIn("tests", r["ready"])

    def test_apply_is_additive_idempotent_and_files_gaps(self):
        d = make_repo()
        readme = (d / "README.md").read_text()
        r = adopt.adopt(d, core=ROOT, apply=True, name="Shop Tracker")
        self.assertEqual((d / "README.md").read_text(), readme, "an existing file was overwritten")
        self.assertEqual((d / "src/app.py").read_text(), "def add(a, b):\n    return a + b\n")
        self.assertTrue((d / upstream.LOCK).is_file())
        self.assertEqual(json.loads((d / "instance.json").read_text())["slug"], "shop-tracker")
        item = json.loads((d / "docs/issues/Q-ADOPT-ci.json").read_text())
        self.assertIn("**Done check:** file:.github/workflows/checks.yml", item["body"])
        self.assertIn("Q-ADOPT-ci", r["filed"])
        self.assertFalse((d / "docs/issues/Q-ADOPT-tests.json").exists(), "a ready loop must not file a gap")
        self.assertEqual(upstream.check(ROOT, d), [])
        self.assertEqual(adopt.adopt(d, core=ROOT, apply=True, name="Shop Tracker")["filed"], [], "second run filed again")

    def test_check_passes_then_fails_on_drift(self):
        d = make_repo()
        adopt.adopt(d, core=ROOT, apply=True, name="Shop Tracker")
        self.assertEqual(adopt.check(d), [])
        (d / "wrangler.toml").unlink()
        self.assertTrue(any("drift in deploy" in b for b in adopt.check(d)))

    def test_no_tests_is_a_gap_not_an_invented_command(self):
        d = scratch()
        (d / "index.js").write_text("console.log(1)\n")
        (d / "package.json").write_text(json.dumps({"scripts": {"test": 'echo "Error: no test specified" && exit 1'}}))
        s = adopt.scan(d)
        self.assertIsNone(s["test_command"])
        ls = {x["id"]: x for x in adopt.loops(s)}
        self.assertFalse(ls["tests"]["ready"]); self.assertIsNone(ls["tests"]["probe"])

    def test_cli(self):
        self.assertEqual(adopt.main(["--repo", str(make_repo())]), 0)


if __name__ == "__main__":
    unittest.main()

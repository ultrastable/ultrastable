# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""NO-SWALLOW-1: the rule "Never swallow an error" fails the build when a change adds a swallowed error."""
import importlib.util, json, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("lint_swallow", REPO / "scripts/lint_swallow.py")
ls = importlib.util.module_from_spec(spec); spec.loader.exec_module(ls)
CFG = {"python_globs": ["**/*.py"], "shell_globs": ["**/*.sh"], "exclude": [], "baseline": {"old.sh": 1}}


class NoSwallow(unittest.TestCase):
    def test_repository_is_within_its_baseline(self):
        self.assertEqual(ls.check(), [])

    def test_baseline_names_only_files_that_still_swallow(self):
        cfg = json.loads((REPO / ls.CFG).read_text())
        _, nulls = ls.scan()
        for f, n in cfg["baseline"].items():
            self.assertEqual(nulls.get(f, 0), n, f"{f}: lower the baseline to what the file has now (python3 scripts/lint_swallow.py --rebaseline)")

    def test_a_bare_except_and_a_new_dev_null_fail(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "a.py").write_text("try:\n    x()\nexcept:\n    pass\n")
            (d / "ok.py").write_text("try:\n    x()\nexcept ValueError as e:\n    print(e)\n")
            (d / "old.sh").write_text("ls 2>/dev/null\n")
            (d / "new.sh").write_text("rm x 2> /dev/null\n")
            bad = ls.check(d, CFG)
            self.assertEqual(len(bad), 2)
            self.assertTrue(bad[0].startswith("a.py:3:")); self.assertTrue(bad[1].startswith("new.sh:"))
            (d / "old.sh").write_text("ls 2>/dev/null; ls 2>/dev/null\n")
            self.assertEqual(len(ls.check(d, CFG)), 3)


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DEPLOY-RECORD-MERGE-1: no workflow records on main with `git pull --rebase` (it stops on generated claim blocks); they use tools/record_main.sh."""
import pathlib, unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]

class RecordMain(unittest.TestCase):
    def test_no_rebase_before_push_main(self):
        bad = [p.name for p in (ROOT / ".github/workflows").glob("*.yml") if "pull --rebase" in p.read_text() and "push_main.py" in p.read_text()]
        self.assertEqual(bad, [], "use tools/record_main.sh instead of git pull --rebase before push_main.py")

    def test_record_main_resolves_generated(self):
        t = (ROOT / "tools/record_main.sh").read_text()
        self.assertIn("scripts/resolve_generated.py", t); self.assertIn("tools/push_main.py", t); self.assertIn("merge --abort", t)

if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import json, tempfile, unittest
from pathlib import Path
from foundation import disclosure


class Disclosure(unittest.TestCase):
    def test_main_passes(self):
        self.assertEqual(disclosure.check(), [])

    def test_new_spec_fails(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / "doctrine").mkdir(); (root / "specs").mkdir()
            (root / "doctrine" / "disclosure.json").write_text(json.dumps({"public_spec_dir": "specs", "baseline": ["US-SPEC-00-a.md"]}))
            (root / "specs" / "US-SPEC-00-a.md").write_text("x"); (root / "specs" / "US-SPEC-40-new.md").write_text("x")
            self.assertEqual(disclosure.check(root), ["US-SPEC-40-new.md"])


if __name__ == "__main__":
    unittest.main()

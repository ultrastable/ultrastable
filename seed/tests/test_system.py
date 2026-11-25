# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-1: the one definition of an Ultrastable system names real code for every part; HUMAN-VOICE-1 lint works."""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import humanvoice  # noqa: E402
import system  # noqa: E402


class System(unittest.TestCase):
    def test_every_part_has_code_and_the_page_is_current(self):
        self.assertEqual(system.check(ROOT), [])

    def test_sections_cover_the_five_questions(self):
        ids = [s["id"] for s in system.load(ROOT)["sections"]]
        self.assertEqual(ids, ["is", "runs", "bootstraps", "autonomous", "criticality"])

    def test_cli(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts/system.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)


class HumanVoice(unittest.TestCase):
    def test_flags_stock_phrases_and_passes_plain_text(self):
        self.assertTrue(humanvoice.lint("In conclusion, this cutting-edge tool will revolutionize work."))
        self.assertTrue(humanvoice.lint("We value transparency, accountability, and innovation."))
        self.assertEqual(humanvoice.lint("The tick ran 144 times and closed two items."), [])


if __name__ == "__main__":
    unittest.main()

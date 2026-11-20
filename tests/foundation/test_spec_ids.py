# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPEC-IDS-1: a requirement ID is never renumbered, removed or reused."""
import importlib.util, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("spec_ids", REPO / "scripts/spec_ids.py")
si = importlib.util.module_from_spec(spec); spec.loader.exec_module(si)


class SpecIds(unittest.TestCase):
    def test_repository_ids_are_stable(self):
        self.assertEqual(si.check(), [])
        self.assertGreater(len(si.defined()), 100)

    def test_removed_renumbered_reused_and_misplaced_ids_fail(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); (d / "specs").mkdir()
            (d / "specs/US-SPEC-03-tick.md").write_text("- **US-03-R01 [L1]** a\n- **US-03-R02 [L1]** b\n")
            self.assertEqual(si.check(d, ["US-03-R01", "US-03-R02"]), [])
            (d / "specs/US-SPEC-03-tick.md").write_text("- **US-03-R01 [L1]** a\n- **US-03-R03 [L1]** b renumbered\n")
            bad = si.check(d, ["US-03-R01", "US-03-R02"])
            self.assertTrue(any(b.startswith("US-03-R02: recorded but no longer defined") for b in bad))
            self.assertTrue(any(b.startswith("US-03-R03: defined but not recorded") for b in bad))
            (d / "specs/US-SPEC-04-plus.md").write_text("- **US-03-R01 [L1]** reused elsewhere\n- **US-03-R09** wrong file\n")
            bad = si.check(d, ["US-03-R01", "US-03-R03", "US-03-R09"])
            self.assertTrue(any("defined 2 times" in b for b in bad)); self.assertTrue(any(b.startswith("US-03-R09: defined in US-SPEC-04") for b in bad))


if __name__ == "__main__":
    unittest.main()

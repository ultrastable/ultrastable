# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AUDIENCE-1 in every seeded system: the rules the seed ships are valid and a fresh system is measured, with unknown sources unmeasured."""
import importlib.util, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("audience", ROOT / "scripts/audience.py")
audience = importlib.util.module_from_spec(spec); spec.loader.exec_module(audience)


class SeedAudience(unittest.TestCase):
    def test_rules_valid(self):
        self.assertEqual(audience.check(ROOT), [])

    def test_fresh_system_is_measured_honestly(self):
        r = audience.run(ROOT, live=False)
        self.assertIn("depth_7d", r["unmeasured"])
        self.assertIn("breadth", r["values"])


if __name__ == "__main__":
    unittest.main()

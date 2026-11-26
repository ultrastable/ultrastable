# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLOW-BALANCE-1 ships in every new system: the rules load and the loop is wired to a daily workflow."""
import importlib.util, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SeedBalance(unittest.TestCase):
    def test_rules_and_workflow(self):
        spec = importlib.util.spec_from_file_location("balance", ROOT / "scripts/balance.py")
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        self.assertEqual(m.check(ROOT), [])
        self.assertIn("scripts/balance.py --run --apply", (ROOT / ".github/workflows/balance.yml").read_text())


if __name__ == "__main__":
    unittest.main()

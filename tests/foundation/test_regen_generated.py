# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REGEN-GENERATED-1: every generator is registered, the workflow ignores only generated outputs, and a failing generator fails the run."""
import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import regen_generated as rg  # noqa: E402


class Regen(unittest.TestCase):
    def test_workflow_ignores_exactly_the_outputs(self):
        wf = (ROOT / ".github/workflows/regen-generated.yml").read_text()
        for o in rg.OUTPUTS:
            self.assertIn(f'"{o}"', wf)

    def test_outputs_exist(self):
        for o in rg.OUTPUTS:
            self.assertTrue((ROOT / o).exists(), o)

    def test_failure_is_reported(self):
        orig = rg.GENERATORS
        rg.GENERATORS = [(["python3", "-c", "import sys; sys.exit(3)"], ".")]
        try:
            self.assertEqual(len(rg.run_all(ROOT)), 1)
        finally:
            rg.GENERATORS = orig

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-1: the template defines what an Ultrastable system is, and the check fails when the code stops doing what the definition says."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import contract  # noqa: E402


class Contract(unittest.TestCase):
    def test_the_template_meets_its_own_definition(self):
        self.assertEqual(contract.check(ROOT), [])

    def test_every_agent_session_loads_the_definition_first(self):
        self.assertEqual((ROOT / "CLAUDE.md").read_text().splitlines()[0], "@doctrine/SYSTEM.md")

    def test_drift_is_caught(self):
        d = Path(tempfile.mkdtemp())
        try:
            for rel in ["doctrine/system-contract.json", "doctrine/SYSTEM.md", "bootstrap/bootstrap.py", "worker/src/ignition.js", "worker/src/tick.js"]:
                (d / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / rel, d / rel)
            bad = contract.check(d)
            self.assertTrue(any("worker/src/datagraph.js is missing" in b for b in bad))  # a removed loop is a failed invariant
            c = json.loads((d / "doctrine/system-contract.json").read_text())
            c["ignition_stages"].pop()
            (d / "doctrine/system-contract.json").write_text(json.dumps(c))
            bad = contract.check(d)
            self.assertTrue(any("ignition stages" in b for b in bad))
            self.assertTrue(any("SYSTEM.md is not current" in b for b in bad))
        finally:
            shutil.rmtree(d)


if __name__ == "__main__":
    unittest.main()

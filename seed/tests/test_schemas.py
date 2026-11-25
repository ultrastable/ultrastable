# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1: every JSON config this system ships validates against its JSON Schema (schemas/catalog.json)."""
import importlib.util, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("schemas", ROOT / "scripts/schemas.py")
schemas = importlib.util.module_from_spec(spec); spec.loader.exec_module(schemas)


class Schemas(unittest.TestCase):
    def test_configs_match_their_schemas(self):
        self.assertEqual(schemas.check(ROOT), [])


if __name__ == "__main__":
    unittest.main()

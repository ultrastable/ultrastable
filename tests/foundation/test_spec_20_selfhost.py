# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-20-R19 (US-SPEC-20): the organization boots from its own repository alone. The verifier (foundation/selfhost.py) passes on this
checkout, and the data files it reads are in the repository. The verifier's failure cases are tested in tests/foundation/test_selfhost.py."""
import json
import subprocess
import sys
import unittest

from _repo import ROOT

FILES = ("instances/ultrastable/selfhost.json", "instances/ultrastable/gaps.json", "platform/adapters/registry.json")


class SelfhostVerifier(unittest.TestCase):
    def test_us_20_r19_the_verifier_passes_on_this_checkout(self):
        r = subprocess.run([sys.executable, "-m", "foundation", "selfhost", "--verify"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("selfhost ok", r.stdout)

    def test_us_20_r19_the_data_the_verifier_reads_is_in_the_repository(self):
        for rel in FILES:
            self.assertTrue((ROOT / rel).is_file(), rel)
            json.loads((ROOT / rel).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation import proofown


class ProofOwn(unittest.TestCase):
    def test_no_qnfo_data_on_proof_surfaces(self):
        self.assertEqual(proofown.scan(), [])


if __name__ == "__main__":
    unittest.main()

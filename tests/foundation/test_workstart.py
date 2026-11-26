# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import unittest

from foundation import workstart


class WorkStart(unittest.TestCase):
    def test_pure_parts(self):
        self.assertEqual(workstart.main(["--check"]), 0)

    def test_body_links_issue_and_handoff(self):
        b = workstart.body(42)
        self.assertIn("Closes #42", b)
        self.assertIn("## Handoff", b)


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PR-PROBE-REST-1: the OL-PR closing probe reads the pull request over REST first, so it works where GraphQL is refused."""
import unittest
from foundation import loopowner

class PrProbeRest(unittest.TestCase):
    def test_rest_first(self):
        calls = []
        def gh(root, *a, **k):
            calls.append(a); return (0, "MERGED\n") if a[0] == "api" else (1, "graphql refused")
        self.assertEqual(loopowner.closed(5, ".", gh=gh), (True, "MERGED"))
        self.assertEqual(calls[0][0], "api")

    def test_graphql_fallback(self):
        def gh(root, *a, **k):
            return (1, "no") if a[0] == "api" else (0, "CLOSED")
        self.assertTrue(loopowner.closed(5, ".", gh=gh)[0])

    def test_open_is_not_closed(self):
        self.assertFalse(loopowner.closed(5, ".", gh=lambda r, *a, **k: (0, "OPEN"))[0])

if __name__ == "__main__":
    unittest.main()

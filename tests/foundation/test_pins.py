# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import json, unittest
from foundation import pins


class Pins(unittest.TestCase):
    def test_unpinned_never_grows(self):
        base = json.loads((pins.ROOT / "doctrine/supply-chain.json").read_text())["unpinned_baseline"]
        self.assertLessEqual(len(pins.unpinned()), base)

    def test_sha_counts_as_pinned(self):
        self.assertTrue(pins.SHA.search("actions/checkout@" + "a" * 40))
        self.assertFalse(pins.SHA.search("actions/checkout@v7"))


if __name__ == "__main__":
    unittest.main()

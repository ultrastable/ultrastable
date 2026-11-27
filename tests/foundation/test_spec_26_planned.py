# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-26 (requirement the code does not yet meet): R76. The closing probe of its PLANNED row in section 14 of
specs/US-SPEC-26-ignition-criticality-ultrastability.md. It is an expected failure: it reports as such today, and the first change that makes it pass
turns it into an unexpected success, which tells the owner of the change to remove the decorator."""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import ultrastability as u  # noqa: E402


class PredictionNamesTheBreachedBound(unittest.TestCase):
    @unittest.expectedFailure
    def test_r76_an_item_for_a_variable_over_its_maximum_predicts_the_maximum(self):
        v = {"reading": "some_reading", "min": 0, "max": 1.0}
        text = u._predict(v)
        self.assertRegex(text, r"^some_reading <= 1\.0 within \d+ h$", "a prediction for a variable over 1.0 must be false when filed with the reading at 1.5")


if __name__ == "__main__":
    unittest.main()

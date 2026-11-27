# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-26 R76: the prediction on a second-loop item follows the side its reading left the bounds on. This was the closing probe of a PLANNED row
(an expected failure); `_predict` in foundation/ultrastability.py now takes the reading, so the probe is an ordinary test."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import ultrastability as u  # noqa: E402


class PredictionNamesTheBreachedBound(unittest.TestCase):
    V = {"id": "v", "name": "Some variable", "why": "why", "reading": "some_reading", "min": 0, "max": 1.0}

    def test_r76_an_item_for_a_variable_over_its_maximum_predicts_the_maximum(self):
        """US-26-R76: a reading over the maximum predicts `<= max`; under the minimum it predicts `>= min`; an unmeasured reading names the minimum."""
        self.assertRegex(u._predict(self.V, value=1.5), r"^some_reading <= 1\.0 within \d+ h$", "a `>= 0` prediction for a reading of 1.5 is true when filed")
        self.assertRegex(u._predict(self.V, value=-0.5), r"^some_reading >= 0 within \d+ h$")
        self.assertRegex(u._predict(self.V), r"^some_reading >= 0 within \d+ h$", "no reading: the minimum is named, as before")
        self.assertRegex(u._predict(self.V, value=True), r"^some_reading >= 0 within \d+ h$", "a boolean is not a numeric reading")
        only_max = {**self.V, "min": None}
        self.assertRegex(u._predict(only_max, value=0.2), r"^some_reading <= 1\.0 within \d+ h$", "a variable with only a maximum always names it")

    def test_r76_the_filed_item_carries_the_prediction_for_its_own_reading(self):
        """US-26-R76: the item written to docs/issues for a variable read at 1.5 against limits 0 and 1.0 carries `<= 1.0`."""
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "docs/issues").mkdir(parents=True)
            step = {"kind": "item", "what": "lower it", "labels": ["p1"], "workstream": "Ultrastability"}
            iid = u._item(d, {"item_prefix": "Q-ULTRA"}, "v:x", self.V, 0, step, 1.5)
            body = json.loads((Path(d) / "docs/issues" / (iid + ".json")).read_text())["body"]
            self.assertIn("**Prediction:** some_reading <= 1.0 within 72 h", body)


if __name__ == "__main__":
    unittest.main()

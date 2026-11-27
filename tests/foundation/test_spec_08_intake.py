# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-08 section 5, the parts whose reference implementation is the foundation: the SPEC-GATE-1 intake rule (a new item carries a done check,
a predicted metric, an out-of-scope line and a live closing probe) and the share of open items that pass it (the essential variable spec_quality)."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(Path(__file__).resolve().parent))
from foundation import specgate  # noqa: E402
from _repo import scratch  # noqa: E402

FULL = ("**Owner:** operations\n**Status:** open\n**Done check:** cmd:python3 -m foundation specgate --check\n**Prediction:** spec_quality >= 0.9 within 24 h\n"
        "**Out of scope:** changing the baseline\n**Closing probe:** python3 -m foundation specgate --check\n")


class SpecGateIntake(unittest.TestCase):
    def test_us_08_intake_names_every_missing_part(self):
        self.assertEqual(specgate.missing(FULL), [])
        self.assertEqual(specgate.missing("**Status:** open\n**Done check:** read it\n"), ["done", "predict", "scope", "proof"])
        self.assertEqual(specgate.missing(FULL.replace("**Out of scope:** changing the baseline\n", "")), ["scope"])
        self.assertEqual(specgate.missing(None), ["done", "predict", "scope", "proof"])

    def test_us_08_quality_is_the_share_of_open_items_that_pass_and_closed_items_are_not_counted(self):
        d = scratch(); (d / "docs/issues").mkdir(parents=True)
        for iid, body in (("Q-A", FULL), ("Q-B", "**Status:** open\nnothing else"), ("Q-C", FULL.replace("open", "closed")), ("Q-D", FULL)):
            (d / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "body": body}), encoding="utf-8")
        r = specgate.report(d)
        self.assertEqual((r["open"], r["passing"], r["quality"]), (3, 2, 0.667))
        self.assertEqual(list(r["failing"]), ["Q-B"])
        self.assertEqual(specgate.quality(d), 0.667)
        self.assertEqual(specgate.report(scratch())["quality"], 1.0, "no open item: nothing fails")


if __name__ == "__main__":
    unittest.main()

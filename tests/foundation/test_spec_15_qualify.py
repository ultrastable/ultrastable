# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-15: US-15-R22, an idea passes the system test of VISION.md before any project is started, and one that fails it is answered plainly as
not a fit. The implementation is the seed bootstrapper's `qualify` stage (seed/bootstrap/bootstrap.py), which hires nothing and provisions nothing
when the idea fails; the front door's `systemTest` (site/worker.js) is its twin and is covered by site/site.test.mjs.

Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_15_qualify.py"""
import shutil
import sys
import unittest
from pathlib import Path

from _repo import ROOT, scratch

sys.path.insert(0, str(ROOT / "seed" / "bootstrap"))
import bootstrap as bs  # noqa: E402


def boot(idea_text: str):
    d = scratch()
    seed = ROOT / "seed"
    (d / "ultrastable.json").write_bytes((seed / "ultrastable.json").read_bytes())
    (d / "autonomy").mkdir()
    (d / "autonomy" / "policy.json").write_bytes((seed / "autonomy" / "policy.json").read_bytes())
    (d / "IDEA.md").write_text(idea_text, encoding="utf-8")
    b = bs.Boot(d, d / "org", apply=False)
    b.guard("read", b.read)
    b.guard("qualify", b.qualify)
    return b


FIT = ("---\norg_name: Signals\n---\n# Idea\nA signals desk that watches markets against my own rules.\n# First outcomes\n- A daily list I trust\n"
       "# System test\n- Loop: sources read, signals scored against outcomes, rules adjusted, with no person in the middle\n"
       "- Measure: share of signals that held after five days, target 0.6\n- Upkeep: sources and rules change every week\n"
       "- Run cost: model calls and storage every month\n# Constraints\n- Budget per month: 40 USD\n")


class QualifyBeforeProject(unittest.TestCase):
    def test_US_15_R22_an_idea_that_passes_all_four_parts_is_a_fit(self):
        b = boot(FIT)
        self.assertTrue(b.fit, b.log)

    def test_US_15_R22_an_idea_missing_any_one_part_is_not_a_fit_and_nothing_is_staffed(self):
        for part in ("Loop", "Measure", "Upkeep", "Run cost"):
            lines = [ln for ln in FIT.splitlines() if not ln.startswith("- " + part + ":")]
            b = boot("\n".join(lines) + "\n")
            self.assertFalse(b.fit, part)
            self.assertTrue(any(c["id"] == "GATE-FIT" for c in b.state["gate_cards"]), part)
            self.assertFalse(hasattr(b, "roles"), "nothing may be staffed for a non-system: " + part)

    def test_US_15_R22_an_idea_with_no_stated_budget_is_not_a_fit(self):
        b = boot(FIT.replace("- Budget per month: 40 USD", "- Budget per month: 0 USD"))
        self.assertFalse(b.fit)

    def test_US_15_R22_the_answer_says_plainly_what_is_missing_and_that_nothing_was_provisioned(self):
        b = boot("---\norg_name: Trip\n---\n# Idea\nA packing list for camping trips.\n# First outcomes\n- A page\n# Constraints\n- Budget per month: 10 USD\n")
        card = next(c for c in b.state["gate_cards"] if c["id"] == "GATE-FIT")
        self.assertIn("Not a fit", json_text(card))
        self.assertIn("nothing is staffed or provisioned", json_text(card))


def json_text(obj) -> str:
    import json
    return json.dumps(obj)


if __name__ == "__main__":
    unittest.main()

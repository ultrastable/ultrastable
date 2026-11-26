# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""US-10-R10: the reviewer is designated from a different model family than the author where two exist."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bootstrap"))
sys.path.insert(0, str(ROOT / "tests"))
import bootstrap as bs  # noqa: E402
from test_seed import Hermetic, copy_seed  # noqa: E402


def boot(d: Path, budget: str):
    copy_seed(d)
    idea = d / "IDEA.md"
    idea.write_text(idea.read_text().replace("50 USD", f"{budget} USD"))
    assert bs.main(["--root", str(d), "--dry-run"]) == 0
    return json.loads((d / "org/roles.json").read_text()), (d / "org/charter.md").read_text()


class ReviewerFamily(Hermetic):
    def test_budget_50_designates_a_reviewer_from_another_family_than_the_doer(self):
        with tempfile.TemporaryDirectory() as t:
            roles, charter = boot(Path(t), "50")
            by_role = {}
            for r in roles:
                by_role.setdefault(r["role"], set()).add((r["family"], r["model"]))
            doer, reviewer = by_role["staff"], by_role["reviewer"]
            self.assertTrue(doer and reviewer)
            self.assertFalse({f for f, _ in doer} & {f for f, _ in reviewer}, (doer, reviewer))
            self.assertIn("open-weights family", charter)
            self.assertNotIn("known limit", charter)

    def test_budget_0_keeps_one_family_and_states_the_known_limit(self):
        with tempfile.TemporaryDirectory() as t:
            roles, charter = boot(Path(t), "0")
            self.assertIn("claude-haiku-5-5", charter)
            self.assertIn("reviewer and doer share a family: known limit", charter)
            self.assertEqual({r["family"] for r in roles if r["role"] in ("staff", "reviewer")}, {"claude"})


if __name__ == "__main__":
    unittest.main()

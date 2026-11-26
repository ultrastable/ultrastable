# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""LESSONS-1: an unenforced lesson is held by an open item, and that item closes only on its own lesson's probe.

The fixture repeats the 2026-11-26 incident: the queue closed Q-LESSON-no-date-bombs as fixed on the done check `lessons --check`,
which passes exactly while the item is held, and closing it turned the same check red on main.
"""
import json, tempfile, unittest
from pathlib import Path
from foundation import lessons as L


def body(done, status="open", disposition=None):
    b = (f"**Owner:** executor\n**Trigger:** lesson x has no enforcing code\n**Done check:** {done}\n**Status:** {status}\n\n"
         "**Prediction:** date_bombs <= 0 within 168 h\n**Out of scope:** nothing else.\n\n"
         "**Closing probe:** `python3 -m foundation lessons --probe dates` exits 0 on main.\n")
    if disposition:
        b += f"\n**Disposition:** {disposition}\n"
    return b


class Lessons(unittest.TestCase):
    def repo(self, item_body, enforced=False):
        d = Path(tempfile.mkdtemp())
        (d / "doctrine").mkdir()
        (d / "docs/issues").mkdir(parents=True)
        (d / ".github/workflows").mkdir(parents=True)
        (d / ".github/workflows/checks.yml").write_text("run: python3 -m foundation datebombs --check\n")
        (d / "doctrine/ultrastability.json").write_text(json.dumps({"scopes": {}}))
        (d / "doctrine/detectors.json").write_text(json.dumps({"detectors": []}))
        binding = [{"kind": "check", "ref": "datebombs --check"}] if enforced else []
        (d / L.PATH).write_text(json.dumps({"lessons": [{"id": "dates", "lesson": "no date bombs", "enforced_by": binding, "item": "Q-LESSON-dates"}]}))
        (d / "docs/issues/Q-LESSON-dates.json").write_text(json.dumps({"id": "Q-LESSON-dates", "body": item_body}))
        return d

    def test_probe_fails_until_a_binding_resolves(self):
        self.assertIs(L.probe(self.repo(body("cmd:python3 -m foundation lessons --probe dates")), "dates"), False)
        self.assertIs(L.probe(self.repo(body("cmd:python3 -m foundation lessons --probe dates"), enforced=True), "dates"), True)
        self.assertIsNone(L.probe(self.repo(body("cmd:x")), "nope"))

    def test_item_that_closes_on_the_whole_check_is_refused(self):
        errs = L.check(self.repo(body("cmd:python3 -m foundation lessons --check")))
        self.assertTrue(any("must be cmd:python3 -m foundation lessons --probe dates" in e for e in errs), errs)

    def test_held_item_with_its_own_probe_passes(self):
        self.assertEqual(L.check(self.repo(body("cmd:python3 -m foundation lessons --probe dates"))), [])
        shelved = body("cmd:python3 -m foundation lessons --probe dates", status="closed", disposition="shelved (executor-failed, DISPOSE-1)")
        self.assertEqual(L.check(self.repo(shelved)), [])

    def test_item_closed_as_fixed_while_unenforced_still_fails(self):
        fixed = body("cmd:python3 -m foundation lessons --probe dates", status="closed", disposition="fixed (executor-failed, DISPOSE-1)")
        errs = L.check(self.repo(fixed))
        self.assertTrue(any("unenforced, and item Q-LESSON-dates is missing or closed" in e for e in errs), errs)

    def test_enforced_lesson_needs_no_item_probe(self):
        self.assertEqual(L.check(self.repo(body("cmd:python3 -m foundation lessons --check"), enforced=True)), [])


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-00: requirement identifiers are stable (US-00-R11) and a BUILT label is machine-checked against the tree (US-00-R12 and US-00-R14).

The fixtures use a specification number no real specification has (77), so this file cites no real requirement by accident.
Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_00_ids.py"""
import json
import sys
import unittest
from pathlib import Path

from _repo import ROOT, scratch

sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "workers" / "tools"))
import spec_ids  # noqa: E402
import spec_truth  # noqa: E402
import req_ids  # noqa: E402

P = "US-"


def tree(spec_text: str, ledger=None, code=None):
    """A scratch repository: one specification (number 77), a ledger of recorded identifiers and some code files."""
    root = scratch()
    (root / "specs").mkdir(parents=True, exist_ok=True)
    (root / "specs" / "US-SPEC-77-example.md").write_text(spec_text, encoding="utf-8")
    (root / "doctrine").mkdir(parents=True, exist_ok=True)
    (root / "doctrine" / "spec-ids.json").write_text(json.dumps({"ids": ledger or []}), encoding="utf-8")
    for name, text in (code or {}).items():
        f = root / "code" / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    return root


R1, R2 = f"{P}77-R01", f"{P}77-R02"
SPEC = f"# US-SPEC-77\n\n- **{R1} [L1]** A thing MUST hold.\n- **{R2} [L2]** Another SHOULD hold.\n"


class Identifiers(unittest.TestCase):
    def test_us_00_r11_a_requirement_is_never_renumbered_reused_or_dropped(self):
        ok = tree(SPEC, ledger=[R1, R2])
        self.assertEqual(spec_ids.check(ok), [])
        twice = tree(SPEC + f"- **{R1} [L1]** The same identifier again.\n", ledger=[R1, R2])
        self.assertTrue(any("defined 2 times" in b and R1 in b for b in spec_ids.check(twice)), "an identifier is never reused")
        wrong = tree(f"# x\n- **{P}78-R01 [L1]** Defined under specification 77.\n", ledger=[f"{P}78-R01"])
        self.assertTrue(any("not specification 78" in b for b in spec_ids.check(wrong)), "an identifier sits in the specification its number names")
        gone = tree(f"# x\n- **{R1} [L1]** A thing MUST hold.\n", ledger=[R1, R2])
        self.assertTrue(any(R2 in b and "recorded but no longer defined" in b for b in spec_ids.check(gone)), "dropping a requirement is an error")
        withdrawn = tree(f"# x\n- **{R1} [L1]** A thing MUST hold.\n- **{R2} [L2]** Withdrawn in 0.3.0.\n", ledger=[R1, R2])
        self.assertEqual(spec_ids.check(withdrawn), [], "a withdrawn requirement keeps its identifier and its line")
        new = tree(SPEC, ledger=[R1])
        self.assertEqual([b.split(":")[0] for b in spec_ids.check(new)], [R2])
        self.assertIn("defined but not recorded", spec_ids.check(new)[0])

    def test_us_00_r11_the_requirements_of_this_repository_are_all_stable_or_awaiting_their_record(self):
        # a requirement added since the ledger was last written is "defined but not recorded", never anything worse
        other = [b for b in spec_ids.check(ROOT) if "defined but not recorded" not in b]
        self.assertEqual(other, [])

    def test_us_00_r12_a_built_line_that_names_a_file_that_is_not_there_is_found(self):
        code = {"a.js": "// real\n", "sub/b.py": "# real\n"}
        spec = ("# US-SPEC-77\n\n## 8. Reference implementation status\n\n"
                "- Thing: BUILT in `a.js` with tests in `sub/b.py`.\n"
                "- Other: BUILT in `missing/file.js`.\n"
                "- Half: BUILT in `a.js` and `missing/other.js`.\n"
                "- Plan: PLANNED in `nowhere/file.js`.\n"
                "- Bare: BUILT with no file named.\n")
        root = tree(spec, code=code)
        found = spec_truth.findings(root / "specs", root / "code")
        by_line = {f["text"].split(":")[0].lstrip("- "): f["problem"] for f in found}
        self.assertEqual(by_line, {"Other": "labelled BUILT but none of the named paths exist", "Half": "some named paths do not exist", "Bare": "labelled BUILT but names no file"})
        self.assertNotIn("Thing", by_line); self.assertNotIn("Plan", by_line)

    def test_us_00_r14_an_identifier_that_code_cites_and_no_specification_defines_is_found(self):
        root = tree(SPEC, code={"a.js": f"// {R1} and {P}77-R09\n"})
        self.assertEqual(req_ids.undefined(root / "specs", root / "code"), [{"id": f"{P}77-R09", "files": ["a.js"]}])


if __name__ == "__main__":
    unittest.main()

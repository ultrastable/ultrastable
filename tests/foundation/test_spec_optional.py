# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DISCLOSE-1: the full specification is private, so every tool and test that reads its text works without it and says so.

Without ULTRASTABLE_SPEC_DIR the specification tools report `unmeasured` (never a pass), the conformance CLI refuses to rewrite the manifest from no text,
and a foundation test that compares specification text with code skips. With the directory set they run in full mode as before.

Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_optional.py"""
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from _repo import ROOT, spec_files
from foundation import disclosure


class SpecOptional(unittest.TestCase):
    def test_a_test_that_needs_the_text_skips_without_the_directory(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ULTRASTABLE_SPEC_DIR", None)
            with self.assertRaises(unittest.SkipTest):
                spec_files("US-SPEC-*.md")

    def test_it_reads_the_directory_when_it_is_mounted(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "US-SPEC-77-example.md").write_text("- **US-77-R01 [L1]** x\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {"ULTRASTABLE_SPEC_DIR": d}):
                self.assertEqual([p.name for p in spec_files("US-SPEC-*.md")], ["US-SPEC-77-example.md"])

    def test_an_empty_directory_skips_too(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(os.environ, {"ULTRASTABLE_SPEC_DIR": d}):
            with self.assertRaises(unittest.SkipTest):
                spec_files("US-SPEC-*.md")

    def test_every_specification_tool_reports_unmeasured_without_the_text(self):
        self.assertEqual(disclosure.tooling(ROOT), [])

    def test_the_tooling_check_catches_a_tool_that_passes_on_no_text(self):
        liar = [(["python3", "-c", "print('0 problems')"], "unmeasured")]
        with mock.patch.object(disclosure, "TOOLS", liar):
            bad = disclosure.tooling(ROOT)
        self.assertTrue(any("false pass" in b for b in bad), bad)

    def test_the_tooling_check_catches_a_crash(self):
        crash = [(["python3", "-c", "raise SystemExit(open('/no/such/file'))"], "unmeasured")]
        with mock.patch.object(disclosure, "TOOLS", crash):
            bad = disclosure.tooling(ROOT)
        self.assertTrue(bad, bad)

    def test_the_manifest_is_not_rewritten_by_the_check(self):
        m = ROOT / "workers/core/conformance/manifest.json"
        before = m.read_bytes()
        disclosure.tooling(ROOT)
        self.assertEqual(m.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()

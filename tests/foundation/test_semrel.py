# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1: Conventional Commits drive the SemVer bump and the Keep a Changelog text."""
import unittest

import _repo
from foundation import semrel


class Bump(unittest.TestCase):
    def test_types(self):
        self.assertEqual(semrel.classify("feat(site): add feed")[:2], ("minor", "Added"))
        self.assertEqual(semrel.classify("fix: stop crash")[:2], ("patch", "Fixed"))
        self.assertEqual(semrel.classify("feat!: drop v1")[0], "major")
        self.assertEqual(semrel.classify("queue: verdicts")[:2], ("patch", "Changed"))
        self.assertIsNone(semrel.classify("watchdog: clock probe [skip ci]"))
        self.assertEqual(semrel.classify("chore: x", "BREAKING CHANGE: y")[0], "major")

    def test_version_and_render(self):
        self.assertEqual(semrel.bump("1.2.3", "minor"), "1.3.0")
        self.assertEqual(semrel.bump("1.2.3", "major"), "2.0.0")
        out = semrel.render({"version": "0.1.0", "date": "2026-11-25", "sections": {"Added": ["a"], "Fixed": ["b"]}})
        self.assertIn("## [0.1.0] - 2026-11-25", out)
        self.assertLess(out.index("### Added"), out.index("### Fixed"))

    def test_plan_on_this_repo_runs(self):
        p = semrel.plan()
        self.assertRegex(p["version"], r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()

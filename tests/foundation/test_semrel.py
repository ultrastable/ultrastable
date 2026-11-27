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

    def test_apply_keeps_unreleased_first_and_never_lists_a_version_twice(self):
        import importlib.util, subprocess, tempfile
        from pathlib import Path
        spec = importlib.util.spec_from_file_location("rc", Path(semrel.REPO) / "seed/scripts/repoconform.py")
        rc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(rc)
        with tempfile.TemporaryDirectory() as d:
            g = lambda *a: subprocess.run(["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t", *a], check=True, capture_output=True)  # noqa: E731
            g("init", "-q")
            g("commit", "-q", "--allow-empty", "-m", "feat: first")
            self.assertEqual(semrel.apply(d)["version"], "0.1.0")
            self.assertTrue(semrel.apply(d)["refused"])  # VERSION is not committed yet: 0.1.0 again is refused, not written twice
            g("add", "-A"); g("commit", "-q", "-m", "chore: release 0.1.0")
            g("commit", "-q", "--allow-empty", "-m", "fix: second")
            self.assertEqual(semrel.apply(d)["version"], "0.1.1")  # no tag: the release is read from the commit that wrote VERSION
            text = (Path(d) / "CHANGELOG.md").read_text()
            heads = [ln for ln in text.splitlines() if ln.startswith("## ")]
            self.assertEqual([h.split(" - ")[0] for h in heads], ["## [Unreleased]", "## [0.1.1]", "## [0.1.0]"])
            self.assertEqual(rc.changelog(d, text, {}), [])

    def test_plan_on_this_repo_runs(self):
        p = semrel.plan()
        self.assertRegex(p["version"], r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import io, sys, unittest
import unittest.mock as mock
from contextlib import redirect_stdout
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import github_settings as gs  # noqa: E402


class SettingsTests(unittest.TestCase):
    def test_us_24_t06_us_24_r34_dry_run_is_default_and_prints_commands(self):
        out = io.StringIO()
        with redirect_stdout(out), mock.patch.object(gs.subprocess, "run") as run:
            code = gs.main([])
            run.assert_not_called()
        text = out.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("DRY RUN", text)
        self.assertIn("default_workflow_permissions=read", text)
        self.assertIn("approval_policy=all_external_contributors", text)
        self.assertIn("repos/ultrastable/workers", text)
        self.assertIn("allow_merge_commit=false", text)
        self.assertNotIn("-> exit", text)

    def test_no_leading_slash_in_api_paths(self):
        for c in gs.commands("o", ["r"]):
            self.assertFalse(any(a.startswith("/") for a in c), c)

    def test_us_24_r30_r31_r32_apply_runs_every_command_covering_token_fork_and_merge_settings(self):
        with redirect_stdout(io.StringIO()), mock.patch.object(gs.subprocess, "run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="", stderr="")
            gs.main(["--apply", "--repos", "r"])
            self.assertEqual(run.call_count, len(gs.commands("ultrastable", ["r"])))
        applied = " ".join(" ".join(c) for c in gs.commands("ultrastable", ["r"]))
        for setting in ("default_workflow_permissions=read", "can_approve_pull_request_reviews=false", "approval_policy=all_external_contributors", "allow_merge_commit=false", "allow_rebase_merge=false", "delete_branch_on_merge=true"):
            self.assertIn(setting, applied, setting)

    def test_us_24_r33_discussions_are_enabled_only_when_asked(self):
        self.assertFalse(any("has_discussions=true" in a for c in gs.commands("o", ["r"]) for a in c))
        self.assertTrue(any("has_discussions=true" in a for c in gs.commands("o", ["r"], discussions=True) for a in c))
        for flags, expected in (([], False), (["--discussions"], True)):
            out = io.StringIO()
            with redirect_stdout(out), mock.patch.object(gs.subprocess, "run"):
                gs.main(flags)
            self.assertEqual("has_discussions=true" in out.getvalue(), expected, flags)


if __name__ == "__main__":
    unittest.main()

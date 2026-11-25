# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CHECKSRUN-SCOPE-1: the session route of `checks` runs what a session can run, names what only Actions can, and never starts by accident."""
import unittest
from unittest import mock
from foundation import checksrun as C


class ChecksRun(unittest.TestCase):
    def test_actions_only_steps_are_named_not_failed(self):
        self.assertIn("other Actions jobs", C.unrunnable('[ "${{ needs.fast.result }}" = success ]', {}))
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertIn("GITHUB_REPOSITORY", C.unrunnable("bash scripts/lane.sh merge", {}))
        self.assertEqual(C.unrunnable("bash scripts/lane.sh merge", {"GITHUB_REPOSITORY": "ultrastable/ultrastable"}), "")
        self.assertEqual(C.unrunnable("python3 -m foundation rules --check", {}), "")

    def test_a_skipped_step_is_neither_a_failure_nor_a_pass(self):
        steps = [{"name": "a", "run": "true", "cwd": ".", "env": {}}, {"name": "gate", "run": 'test "${{ needs.fast.result }}" = success', "cwd": ".", "env": {}},
                 {"name": "b", "run": "false", "cwd": ".", "env": {}}]
        ran = []
        def runner(sc, cwd, env):
            ran.append(sc)
            return mock.Mock(returncode=0 if sc == "true" else 1, stdout="", stderr="no")
        with mock.patch.object(C, "steps", lambda root=None: steps):
            r = C.run(runner=runner)
        self.assertEqual((r["failed"], r["skipped"], ran), (["b"], ["gate"], ["true", "false"]))

    def test_help_and_unknown_arguments_run_nothing(self):
        with mock.patch.object(C, "run", side_effect=AssertionError("ran")):
            self.assertEqual(C.main(["--help"]), 0)
            self.assertEqual(C.main(["--list"]), 0)
            self.assertEqual(C.main(["--chekc"]), 2)

    def test_the_real_workflow_has_runnable_steps_and_names_the_two_gates(self):
        names = [s["name"] for s in C.steps() if C.unrunnable(C.resolve(s["run"]), {})]
        self.assertIn("Every parallel job passed", names)
        self.assertLess(len(names), 4)


if __name__ == "__main__":
    unittest.main()

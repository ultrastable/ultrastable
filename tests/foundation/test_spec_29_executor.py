# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-29 (visible progress, content stickiness and substantive change): the executor's own substance gate, `foundation/executor.py`.

US-29-R77 a change the executor builds that alters no executable behaviour opens no pull request, a substantive one does and the verdict is recorded on its row,
and a repair of an existing pull request is not held to the rule; US-29-T11 runs the three cases in turn. The scenario is the real `executor.run` over a scratch repository with a bare origin; only the
model, `gh` and the write-back command are replaced."""
import sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_executor  # noqa: E402  (its scratch world and run harness are reused; the class is not bound here, so none of its tests are collected from this file)


class ExecutorSubstanceGate(unittest.TestCase):
    _world = test_executor.PrRepair._world
    _run = test_executor.PrRepair._run

    def _redo(self, files):
        origin, d = self._world()
        from foundation import executor
        for _ in range(2):  # two failed repairs: the change is redone from main as a new pull request, which is the path the gate guards
            executor.log(d, {"issue": "OL-PR-9", "result": "failed", "mode": "pr-repair"})
        return self._run(d, lambda prompt: {"summary": "change", "files": files}) + (d,)

    def test_us_29_r77_a_change_with_no_executable_effect_is_refused_and_opens_no_pull_request(self):
        row, gh, _ = self._redo([{"path": "notes.txt", "content": "x\n"}])
        self.assertEqual(row["result"], "failed", row)
        self.assertIn("rejected-trivial (SUBSTANCE-1)", row["detail"])
        self.assertIn("no PR is opened for it", row["detail"])
        self.assertEqual(row["substance"], "record", "the verdict that refused it is on the row")
        self.assertNotIn(["pr", "create", "-R"], gh)

    def test_us_29_r77_a_change_that_only_bumps_a_literal_is_refused_with_its_verdict(self):
        origin, d = self._world()
        from foundation import executor
        (d / "mod.py").write_text("LIMIT = 3\n\ndef f():\n    return LIMIT\n")
        from _repo import git
        git(d, "add", "-A"); git(d, "commit", "-qm", "add mod"); git(d, "push", "-q", "origin", "main")
        for _ in range(2):
            executor.log(d, {"issue": "OL-PR-9", "result": "failed", "mode": "pr-repair"})
        row, gh = self._run(d, lambda prompt: {"summary": "bump", "files": [{"path": "mod.py", "content": "LIMIT = 4\n\ndef f():\n    return LIMIT\n"}]})
        self.assertEqual(row["result"], "failed", row)
        self.assertEqual(row["substance"], "trivial")
        self.assertIn("mod.py=literal", row["detail"], "the refusal names each file and its kind")
        self.assertNotIn(["pr", "create", "-R"], gh)

    def test_us_29_r77_a_change_that_alters_behaviour_is_recorded_substantive_and_opens_the_pull_request(self):
        row, gh, _ = self._redo([{"path": "b.py", "content": "def b():\n    return 2\n"}])
        self.assertEqual((row["result"], row["substance"]), ("pr-opened", "substantive"), row)
        self.assertIn(["pr", "create", "-R"], gh)

    def test_us_29_r77_a_repair_of_an_existing_pull_request_is_not_held_to_the_rule(self):
        origin, d = self._world()
        row, gh = self._run(d, lambda prompt: {"summary": "fix b", "files": [{"path": "b.txt", "content": "fixed\n"}]})
        self.assertEqual(row["result"], "pr-repaired", row)
        self.assertNotIn("substance", row, "no verdict is read for a repair")

    def test_us_29_r77_a_refused_change_of_nine_files_names_eight_of_them_with_their_kinds(self):
        # A reply carries at most 8 files, so the ninth is a file already left in the working tree: the gate reads the whole tree against HEAD.
        origin, d = self._world()
        from foundation import executor
        (d / "left-over.txt").write_text("from an earlier step\n")
        for _ in range(2):
            executor.log(d, {"issue": "OL-PR-9", "result": "failed", "mode": "pr-repair"})
        row, gh = self._run(d, lambda prompt: {"summary": "notes", "files": [{"path": f"notes/n{i}.txt", "content": f"{i}\n"} for i in range(8)]})
        self.assertEqual((row["result"], row["substance"]), ("failed", "record"), row)
        self.assertEqual(row["detail"].count("=record"), 8, row["detail"])
        self.assertNotIn(["pr", "create", "-R"], gh)

    def _with_mod(self):
        origin, d = self._world()
        from foundation import executor
        from _repo import git
        (d / "mod.py").write_text("LIMIT = 3\n\ndef f():\n    return LIMIT\n")
        git(d, "add", "-A"); git(d, "commit", "-qm", "add mod"); git(d, "push", "-q", "origin", "main")
        for _ in range(2):
            executor.log(d, {"issue": "OL-PR-9", "result": "failed", "mode": "pr-repair"})
        return d

    def test_us_29_t11_a_bumped_number_is_refused_a_logic_change_opens_a_pull_request_and_a_repair_carries_no_verdict(self):
        from _repo import git
        bump, gh = self._run(self._with_mod(), lambda prompt: {"summary": "bump", "files": [{"path": "mod.py", "content": "LIMIT = 4\n\ndef f():\n    return LIMIT\n"}]})
        self.assertEqual((bump["result"], bump["substance"]), ("failed", "trivial"), bump)
        self.assertIn("rejected-trivial (SUBSTANCE-1)", bump["detail"])
        self.assertNotIn(["pr", "create", "-R"], gh, "no pull request for the bumped number")
        logic, gh = self._run(self._with_mod(), lambda prompt: {"summary": "logic", "files": [{"path": "mod.py", "content": "LIMIT = 3\n\ndef f():\n    return LIMIT * 2\n"}]})
        self.assertEqual((logic["result"], logic["substance"]), ("pr-opened", "substantive"), logic)
        self.assertIn(["pr", "create", "-R"], gh)
        origin, d = self._world()
        repair, gh = self._run(d, lambda prompt: {"summary": "fix b", "files": [{"path": "b.txt", "content": "fixed\n"}]})
        self.assertEqual(repair["result"], "pr-repaired", repair)
        self.assertNotIn("substance", repair)
        self.assertEqual(git(origin, "show", "agent/feature:b.txt"), "fixed\n", "the repair is pushed to the pull request's own branch")
        self.assertNotIn(["pr", "create", "-R"], gh)

if __name__ == "__main__":
    unittest.main()

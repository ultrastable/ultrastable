# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-23-R12 to US-23-R14, US-23-R16, US-23-R19 and US-23-R20 (US-SPEC-23): the server owns every loop, every output has a code consumer,
code with no write-back fails, an open-loop record needs an owner, a trigger and a probe, a loop needs the full record and a server-side owner,
and an ask of a person needs an exhaustion proof. The engines are foundation/loopowner.py, foundation/closedloop.py, foundation/writeback.py,
foundation/loops.py and foundation/pathfinder.py; their wider suites are test_loopowner.py, test_closedloop.py, test_writeback.py,
test_loops.py and test_pathfinder.py in this folder."""
import json
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import ROOT, copy_repo, edit, git, scratch, tiny_repo  # noqa: E402
from foundation import closedloop, loopowner, loops, pathfinder, writeback  # noqa: E402

REG = "instances/ultrastable/loop-registry.json"


class WriteBack(unittest.TestCase):
    def branch(self, files):
        d = tiny_repo()
        git(d, "checkout", "-q", "-b", "work")
        for rel, text in files.items():
            (d / rel).parent.mkdir(parents=True, exist_ok=True)
            (d / rel).write_text(text, encoding="utf-8")
        git(d, "add", ".")
        git(d, "commit", "-q", "-m", "work\n\nClaude-Session: https://claude.ai/code/session_0abc")
        return d

    def test_us_23_r14_us_23_r19_a_change_that_adds_code_and_no_write_back_fails_and_a_write_back_passes(self):
        """T23-9: a change with code and no write-back fails the check; an open-loop record without owner, trigger and probe is refused."""
        bare = self.branch({"tool.py": "print(1)\n"})
        self.assertTrue(any("no write-back" in p for p in writeback.check(bare, "main", "HEAD")))
        recorded = self.branch({"tool.py": "print(1)\n", "docs/lessons/x.md": "Session: session_0abc\n"})
        self.assertEqual(writeback.check(recorded, "main", "HEAD"), [])
        r = copy_repo()
        for kw in ({}, {"owner": "staff"}, {"owner": "staff", "trigger": "next deploy"}, {"owner": "staff", "trigger": "next deploy", "probe": "vibes"}):
            with self.assertRaises(ValueError, msg=f"an open loop recorded with only {sorted(kw)} is refused"):
                writeback.record(r, "open-loop", "Re-render the card", "Card still shows the old line.", **kw)
        rel = writeback.record(r, "open-loop", "Re-render the card", "Card still shows the old line.", owner="staff", trigger="next site deploy",
                               probe="file:README.md", today="2026-12-01")
        self.assertTrue((r / rel).is_file(), "with an owner, a trigger and a probe the open loop is recorded")


class LoopRegistry(unittest.TestCase):
    def test_us_23_r20_a_loop_without_its_record_fails_the_registry_check(self):
        for mutate, expect in (
            (lambda l: l.pop("closing_probe"), "plussing: lacks closing_probe"),
            (lambda l: l.update(writeback=[]), "lacks writeback"),
            (lambda l: l.update(sla="soon"), "not a time bound"),
            (lambda l: l.pop("done"), "lacks done"),
            (lambda l: l.update(paths=l["paths"][:1]), "two independent paths"),
        ):
            r = copy_repo()
            edit(r / REG, lambda d: mutate(next(l for l in d["loops"] if l["id"] == "plussing")))
            self.assertTrue(any(expect in p for p in loops.verify(r)), expect)
        self.assertEqual(loops.verify(ROOT), [])

    def test_us_23_r12_us_23_r20_a_loop_whose_only_owner_is_a_client_session_fails(self):
        """T23-7: a loop with no server-side owner, or whose closing probe names a client session, fails the build."""
        d = scratch()
        (d / "doctrine").mkdir()
        (d / "instances/ultrastable").mkdir(parents=True)
        shutil.copy(ROOT / "doctrine/loop-ownership.json", d / "doctrine")
        loop = {"id": "x", "paths": [{"id": "a", "class": "session"}], "done": "ok", "closing_probe": "p", "trigger": "t"}
        (d / REG).write_text(json.dumps({"loops": [loop]}), encoding="utf-8")
        errs = loopowner.check(d)
        self.assertTrue(any("server_owner" in e for e in errs) and any("no server-side path" in e for e in errs), errs)
        loop.update(server_owner="ultrastable-tick", paths=[{"id": "a", "class": "free"}], closing_probe="the owner will merge it in a chat session")
        (d / REG).write_text(json.dumps({"loops": [loop]}), encoding="utf-8")
        self.assertEqual([e for e in loopowner.check(d) if "closing_probe" in e], ["x: closing_probe depends on a client or a person"])
        loop.update(closing_probe="p")
        (d / REG).write_text(json.dumps({"loops": [loop]}), encoding="utf-8")
        self.assertEqual(loopowner.check(d), [])


class EveryOutputHasAConsumer(unittest.TestCase):
    def test_us_23_r13_an_artifact_no_code_consumes_fails_and_so_does_a_human_named_as_an_approver(self):
        """T23-8: an artifact with no registered consumer fails the build, and so does a human named as a required approver."""
        self.assertEqual(closedloop.check(ROOT), [], "this repository is clean before the fixtures")
        r = copy_repo()
        (r / "docs/ops/new-note.md").write_text("A note for people.\n", encoding="utf-8")
        self.assertTrue(any("new-note.md" in b and "no code consumer" in b for b in closedloop.check(r)))
        r = copy_repo()
        (r / ".github/CODEOWNERS").write_text("* @someone\n", encoding="utf-8")
        self.assertTrue(any("CODEOWNERS" in b and "human approver" in b for b in closedloop.check(r)))


class ExhaustionProof(unittest.TestCase):
    def test_us_23_r16_an_ask_without_an_exhaustion_proof_fails_and_passes_once_every_surface_class_was_tried(self):
        d = scratch()
        for f in ("doctrine", "foundation/data", "ops/paths"):
            (d / f).mkdir(parents=True, exist_ok=True)
        cfg = json.loads((ROOT / pathfinder.CFG).read_text(encoding="utf-8"))
        cfg["grandfathered_gates"] = []
        (d / pathfinder.CFG).write_text(json.dumps(cfg), encoding="utf-8")
        (d / "doctrine/open-loops.json").write_text(json.dumps({"gates": []}), encoding="utf-8")
        (d / "foundation/data/needs-you.json").write_text(json.dumps({"items": [{"id": "x"}]}), encoding="utf-8")
        self.assertTrue(any("without exhaustion proof" in b for b in pathfinder.check(d)))
        for c in cfg["surface_classes"]:
            pathfinder.record(d, "x", c, "r", False, "tried")
        self.assertEqual(pathfinder.check(d), [])


if __name__ == "__main__":
    unittest.main()

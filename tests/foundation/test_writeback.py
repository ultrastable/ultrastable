"""The write-back path: sessions put what they learned into the repository, and code with no write-back fails the check."""
import json, tempfile, unittest
from pathlib import Path
from _repo import ROOT, copy_repo, git, tiny_repo, scratch
from foundation import doctrine, writeback


class Record(unittest.TestCase):
    def test_record_lesson_and_decision_are_ledger_rows_with_probes(self):
        r = copy_repo()
        with self.assertRaises(ValueError):  # CLOSED-LOOP-1: no probe, no record
            writeback.record(r, "lesson", "Probe before closing", "The migration was verified by a probe that passes on the live page.")
        p = writeback.record(r, "lesson", "Probe before closing", "The migration was verified by a probe that passes on the live page.", session="session_abc", probe="file:foundation/writeback.py", today="2026-12-01")
        self.assertEqual(p, "doctrine/writeback/lesson-2026-12-01-probe-before-closing.json")
        before = (r / writeback.LEDGER).read_text()
        self.assertEqual(before, (r / writeback.LEDGER).read_text(), "a record never edits the shared ledger (WRITEBACK-SHARD-1)")
        rows = writeback.ledger_rows(r)
        self.assertEqual([x for x in rows if x["id"] == "lesson-2026-12-01-probe-before-closing"][0]["session"], "session_abc")
        self.assertGreaterEqual(writeback.fold(r)["folded"], 1)  # (the copied repo may carry other shards) main folds shards into the ledger and provenance, then removes them
        self.assertFalse(list((r / writeback.SHARDS).glob("*.json")))
        self.assertIn("lesson-2026-12-01-probe-before-closing", [x["id"] for x in json.loads((r / writeback.LEDGER).read_text())["rows"]])
        self.assertEqual(writeback.fold(r)["folded"], 0)
        d = writeback.record(r, "decision", "Use the free path", "Chose the free path; revert by restoring the previous file, verified by the tests that pass.", probe="grep:foundation/writeback.py::LEDGER", today="2026-12-01")
        self.assertIn("decision-2026-12-01-use-the-free-path", d)
        self.assertFalse((r / "docs/decisions/2026-12-01-use-the-free-path.md").exists())

    def test_lesson_that_hands_work_back_is_refused(self):
        with self.assertRaises(ValueError) as c:
            writeback.record(copy_repo(), "lesson", "x", "Let me know if you want the follow-up.", probe="file:README.md")
        self.assertIn("conditional-offer", str(c.exception))

    def test_open_loop_needs_owner_trigger_and_probe(self):
        r = copy_repo()
        with self.assertRaises(ValueError):
            writeback.record(r, "open-loop", "t", "b")
        with self.assertRaises(ValueError):
            writeback.record(r, "open-loop", "t", "b", owner="staff", trigger="x", probe="vibes")
        p = writeback.record(r, "open-loop", "Re-render the card", "Card still shows the old line.", owner="staff", trigger="next site deploy", probe="grep:site/worker.js::self-referential", today="2026-12-01")
        item = json.loads((r / p).read_text())
        self.assertEqual(item["id"], "OL-20261201-1")
        self.assertIn("**Done check:** grep:site/worker.js::self-referential", item["body"])

    def test_open_loop_id_never_overwrites_when_numbers_have_gaps(self):
        r = copy_repo()
        for n in (1, 2, 91):
            (r / "docs/issues" / f"OL-20261201-{n}.json").write_text('{"id": "keep"}\n', encoding="utf-8")
        p = writeback.record(r, "open-loop", "New", "b", owner="staff", trigger="x", probe="grep:site/worker.js::self-referential", today="2026-12-01")
        self.assertEqual(p, "docs/issues/OL-20261201-92.json")
        self.assertEqual(json.loads((r / "docs/issues/OL-20261201-2.json").read_text())["id"], "keep")

    def test_term_record_changes_the_glossary(self):
        r = copy_repo()
        out = writeback.record(r, "term", "tightened", "A loop with trigger, owner, action, closing probe and write-back.", term="loop", today="2026-12-01")
        self.assertIn("loop v2.0.0", out)


class Check(unittest.TestCase):
    def branch(self, files):
        d = tiny_repo()
        git(d, "checkout", "-q", "-b", "work")
        for rel, text in files.items():
            (d / rel).parent.mkdir(parents=True, exist_ok=True)
            (d / rel).write_text(text)
        git(d, "add", "."); git(d, "commit", "-q", "-m", "work\n\nClaude-Session: https://claude.ai/code/session_0abc")
        return d

    def test_code_without_a_writeback_fails(self):
        d = self.branch({"tool.py": "print(1)\n"})
        self.assertTrue(any("no write-back" in p for p in writeback.check(d, "main", "HEAD")))

    def test_code_with_a_writeback_passes(self):
        d = self.branch({"tool.py": "print(1)\n", "docs/lessons/x.md": "Session: session_0abc\n"})
        self.assertEqual(writeback.check(d, "main", "HEAD"), [])

    def test_branch_sweep_records_are_its_writeback(self):
        """WB-SWEEP-1: a sweep pass writes its disposition ledger and PORT items; those are the write-back, so its PR is not refused."""
        d = self.branch({"site/dashboard-data.js": "x\n", "ops/branchsweep-ledger.jsonl": "{}\nSession: session_0abc\n"})
        self.assertFalse(any("no write-back" in p for p in writeback.check(d, "main", "HEAD")))

    def test_bot_only_dependency_bump_needs_no_writeback(self):
        """DEP-LOOP-1: Dependabot PRs carry no session knowledge; they must not be refused for a missing write-back."""
        d = tiny_repo()
        git(d, "checkout", "-q", "-b", "dep"); (d / "wf.yml").write_text("uses: x@v5\n")
        git(d, "add", "."); git(d, "-c", "user.email=49699333+dependabot[bot]@users.noreply.github.com", "-c", "user.name=dependabot[bot]", "commit", "-q", "-m", "Bump x")
        self.assertEqual(writeback.check(d, "main", "HEAD"), [])

    def test_docs_only_change_needs_no_writeback(self):
        d = self.branch({"notes.md": "x\n"})
        self.assertTrue(all("session" in p for p in writeback.check(d, "main", "HEAD")))

    def test_session_must_be_cited(self):
        d = self.branch({"tool.py": "print(1)\n", "docs/lessons/x.md": "no id here\n"})
        self.assertTrue(any("session_0abc" in p for p in writeback.check(d, "main", "HEAD")))

    def test_banned_framing_commit_message(self):
        d = tiny_repo()
        git(d, "checkout", "-q", "-b", "w"); (d / "docs").mkdir(); (d / "docs/a.md").write_text("a\n")
        bad = "constitu" + "tional AI"
        git(d, "add", "."); git(d, "commit", "-q", "-m", "unlike " + bad)
        self.assertTrue(any("banned framing" in p for p in writeback.check(d, "main", "HEAD")))

    def test_outputs_missing_from_repo_are_flagged(self):
        out = Path(scratch())
        (out / "kept.md").write_bytes((ROOT / "doctrine/positioning.json").read_bytes())
        (out / "lost.md").write_text("only in a session output folder\n")
        got = writeback.outputs(ROOT, [out])
        self.assertEqual(len(got), 1)
        self.assertIn("lost.md", got[0])
        self.assertEqual(writeback.outputs(ROOT, [out], ignore=["lost.md"]), [])


if __name__ == "__main__":
    unittest.main()


class ProbeFormat(unittest.TestCase):
    """PROBE-FORMAT-1: a malformed closing probe never reaches main."""
    def test_formats(self):
        from foundation import writeback as w
        from pathlib import Path
        root = Path(__file__).resolve().parent.parent.parent
        self.assertEqual(w.validate_probe(root, "file:foundation/writeback.py"), "")
        self.assertEqual(w.validate_probe(root, "grep:foundation/writeback.py::def record"), "")
        for bad in ("grep:foundation/writeback.py:def record", "file:no/such/file.py", "grep:foundation/writeback.py::(", "prose", ""):
            self.assertNotEqual(w.validate_probe(root, bad), "", bad)

    def test_repo_probes_are_well_formed(self):
        from foundation import writeback as w
        from pathlib import Path
        self.assertEqual(w.probe_problems(Path(__file__).resolve().parent.parent.parent), [])

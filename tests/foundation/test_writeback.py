"""The write-back path: sessions put what they learned into the repository, and code with no write-back fails the check."""
import json, tempfile, unittest
from pathlib import Path
from _repo import ROOT, copy_repo, git, tiny_repo
from foundation import doctrine, writeback


class Record(unittest.TestCase):
    def test_record_lesson_and_decision_index_them(self):
        r = copy_repo()
        p = writeback.record(r, "lesson", "Probe before closing", "The migration was verified by a probe that passes on the live page.", session="session_abc", today="2026-12-01")
        self.assertEqual(p, "docs/lessons/2026-12-01-probe-before-closing.md")
        self.assertIn("Session: session_abc", (r / p).read_text())
        self.assertIn("probe-before-closing.md", (r / "docs/lessons/README.md").read_text())
        d = writeback.record(r, "decision", "Use the free path", "Chose the free path; revert by restoring the previous file, verified by the tests that pass.", today="2026-12-01")
        self.assertTrue((r / d).is_file())

    def test_lesson_that_hands_work_back_is_refused(self):
        with self.assertRaises(ValueError) as c:
            writeback.record(copy_repo(), "lesson", "x", "Let me know if you want the follow-up.")
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
        out = Path(tempfile.mkdtemp())
        (out / "kept.md").write_text((ROOT / "doctrine/positioning.json").read_text())
        (out / "lost.md").write_text("only in a session output folder\n")
        got = writeback.outputs(ROOT, [out])
        self.assertEqual(len(got), 1)
        self.assertIn("lost.md", got[0])
        self.assertEqual(writeback.outputs(ROOT, [out], ignore=["lost.md"]), [])


if __name__ == "__main__":
    unittest.main()

"""Positioning lint for the autonomy line, and the lint that keeps the doctrine's framing self-bootstrapped."""
import unittest
from _repo import ROOT, copy_repo, edit
from foundation import doctrine

TAG = "A system is autonomous if it has self-referential loops and the ability to close them."


class Autonomy(unittest.TestCase):
    def test_tagline_is_in_positioning_and_public_copy(self):
        d = doctrine.load(ROOT)
        self.assertEqual(d["autonomy"]["tagline"], TAG)
        for rel in ("README.md", "site/worker.js", "demos/public/index.html", "agents/AGENTS.md", "seed/agents/AGENTS.md", "docs/PROJECT-MEMORY.md"):
            self.assertIn("self-referential loops and the ability to close", (ROOT / rel).read_text(), rel)

    def test_missing_autonomy_line_fails(self):
        r = copy_repo()
        p = r / "external/one-pager.md"
        p.write_text(p.read_text().replace(TAG, "").replace("Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).", ""))
        self.assertTrue(any("one-pager.md: lacks the autonomy line" in b for b in doctrine.check(r)))

    def test_contradiction_fails(self):
        r = copy_repo()
        p = r / "README.md"; p.write_text(p.read_text() + "\nAutonomy is only automation.\n")
        self.assertTrue(any("contradicts the autonomy line" in b for b in doctrine.check(r)))

    def test_apply_restores_the_line(self):
        r = copy_repo()
        p = r / "social/README.md"; p.write_text(p.read_text().replace(TAG, "").replace(" Knowing without being able to act is useless, so the system is privileged to close its own loops (`python3 -m foundation loops --verify`).", ""))
        self.assertTrue(any("social/README.md" in c for c in doctrine.apply(r)))
        self.assertEqual([b for b in doctrine.check(r) if "social/README.md" in b], [])


class Framing(unittest.TestCase):
    PHRASES = ["constitu" + "tional AI", "constitu" + "tion-based approach to model training", "unlike an external constitu" + "tion", "Constitu" + "tional Claude"]

    def test_banned_comparison_is_detected(self):
        for p in self.PHRASES:
            self.assertTrue(doctrine.banned_framing("It is unlike " + p + "."), p)

    def test_ordinary_use_of_the_word_is_not(self):
        self.assertFalse(doctrine.banned_framing("The doctrine is self-bootstrapped: its own principles and loops."))
        self.assertFalse(doctrine.banned_framing("The company was set up under the state constitu" + "tion of the entity."))

    def test_repo_is_clean(self):
        self.assertEqual(doctrine.framing_scan(ROOT), [])

    def test_a_file_with_the_comparison_fails_the_doctrine_check(self):
        r = copy_repo()
        (r / "docs/overview.md").write_text((r / "docs/overview.md").read_text() + "\nUnlike " + self.PHRASES[0] + ", this starts from nothing.\n")
        self.assertTrue(any("overview.md" in b and "external approach" in b for b in doctrine.check(r)))


if __name__ == "__main__":
    unittest.main()

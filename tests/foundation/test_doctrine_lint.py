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


CD = "Ultrastable creates and destroys its own parts to stay stable"


def _pos(r, fn):
    import json
    p = r / "doctrine/positioning.json"; d = json.loads(p.read_text(encoding="utf-8")); fn(d["creation_destruction"]); p.write_text(json.dumps(d, indent=2), encoding="utf-8")


class CreationDestruction(unittest.TestCase):
    def test_line_is_in_every_agent_file(self):
        self.assertEqual(doctrine.load(ROOT)["creation_destruction"]["tagline"], CD + ".")
        for rel in ("README.md", "agents/AGENTS.md", "seed/agents/AGENTS.md", "agents/PROJECT-INSTRUCTIONS.md", "docs/PROJECT-MEMORY.md"):
            self.assertIn(CD, (ROOT / rel).read_text(encoding="utf-8"), rel)
        self.assertEqual(doctrine.creation_destruction(ROOT), [])

    def test_missing_creation_line_fails(self):
        r = copy_repo()
        p = r / "seed/agents/AGENTS.md"; p.write_text(p.read_text(encoding="utf-8").replace(CD, "Ultrastable"), encoding="utf-8")
        self.assertTrue(any("seed/agents/AGENTS.md: lacks the creation-and-destruction line" in b for b in doctrine.check(r)))
        self.assertTrue(any("seed/agents/AGENTS.md" in c for c in doctrine.apply(r)))
        self.assertEqual(doctrine.creation_destruction(r), [])

    def test_creation_contradiction_fails(self):
        r = copy_repo()
        p = r / "README.md"; p.write_text(p.read_text(encoding="utf-8") + "
It is contained, so nothing bad can happen.
", encoding="utf-8")
        self.assertTrue(any("contradicts the creation-and-destruction line" in b for b in doctrine.creation_destruction(r)))

    def test_boundary_claim_cannot_outrun_the_mechanism(self):
        r = copy_repo(); _pos(r, lambda c: c["boundary"].update(status="enforced"))
        self.assertTrue(any("claimed as enforced" in b for b in doctrine.creation_destruction(r)))
        d = r / "deploy/container"; d.mkdir(parents=True, exist_ok=True); (d / "Dockerfile").write_text("FROM scratch
")
        self.assertEqual(doctrine.creation_destruction(r), [])

    def test_declared_boundary_needs_a_roadmap_item(self):
        r = copy_repo(); (r / "docs/issues/PL-7.json").unlink()
        self.assertTrue(any("no owner, trigger or probe" in b for b in doctrine.creation_destruction(r)))

    def test_essential_variables_must_exist(self):
        r = copy_repo(); _pos(r, lambda c: c["essential_variables"]["keys"].append("no_such_limit"))
        self.assertTrue(any("essential variable 'no_such_limit' is missing" in b for b in doctrine.creation_destruction(r)))


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

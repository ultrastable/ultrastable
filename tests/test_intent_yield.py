"""Intent Yield tenant (instances/intent-yield): the idea passes the system test and the anti-gaming rules stay in the design."""
import atexit, shutil, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "seed" / "bootstrap"))
import bootstrap as bs  # noqa: E402

IDEA = ROOT / "instances/intent-yield/IDEA.md"
DESIGN = ROOT / "instances/intent-yield/README.md"


def boot(idea_text: str):
    d = Path(tempfile.mkdtemp()); seed = ROOT / "seed"
    atexit.register(shutil.rmtree, d, True)
    (d / "ultrastable.json").write_bytes((seed / "ultrastable.json").read_bytes())
    (d / "autonomy").mkdir(); (d / "autonomy" / "policy.json").write_bytes((seed / "autonomy" / "policy.json").read_bytes())
    (d / "IDEA.md").write_text(idea_text, encoding="utf-8")
    b = bs.Boot(d, d / "org", apply=False)
    b.guard("read", b.read); b.guard("qualify", b.qualify)
    return b


class IntentYieldTests(unittest.TestCase):
    def test_idea_passes_the_system_test(self):
        b = boot(IDEA.read_text(encoding="utf-8"))
        self.assertTrue(b.fit, b.log)

    def test_measure_is_not_a_count_and_never_scores_the_person(self):
        idea = IDEA.read_text(encoding="utf-8").lower()
        design = DESIGN.read_text(encoding="utf-8").lower()
        self.assertIn("never the person", idea)
        self.assertIn("the person is never scored", design)
        for banned in ("points", "streaks", "badges", "rankings"):
            self.assertIn(banned, idea, "the idea must keep the explicit ban on " + banned)
        for guard in ("substance-1", "sealed until the window settles", "restatement", "unit is the intent"):
            self.assertIn(guard, design)


if __name__ == "__main__":
    unittest.main()
